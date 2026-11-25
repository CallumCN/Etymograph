import { supabase } from './supabase';
import type { Display, Language } from '../types';

// Shared rule, used wherever a view needs to know whether the current user
// may edit a language's lexemes/etymologies (not the language row itself,
// which stays owner/admin-only regardless of publicly_editable).
export async function fetchLanguagePermissions(languageId: string, userId: string) {
  const { data: language } = await supabase.from('languages').select('*').eq('id', languageId).single();
  const { data: ownershipRows } = await supabase
    .from('language_ownership')
    .select('*')
    .eq('language_id', languageId)
    .eq('user_id', userId);

  const myRow = (ownershipRows || [])[0];
  const canGovern = !!myRow && myRow.status === 'owner';
  const canEditContent =
    !language?.is_constructed ||
    canGovern ||
    (language?.visibility === 'public' && !!language?.publicly_editable);

  return { language: language as Language, canGovern, canEditContent };
}

// A main display is co-owned by every owner of its language (not just
// whichever one happened to create it, which is all `display.owner_id`
// records) — a custom non-main display stays single-owner.
export async function canEditDisplay(display: Display, userId: string): Promise<boolean> {
  if (display.is_main && display.root_language_id) {
    const { canGovern } = await fetchLanguagePermissions(display.root_language_id, userId);
    return canGovern;
  }
  return display.owner_id === userId;
}
