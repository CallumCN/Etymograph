import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { findOrCreateEtymologyDisplay } from '../lib/displays';
import type { Etymology, Lexeme } from '../types';

interface AncestorSummary {
  id: string;
  form: string;
  languageName: string;
  relationType: string;
  confidence: string;
}

export default function LexemeView({ lexemeId, userId }: { lexemeId: string; userId: string }) {
  const [lexeme, setLexeme] = useState<Lexeme | null>(null);
  const [languageId, setLanguageId] = useState('');
  const [languageName, setLanguageName] = useState('');
  const [ancestors, setAncestors] = useState<AncestorSummary[]>([]);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const { data: w, error: err } = await supabase.from('lexemes').select('*').eq('id', lexemeId).single();
    if (err || !w) {
      setError(err?.message || 'Not found.');
      return;
    }
    setError('');
    setLexeme(w);
    setLanguageId(w.language_id);

    const { data: lang } = await supabase.from('languages').select('name').eq('id', w.language_id).maybeSingle();
    setLanguageName(lang?.name || '');

    const { data: etys } = await supabase.from('etymologies').select('*').eq('descendant_lexeme_id', lexemeId);
    const ancestorIds = (etys || []).map((e: Etymology) => e.ancestor_lexeme_id);
    const { data: ancestorLexemes } = ancestorIds.length
      ? await supabase.from('lexemes').select('id,form,language_id').in('id', ancestorIds)
      : { data: [] as { id: string; form: string; language_id: string }[] };
    const langIds = [...new Set((ancestorLexemes || []).map((l) => l.language_id))];
    const { data: langs } = langIds.length
      ? await supabase.from('languages').select('id,name').in('id', langIds)
      : { data: [] as { id: string; name: string }[] };
    const nameById = Object.fromEntries((langs || []).map((l) => [l.id, l.name]));
    const lexById = Object.fromEntries((ancestorLexemes || []).map((l) => [l.id, l]));

    setAncestors(
      (etys || [])
        .filter((e: Etymology) => lexById[e.ancestor_lexeme_id])
        .map((e: Etymology) => ({
          id: e.ancestor_lexeme_id,
          form: lexById[e.ancestor_lexeme_id].form,
          languageName: nameById[lexById[e.ancestor_lexeme_id].language_id] || '…',
          relationType: e.relation_type,
          confidence: e.confidence,
        }))
    );
  }, [lexemeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function openEtymologyDisplay() {
    if (!lexeme) return;
    const display = await findOrCreateEtymologyDisplay(userId, lexemeId, lexeme.form);
    navigate(`/displays/${display.id}`);
  }

  if (error) return <div className="err">{error}</div>;
  if (!lexeme) return <div className="hint">Loading…</div>;

  return (
    <div>
      <div className="view-title">
        {lexeme.form}
        <span className="badge" style={{ cursor: 'pointer' }} onClick={() => navigate(`/languages/${languageId}`)}>
          {languageName}
        </span>
      </div>
      <div className="view-subtitle">{lexeme.transcription || ''}</div>
      <div className="view-meaning">{lexeme.gloss || ''}</div>

      <div className="section">
        <div className="section-label">Etymons</div>
        {ancestors.length ? (
          ancestors.map((a) => (
            <span key={a.id} className="chip" onClick={() => navigate(`/lexemes/${a.id}`)}>
              {a.form} <span className="row-sub">({a.languageName}) · {a.relationType} · {a.confidence}</span>
            </span>
          ))
        ) : (
          <span className="hint">No etymons yet.</span>
        )}
      </div>

      <button className="btn secondary" onClick={openEtymologyDisplay}>
        Open etymology display
      </button>
    </div>
  );
}
