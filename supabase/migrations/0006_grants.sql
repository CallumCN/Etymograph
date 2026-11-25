-- ============================================================================
-- Explicit table grants. RLS policies (0003, 0005) already govern which
-- ROWS a role can see/touch, but that's moot if the role has no baseline
-- grant on the table at all — which is what "permission denied for table
-- language_ownership" turned out to mean when testing from the SQL
-- editor. Covers every table from 0001 onward, since this gap would have
-- silently blocked the same class of operation everywhere, not just here.
-- ============================================================================

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  profiles,
  languages,
  language_genealogy,
  language_ownership,
  lexemes,
  etymologies,
  displays,
  follows,
  saved_languages,
  saved_displays
to authenticated;

-- Anonymous (signed-out) visitors only need read access — every write path
-- in the app requires auth.uid(), so there's nothing for anon to write.
grant select on
  profiles,
  languages,
  language_genealogy,
  language_ownership,
  lexemes,
  etymologies,
  displays,
  follows,
  saved_languages,
  saved_displays
to anon;

-- Revisions: readable like a wiki history page, writable only through a
-- trusted server-side path (not yet built) — see 0003's comment.
grant select on revisions, revision_dependencies to authenticated, anon;

grant usage on all sequences in schema public to authenticated, anon;
