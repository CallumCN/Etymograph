import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { fetchLanguagePermissions } from '../lib/permissions';
import { findOrCreateEtymologyDisplay, findOrCreateGenealogyDisplay } from '../lib/displays';
import EtymologyDisplay from './EtymologyDisplay';
import GenealogyDisplay from './GenealogyDisplay';
import type { Display, Language, LanguageGenealogyEdge, Lexeme } from '../types';

// The one view that keeps the sidebar+canvas shell from the original
// prototype — a search panel on the left for jumping between displays,
// and the actual graph/Sankey canvas on the right. Every other view
// (language, lexeme, user profile) is a plain page under the header.
export default function DisplayView({ displayId, userId }: { displayId: string; userId: string }) {
  const [display, setDisplay] = useState<Display | null>(null);
  const [rootLexeme, setRootLexeme] = useState<Lexeme | null>(null);
  const [rootLanguage, setRootLanguage] = useState<Language | null>(null);
  const [parentEdges, setParentEdges] = useState<LanguageGenealogyEdge[]>([]);
  const [canEditContent, setCanEditContent] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState('');

  const [sidebarTerm, setSidebarTerm] = useState('');
  const [sidebarResults, setSidebarResults] = useState<{ id: string; title: string; subtitle: string }[]>([]);

  const reload = useCallback(async () => {
    const { data: d, error: err } = await supabase.from('displays').select('*').eq('id', displayId).single();
    if (err || !d) {
      setError(err?.message || 'Not found.');
      return;
    }
    setError('');
    setDisplay(d);

    if (d.kind === 'etymology' && d.root_lexeme_id) {
      const { data: w } = await supabase.from('lexemes').select('*').eq('id', d.root_lexeme_id).single();
      setRootLexeme(w || null);
      if (w) {
        const { canEditContent: editable } = await fetchLanguagePermissions(w.language_id, userId);
        setCanEditContent(editable);
      }
    } else if (d.kind === 'genealogy' && d.root_language_id) {
      const { data: lang } = await supabase.from('languages').select('*').eq('id', d.root_language_id).single();
      setRootLanguage(lang || null);
      const { data: edges } = await supabase.from('language_genealogy').select('*').eq('child_language_id', d.root_language_id);
      setParentEdges(edges || []);
    }

    const { data: saved } = await supabase.from('saved_displays').select('*').eq('user_id', userId).eq('display_id', displayId).maybeSingle();
    setIsSaved(!!saved);
  }, [displayId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!display) return;
    let active = true;
    (async () => {
      if (!sidebarTerm) {
        setSidebarResults([]);
        return;
      }
      if (display.kind === 'etymology') {
        const { data } = await supabase.from('lexemes').select('id,form,gloss').ilike('form', `%${sidebarTerm}%`).limit(20);
        if (active) setSidebarResults((data || []).map((w) => ({ id: w.id, title: w.form, subtitle: w.gloss || '' })));
      } else {
        const { data } = await supabase.from('languages').select('id,name,is_constructed').ilike('name', `%${sidebarTerm}%`).limit(20);
        if (active) setSidebarResults((data || []).map((l) => ({ id: l.id, title: l.name, subtitle: l.is_constructed ? 'constructed' : 'natural' })));
      }
    })();
    return () => {
      active = false;
    };
  }, [sidebarTerm, display]);

  async function openSidebarResult(id: string, title: string) {
    if (!display) return;
    const target = display.kind === 'etymology' ? await findOrCreateEtymologyDisplay(userId, id, title) : await findOrCreateGenealogyDisplay(userId, id, title);
    navigate(`/displays/${target.id}`);
  }

  async function renameDisplay(title: string) {
    await supabase.from('displays').update({ title }).eq('id', displayId);
    reload();
  }

  async function setVisibility(visibility: 'public' | 'private') {
    await supabase.from('displays').update({ visibility }).eq('id', displayId);
    reload();
  }

  async function toggleSaved() {
    if (isSaved) {
      await supabase.from('saved_displays').delete().eq('user_id', userId).eq('display_id', displayId);
    } else {
      await supabase.from('saved_displays').insert({ user_id: userId, display_id: displayId });
    }
    setIsSaved(!isSaved);
  }

  async function deleteDisplay() {
    if (!confirm('Delete this display?')) return;
    await supabase.from('displays').delete().eq('id', displayId);
    navigate('/');
  }

  if (error) return <div className="err">{error}</div>;
  if (!display) return <div className="hint">Loading…</div>;

  const isOwner = display.owner_id === userId;

  return (
    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-head">
          <input
            className="search-input"
            placeholder={display.kind === 'etymology' ? 'search lexemes...' : 'search languages...'}
            value={sidebarTerm}
            onChange={(e) => setSidebarTerm(e.target.value)}
          />
        </div>
        <div className="lang-list">
          {sidebarResults.map((r) => (
            <div key={r.id} className="lang-item" onClick={() => openSidebarResult(r.id, r.title)}>
              <div className="lang-item-name">{r.title}</div>
              <div className="lang-item-meta">{r.subtitle}</div>
            </div>
          ))}
          {sidebarTerm && !sidebarResults.length && <div className="hint" style={{ padding: '0.65rem 1.25rem' }}>No matches.</div>}
        </div>
      </aside>

      <main className="main-panel">
        <div className="view-title">
          {isOwner ? (
            <input
              className="text-input display-title-input"
              defaultValue={display.title}
              onBlur={(e) => e.target.value.trim() && e.target.value !== display.title && renameDisplay(e.target.value.trim())}
            />
          ) : (
            display.title
          )}
          <span className="badge">{display.kind} display</span>
        </div>

        <div className="form-row" style={{ marginBottom: '1.5rem' }}>
          {isOwner ? (
            <label className="checkbox-label inline">
              <input type="checkbox" checked={display.visibility === 'private'} onChange={(e) => setVisibility(e.target.checked ? 'private' : 'public')} />
              Private
            </label>
          ) : (
            <button className="btn secondary" onClick={toggleSaved}>
              {isSaved ? 'Unsave' : 'Save'} display
            </button>
          )}
          {isOwner && (
            <button className="btn secondary danger" onClick={deleteDisplay}>
              Delete display
            </button>
          )}
        </div>

        {display.kind === 'etymology' && rootLexeme && (
          <>
            <div className="view-subtitle">
              <span className="link" onClick={() => navigate(`/lexemes/${rootLexeme.id}`)}>
                {rootLexeme.form}
              </span>
            </div>
            <EtymologyDisplay lexeme={rootLexeme} userId={userId} canEditContent={canEditContent} />
          </>
        )}
        {display.kind === 'genealogy' && rootLanguage && (
          <>
            <div className="view-subtitle">
              <span className="link" onClick={() => navigate(`/languages/${rootLanguage.id}`)}>
                {rootLanguage.name}
              </span>
            </div>
            <GenealogyDisplay language={rootLanguage} parentEdges={parentEdges} />
          </>
        )}
      </main>
    </div>
  );
}
