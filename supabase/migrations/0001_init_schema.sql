-- ============================================================================
-- Phase 1 schema: languages, genealogy, lexemes, etymologies, ownership,
-- and the public revision log that backs rollback/selective-reapply.
-- Supersedes the old single-user "lexicons" / "subgraphs" tables.
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── PROFILES ────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  bio text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── SHARED ENUMS ────────────────────────────────────────────────────────
-- One confidence scale, reused by both language genealogy and lexeme
-- etymology edges, so "hypothetical"/"disputed" links render consistently
-- at every level of the graph.
create type confidence_level as enum ('attested', 'probable', 'hypothetical', 'disputed');

create type language_visibility as enum ('public', 'private');

create type ownership_status as enum ('owner', 'invited', 'requested');

create type etymology_relation as enum (
  'inherited', 'borrowed', 'calque', 'compound', 'derivation', 'influenced_by'
);

create type revision_entity as enum ('language', 'language_genealogy', 'lexeme', 'etymology');
create type revision_op as enum ('create', 'update', 'delete');

-- ─── LANGUAGES ───────────────────────────────────────────────────────────
-- A "historical stage" is just a language with a primary parent — no
-- separate stages table. family_name is only meaningful on a root node
-- (no primary parent), naming the family/proto-language this tree founds.
create table languages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  is_constructed boolean not null default false,
  visibility language_visibility not null default 'public',

  -- Owners of a constructed+public language can open it to community edits,
  -- and can toggle this off again later without affecting past edits.
  publicly_editable boolean not null default false,

  family_name text,

  -- Private is only allowed for a constructed language whose creator has
  -- explicitly asserted authorship. We can't verify this claim, so we audit
  -- it instead: the checkbox the UI shows before allowing private+constructed.
  original_creation_acknowledged boolean not null default false,
  original_creation_acknowledged_at timestamptz,

  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint natural_language_always_public
    check (is_constructed or visibility = 'public'),
  constraint private_requires_acknowledged_authorship
    check (visibility = 'public' or original_creation_acknowledged),
  constraint editable_requires_public_constructed
    check (not publicly_editable or (is_constructed and visibility = 'public'))
);

create index on languages (slug);
create index on languages (is_constructed, visibility);

-- ─── LANGUAGE GENEALOGY ──────────────────────────────────────────────────
-- Same shape as lexeme etymologies (edge table with confidence), so the
-- display-editor layout logic can be shared between the two graphs.
create table language_genealogy (
  id uuid primary key default gen_random_uuid(),
  child_language_id uuid not null references languages(id) on delete cascade,
  parent_language_id uuid not null references languages(id) on delete cascade,

  -- Direct lineage (ancestor dialect/stage) vs. looser contact/contribution
  -- (loanword source, creole substrate, etc). At most 2 primary parents.
  is_primary boolean not null default false,
  confidence confidence_level not null default 'attested',
  notes text,

  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),

  constraint no_self_parent check (child_language_id <> parent_language_id),
  unique (child_language_id, parent_language_id)
);

create index on language_genealogy (child_language_id);
create index on language_genealogy (parent_language_id);

create or replace function check_primary_parent_cap() returns trigger as $$
begin
  if new.is_primary and (
    select count(*) from language_genealogy
    where child_language_id = new.child_language_id
      and is_primary = true
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000')
  ) >= 2 then
    raise exception 'A language may have at most 2 primary parents';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_primary_parent_cap
before insert or update on language_genealogy
for each row execute function check_primary_parent_cap();

-- ─── LANGUAGE OWNERSHIP ──────────────────────────────────────────────────
-- Only meaningful for constructed languages. Invite / request-to-join /
-- self-removal are just status transitions on this table; admins (profiles
-- .is_admin) can edit any row regardless of membership.
create table language_ownership (
  id uuid primary key default gen_random_uuid(),
  language_id uuid not null references languages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status ownership_status not null default 'owner',
  invited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (language_id, user_id)
);

create index on language_ownership (language_id);
create index on language_ownership (user_id);

