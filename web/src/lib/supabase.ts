import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://hecehemjqgxgicxaqvcm.supabase.co';
export const SUPABASE_ANON = 'sb_publishable_-Vl64dYzEq1OxWIIJ-n-OQ_l8KVUDyh';

// Same storageKey as the legacy app, so a session started on /index.html
// or /auth.html carries over here without signing in again.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    storageKey: 'sb-session',
    storage: window.localStorage,
  },
});
