export type Visibility = 'public' | 'private';
export type Confidence = 'attested' | 'probable' | 'hypothetical' | 'disputed';
export type EtymologyRelation =
  | 'inherited' | 'borrowed' | 'calque' | 'compound' | 'derivation' | 'influenced_by';
export type OwnershipStatus = 'owner' | 'invited' | 'requested';

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface Language {
  id: string;
  name: string;
  slug: string;
  is_constructed: boolean;
  visibility: Visibility;
  publicly_editable: boolean;
  family_name: string | null;
  original_creation_acknowledged: boolean;
  original_creation_acknowledged_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LanguageGenealogyEdge {
  id: string;
  child_language_id: string;
  parent_language_id: string;
  is_primary: boolean;
  confidence: Confidence;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface LanguageOwnership {
  id: string;
  language_id: string;
  user_id: string;
  status: OwnershipStatus;
  invited_by: string | null;
  created_at: string;
}

export interface Lexeme {
  id: string;
  language_id: string;
  form: string;
  transcription: string | null;
  gloss: string | null;
  part_of_speech: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GraphemeRange {
  start: number;
  end: number;
}

export interface Etymology {
  id: string;
  descendant_lexeme_id: string;
  ancestor_lexeme_id: string;
  relation_type: EtymologyRelation;
  confidence: Confidence;
  grapheme_ranges: GraphemeRange[] | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export type DisplayKind = 'etymology' | 'genealogy';

export interface Display {
  id: string;
  kind: DisplayKind;
  title: string;
  owner_id: string;
  visibility: Visibility;
  root_lexeme_id: string | null;
  root_language_id: string | null;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Follow {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface SavedLanguage {
  user_id: string;
  language_id: string;
  created_at: string;
}

export interface SavedDisplay {
  user_id: string;
  display_id: string;
  created_at: string;
}

export interface VocabContributionRow {
  target_language_id: string;
  source_language_id: string;
  contributed_count: number;
}

export interface VocabTotalsRow {
  language_id: string;
  total_lexemes: number;
}