-- ─── LEXEMES ─────────────────────────────────────────────────────────────
create table lexemes (
  id uuid primary key default gen_random_uuid(),
  language_id uuid not null references languages(id) on delete cascade,
  form text not null,
  transcription text,
  gloss text,
  part_of_speech text,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on lexemes (language_id);
create index on lexemes (language_id, form);

-- ─── ETYMOLOGIES ─────────────────────────────────────────────────────────
-- grapheme_ranges carries the morpheme-editor assignment (which characters
-- of the descendant form are attributed to this ancestor) — this is what
-- drives the lexeme-etymology display's contribution proportions, as
-- opposed to language genealogy, whose proportions are computed from
-- aggregate vocabulary counts (see the view below), not manual assignment.
create table etymologies (
  id uuid primary key default gen_random_uuid(),
  descendant_lexeme_id uuid not null references lexemes(id) on delete cascade,
  ancestor_lexeme_id uuid not null references lexemes(id) on delete cascade,
  relation_type etymology_relation not null default 'inherited',
  confidence confidence_level not null default 'attested',
  grapheme_ranges jsonb,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),

  constraint no_self_etymology check (descendant_lexeme_id <> ancestor_lexeme_id),
  unique (descendant_lexeme_id, ancestor_lexeme_id)
);

create index on etymologies (descendant_lexeme_id);
create index on etymologies (ancestor_lexeme_id);

-- ─── VOCABULARY CONTRIBUTION (feeds the language-genealogy Sankey) ──────
-- Direct, per-language-pair vocabulary share: of target_language's lexemes,
-- how many trace (directly) to source_language. "Direct" on purpose —
-- transitive contribution is already represented by source_language's own
-- upstream edges, so it isn't double-counted here.
create view language_vocab_contribution as
select
  d.language_id as target_language_id,
  a.language_id as source_language_id,
  count(distinct e.descendant_lexeme_id) as contributed_count
from etymologies e
join lexemes d on d.id = e.descendant_lexeme_id
join lexemes a on a.id = e.ancestor_lexeme_id
where d.language_id <> a.language_id
group by d.language_id, a.language_id;

create view language_vocab_totals as
select language_id, count(*) as total_lexemes
from lexemes
group by language_id;
-- Proportion per source = contributed_count / total_lexemes.
-- The "unknown/unselected" residual band in the UI is computed client-side:
-- total_lexemes minus the sum of contributed_count across whichever source
-- languages the user has selected in the checklist, so toggling selections
-- doesn't require a new query.

-- ─── REVISIONS (public edit history, rollback, selective reapply) ───────
-- Append-only. Each row is one change to one entity. depends_on records a
-- structural dependency (e.g. an etymology revision depends on the
-- revision that created the ancestor lexeme it points to) so that a
-- partial rollback can be checked for completeness before it's applied.
--
-- `language_id` scopes every row to "whose public history this is":
-- for a lexeme/etymology, that's the language the affected lexeme belongs
-- to (for etymologies, the descendant's language — the side whose
-- vocabulary gained the claim).
create table revisions (
  id uuid primary key default gen_random_uuid(),
  language_id uuid not null references languages(id) on delete cascade,
  entity_type revision_entity not null,
  entity_id uuid not null,
  op revision_op not null,
  before jsonb,
  after jsonb,
  author_id uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create index on revisions (language_id, created_at);
create index on revisions (entity_type, entity_id);

create table revision_dependencies (
  revision_id uuid not null references revisions(id) on delete cascade,
  depends_on_revision_id uuid not null references revisions(id) on delete cascade,
  primary key (revision_id, depends_on_revision_id)
);

-- Given a checkpoint (roll back to this point) and a set of later
-- revisions the owner wants to keep, return any revision in that set whose
-- dependency falls outside {everything up to the checkpoint} ∪ {the set
-- itself}. An empty result means the selection is self-consistent and safe
-- to apply.
create or replace function check_revision_dependencies(
  p_checkpoint_revision_id uuid,
  p_selected_ids uuid[]
) returns table(revision_id uuid, missing_dependency_id uuid) as $$
  with checkpoint_cutoff as (
    select created_at from revisions where id = p_checkpoint_revision_id
  ),
  allowed as (
    select id from revisions, checkpoint_cutoff
    where revisions.created_at <= checkpoint_cutoff.created_at
    union
    select unnest(p_selected_ids)
  )
  select rd.revision_id, rd.depends_on_revision_id
  from revision_dependencies rd
  where rd.revision_id = any(p_selected_ids)
    and rd.depends_on_revision_id not in (select id from allowed);
$$ language sql stable;

comment on function check_revision_dependencies is
  'Validation only. Actually applying a rollback + selected reapply means '
  'replaying jsonb before/after diffs per entity_type and writing the '
  'result as new revisions — that belongs in an Edge Function, not here, '
  'since it needs typed per-entity apply logic rather than branching SQL.';
