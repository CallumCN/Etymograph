-- ============================================================================
-- One-time port of the old single-blob schema (`lexicons.words` jsonb,
-- keyed by user_id) into the new relational schema. Run this once, after
-- 0001-0003, against the live database (it reads the existing `lexicons`
-- table, so it has to run there rather than against an empty dev DB).
--
-- Each legacy user gets one placeholder language (private, constructed,
-- "<name>'s Lexicon" — rename it from the UI afterward). Their words
-- become lexemes in it; `ancestors` + `morphemes` become etymologies with
-- grapheme_ranges carrying over the old character-level assignment.
--
-- Does NOT touch the old `subgraphs` table — saved display compositions
-- don't have an equivalent in the new schema yet; revisit once the
-- genealogy/etymology display component exists. The old `lexicons` and
-- `subgraphs` tables are left in place (not dropped) so index.html keeps
-- working untouched until you're ready to cut over.
--
-- Idempotent: skips any legacy user whose placeholder language already has
-- lexemes in it, so re-running this after a partial run won't duplicate.
-- ============================================================================

create temp table legacy_words_staged (
  user_id uuid,
  language_id uuid,
  old_id text,
  form text,
  transcription text,
  gloss text,
  ancestors jsonb,
  morphemes jsonb,
  new_id uuid
) on commit drop;

create temp table legacy_lexeme_id_map (
  old_id text primary key,
  new_id uuid not null
) on commit drop;

-- one placeholder language per legacy user, skipping ones already made ----
insert into languages (
  name, slug, is_constructed, visibility, original_creation_acknowledged,
  original_creation_acknowledged_at, created_by
)
select
  coalesce(p.display_name, p.username, 'Imported') || '''s Lexicon',
  'legacy-' || l.user_id::text,
  true, 'private', true, now(), l.user_id
from lexicons l
left join profiles p on p.id = l.user_id
where not exists (select 1 from languages where slug = 'legacy-' || l.user_id::text);

insert into language_ownership (language_id, user_id, status)
select lang.id, l.user_id, 'owner'
from lexicons l
join languages lang on lang.slug = 'legacy-' || l.user_id::text
where not exists (
  select 1 from language_ownership where language_id = lang.id and user_id = l.user_id
);

-- stage each word, skipping any user whose placeholder language is non-empty
insert into legacy_words_staged (
  user_id, language_id, old_id, form, transcription, gloss, ancestors, morphemes, new_id
)
select
  l.user_id,
  lang.id,
  w ->> 'id',
  w ->> 'word',
  w ->> 'transcription',
  w ->> 'meaning',
  coalesce(w -> 'ancestors', '[]'::jsonb),
  coalesce(w -> 'morphemes', '[]'::jsonb),
  gen_random_uuid()
from lexicons l
join languages lang on lang.slug = 'legacy-' || l.user_id::text
cross join lateral jsonb_array_elements(l.words) as w
where not exists (select 1 from lexemes where language_id = lang.id);

insert into lexemes (id, language_id, form, transcription, gloss, created_by)
select new_id, language_id, form, transcription, gloss, user_id
from legacy_words_staged;

insert into legacy_lexeme_id_map (old_id, new_id)
select old_id, new_id from legacy_words_staged;

-- etymologies, with grapheme_ranges rebuilt from the old per-ancestor
-- morpheme assignment (null if that ancestor had no character range —
-- i.e. the whole word was attributed to it)
insert into etymologies (
  descendant_lexeme_id, ancestor_lexeme_id, relation_type, confidence, grapheme_ranges, created_by
)
select
  s.new_id,
  m.new_id,
  'inherited',
  'attested',
  (
    select jsonb_agg(jsonb_build_object('start', mo -> 'start', 'end', mo -> 'end'))
    from jsonb_array_elements(s.morphemes) mo
    where mo ->> 'ancestorId' = anc_old_id
  ),
  s.user_id
from legacy_words_staged s
cross join lateral jsonb_array_elements_text(s.ancestors) as anc_old_id
join legacy_lexeme_id_map m on m.old_id = anc_old_id;

-- sanity check: run this after and compare against your old word count
-- select count(*) from lexemes l join languages g on g.id = l.language_id where g.slug like 'legacy-%';
