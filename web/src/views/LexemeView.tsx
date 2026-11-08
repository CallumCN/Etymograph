import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { fetchLanguagePermissions } from '../lib/permissions';
import EtymologyDisplay from './EtymologyDisplay';
import type { Lexeme } from '../types';

export default function LexemeView({ lexemeId, userId }: { lexemeId: string; userId: string }) {
  const [lexeme, setLexeme] = useState<Lexeme | null>(null);
  const [languageName, setLanguageName] = useState('');
  const [canEditContent, setCanEditContent] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const { data: w, error: err } = await supabase.from('lexemes').select('*').eq('id', lexemeId).single();
    if (err || !w) {
      setError(err?.message || 'Not found.');
      return;
    }
    setLexeme(w);
    const { language, canEditContent: editable } = await fetchLanguagePermissions(w.language_id, userId);
    setLanguageName(language?.name || '');
    setCanEditContent(editable);
  }, [lexemeId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) return <div className="err">{error}</div>;
  if (!lexeme) return <div className="hint">Loading…</div>;

  return (
    <div>
      <div className="view-title">
        {lexeme.form}
        <span className="badge" style={{ cursor: 'pointer' }} onClick={() => navigate(`/languages/${lexeme.language_id}`)}>
          {languageName}
        </span>
      </div>
      <div className="view-subtitle">{lexeme.transcription || ''}</div>
      <div className="view-meaning">{lexeme.gloss || ''}</div>
      <EtymologyDisplay lexeme={lexeme} userId={userId} canEditContent={canEditContent} />
    </div>
  );
}
