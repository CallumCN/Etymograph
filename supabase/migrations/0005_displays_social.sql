-- ============================================================================
-- "Displays" become first-class, nameable, ownable, saveable entities —
-- generalizing the old (never-ported) `subgraphs` concept to cover both
-- the lexeme etymology display and the language genealogy display. Also
-- adds the minimal social graph (follows, saved languages, saved displays)
-- needed to back the browse page's rectangle band of quick-access panels.
--
-- Comments/likes/DMs are intentionally NOT modeled here — there's no
-- settled target entity for them yet (comment on a lexeme? a display?),
-- so the frontend shows an honest "not implemented" state for those
-- rather than this migration guessing at a schema.
-- ============================================================================

create type display_kind as enum ('etymology', 'genealogy');

create table displays (
  id uuid primary key default gen_random_uuid(),
  kind display_kind not null,
  title text not null,
  owner_id uuid not null references profiles(id),
  visibility language_visibility not null default 'public',

  -- exactly one of these is set, matching `kind`
  root_lexeme_id uuid references lexemes(id) on delete cascade,
  root_language_id uuid references languages(id) on delete cascade,

  -- reserved for saved layout/selection state (node positions, which
  -- sources are checked in the vocab-contribution checklist, etc.) — the
  -- current frontend doesn't persist into this yet, it just recomputes
  -- from etymologies/language_genealogy each time.
  config jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint display_root_matches_kind check (
    (kind = 'etymology' and root_lexeme_id is not null and root_language_id is null)
    or (kind = 'genealogy' and root_language_id is not null and root_lexeme_id is null)
  )
);

create index on displays (owner_id);
create index on displays (kind, root_lexeme_id);
create index on displays (kind, root_language_id);

create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

create table saved_languages (
  user_id uuid not null references profiles(id) on delete cascade,
  language_id uuid not null references languages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, language_id)
);

create table saved_displays (
  user_id uuid not null references profiles(id) on delete cascade,
  display_id uuid not null references displays(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, display_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────
alter table displays enable row level security;
alter table follows enable row level security;
alter table saved_languages enable row level security;
alter table saved_displays enable row level security;

create policy displays_select on displays
  for select using (visibility = 'public' or owner_id = auth.uid() or is_admin());

create policy displays_insert on displays
  for insert with check (owner_id = auth.uid());

create policy displays_update on displays
  for update using (owner_id = auth.uid() or is_admin()) with check (owner_id = auth.uid() or is_admin());

create policy displays_delete on displays
  for delete using (owner_id = auth.uid() or is_admin());

-- Follow graph is public (who-follows-whom is visible to anyone), like
-- most social apps; only the follower can create/remove their own edge.
create policy follows_select on follows
  for select using (true);

create policy follows_insert on follows
  for insert with check (follower_id = auth.uid());

create policy follows_delete on follows
  for delete using (follower_id = auth.uid());

-- Saved languages / saved displays are private bookmark lists.
create policy saved_languages_all on saved_languages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy saved_displays_all on saved_displays
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
