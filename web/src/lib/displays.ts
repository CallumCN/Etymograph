import { supabase } from './supabase';
import type { Display } from '../types';

// "Open etymology display" / "Open genealogy display" finds the current
// user's own display for that root if one exists, otherwise falls back to
// any visible one, otherwise creates a new one owned by the current user.
export async function findOrCreateEtymologyDisplay(userId: string, lexemeId: string, lexemeForm: string): Promise<Display> {
  const { data: mine } = await supabase
    .from('displays')
    .select('*')
    .eq('kind', 'etymology')
    .eq('root_lexeme_id', lexemeId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (mine) return mine;

  const { data: anyVisible } = await supabase
    .from('displays')
    .select('*')
    .eq('kind', 'etymology')
    .eq('root_lexeme_id', lexemeId)
    .limit(1)
    .maybeSingle();
  if (anyVisible) return anyVisible;

  const { data: created, error } = await supabase
    .from('displays')
    .insert({ kind: 'etymology', title: `${lexemeForm} — etymology`, owner_id: userId, root_lexeme_id: lexemeId })
    .select()
    .single();
  if (error || !created) throw error || new Error('Could not create display.');
  return created;
}

export async function findOrCreateGenealogyDisplay(userId: string, languageId: string, languageName: string): Promise<Display> {
  const { data: mine } = await supabase
    .from('displays')
    .select('*')
    .eq('kind', 'genealogy')
    .eq('root_language_id', languageId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (mine) return mine;

  const { data: anyVisible } = await supabase
    .from('displays')
    .select('*')
    .eq('kind', 'genealogy')
    .eq('root_language_id', languageId)
    .limit(1)
    .maybeSingle();
  if (anyVisible) return anyVisible;

  const { data: created, error } = await supabase
    .from('displays')
    .insert({ kind: 'genealogy', title: `${languageName} — genealogy`, owner_id: userId, root_language_id: languageId })
    .select()
    .single();
  if (error || !created) throw error || new Error('Could not create display.');
  return created;
}
