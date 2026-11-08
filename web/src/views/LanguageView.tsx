import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import type { Confidence, Language, LanguageGenealogyEdge, LanguageOwnership, Lexeme } from '../types';
import GenealogyDisplay from './GenealogyDisplay';

export default function LanguageView({ languageId, userId }: { languageId: string; userId: string }) {
  const [language, setLanguage] = useState<Language | null>(null);
  const [ownership, setOwnership] = useState<LanguageOwnership[]>([]);
  const [parentEdges, setParentEdges] = useState<LanguageGenealogyEdge[]>([]);
  const [childEdges, setChildEdges] = useState<LanguageGenealogyEdge[]>([]);
  const [lexemes, setLexemes] = useState<Lexeme[]>([]);
  const [langNameById, setLangNameById] = useState<Record<string, string>>({});
  const [usernameById, setUsernameById] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [showVocab, setShowVocab] = useState(false);

  const [parentSearch, setParentSearch] = useState('');
  const [parentCandidates, setParentCandidates] = useState<{ id: string; name: string }[]>([]);
  const [parentConfidence, setParentConfidence] = useState<Confidence>('attested');
  const [parentPrimary, setParentPrimary] = useState(false);

  const [inviteUsername, setInviteUsername] = useState('');
  const [newWordForm, setNewWordForm] = useState('');
  const [newWordTranscription, setNewWordTranscription] = useState('');
  const [newWordGloss, setNewWordGloss] = useState('');

  const reload = useCallback(async () => {
    const { data: lang, error: langErr } = await supabase.from('languages').select('*').eq('id', languageId).single();
    if (langErr || !lang) {
      setError(langErr?.message || 'Not found.');
      setLanguage(null);
      return;
    }
    setError('');
    setLanguage(lang);

    const [{ data: own }, { data: parents }, { data: children }, { data: words }] = await Promise.all([
      supabase.from('language_ownership').select('*').eq('language_id', languageId),
      supabase.from('language_genealogy').select('*').eq('child_language_id', languageId),
      supabase.from('language_genealogy').select('*').eq('parent_language_id', languageId),
      supabase.from('lexemes').select('*').eq('language_id', languageId).order('form'),
    ]);
    setOwnership(own || []);
    setParentEdges(parents || []);
    setChildEdges(children || []);
    setLexemes(words || []);

    const relatedIds = [
      ...new Set([...(parents || []).map((e) => e.parent_language_id), ...(children || []).map((e) => e.child_language_id)]),
    ];
    const { data: relatedLangs } = relatedIds.length
      ? await supabase.from('languages').select('id,name').in('id', relatedIds)
      : { data: [] as { id: string; name: string }[] };
    setLangNameById(Object.fromEntries((relatedLangs || []).map((l) => [l.id, l.name])));

    const ownerIds = (own || []).map((o) => o.user_id);
    const { data: profs } = ownerIds.length
      ? await supabase.from('profiles').select('id,username').in('id', ownerIds)
      : { data: [] as { id: string; username: string }[] };
    setUsernameById(Object.fromEntries((profs || []).map((p) => [p.id, p.username])));
  }, [languageId]);

  useEffect(() => {
    setShowVocab(false);
    reload();
  }, [reload]);

  if (error) return <div className="err">{error}</div>;
  if (!language) return <div className="hint">Loading…</div>;

  const myRow = ownership.find((o) => o.user_id === userId);
  const iCanGovern = !!myRow && myRow.status === 'owner';
  const iCanEditContent = !language.is_constructed || iCanGovern || (language.visibility === 'public' && language.publicly_editable);

  async function setVisibility(makePrivate: boolean) {
    if (makePrivate && !confirm('Make this language private? Only owners/admins will be able to see it.')) {
      setLanguage((prev) => (prev ? { ...prev } : prev));
      return;
    }
    const patch: Partial<Language> = { visibility: makePrivate ? 'private' : 'public' };
    if (makePrivate) {
      patch.original_creation_acknowledged = true;
      patch.original_creation_acknowledged_at = new Date().toISOString();
      patch.publicly_editable = false;
    }
    const { error: err } = await supabase.from('languages').update(patch).eq('id', languageId);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function setPubliclyEditable(val: boolean) {
    const { error: err } = await supabase.from('languages').update({ publicly_editable: val }).eq('id', languageId);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function inviteOwner() {
    if (!inviteUsername.trim()) return;
    const { data: prof, error: pErr } = await supabase.from('profiles').select('id').eq('username', inviteUsername.trim()).maybeSingle();
    if (pErr || !prof) {
      alert('No such user.');
      return;
    }
    const { error: err } = await supabase
      .from('language_ownership')
      .insert({ language_id: languageId, user_id: prof.id, status: 'invited', invited_by: userId });
    if (err) {
      alert(err.message);
      return;
    }
    setInviteUsername('');
    reload();
  }

  async function requestOwnership() {
    const { error: err } = await supabase.from('language_ownership').insert({ language_id: languageId, user_id: userId, status: 'requested' });
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function approveRequest(rowId: string) {
    const { error: err } = await supabase.from('language_ownership').update({ status: 'owner' }).eq('id', rowId);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function removeOwnership(rowId: string) {
    const { error: err } = await supabase.from('language_ownership').delete().eq('id', rowId);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function searchParentCandidates(term: string) {
    setParentSearch(term);
    if (!term) {
      setParentCandidates([]);
      return;
    }
    const { data } = await supabase.from('languages').select('id,name').ilike('name', `%${term}%`).neq('id', languageId).limit(10);
    setParentCandidates(data || []);
  }

  async function addParent(parentId: string) {
    const { error: err } = await supabase.from('language_genealogy').insert({
      child_language_id: languageId,
      parent_language_id: parentId,
      is_primary: parentPrimary,
      confidence: parentConfidence,
      created_by: userId,
    });
    if (err) {
      alert(err.message);
      return;
    }
    setParentSearch('');
    setParentCandidates([]);
    reload();
  }

  async function removeGenealogyEdge(edgeId: string) {
    const { error: err } = await supabase.from('language_genealogy').delete().eq('id', edgeId);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  async function addLexeme() {
    if (!newWordForm.trim()) return;
    const { error: err } = await supabase.from('lexemes').insert({
      language_id: languageId,
      form: newWordForm.trim(),
      transcription: newWordTranscription.trim() || null,
      gloss: newWordGloss.trim() || null,
      created_by: userId,
    });
    if (err) {
      alert(err.message);
      return;
    }
    setNewWordForm('');
    setNewWordTranscription('');
    setNewWordGloss('');
    reload();
  }

  async function deleteLexeme(id: string) {
    if (!confirm('Delete this lexeme?')) return;
    const { error: err } = await supabase.from('lexemes').delete().eq('id', id);
    if (err) {
      alert(err.message);
      return;
    }
    reload();
  }

  return (
    <div>
      <div className="view-title">
        {language.name}
        <span className="badge">
          {language.is_constructed ? 'constructed' : 'natural'} · {language.visibility}
        </span>
      </div>
      <div className="view-subtitle">
        {language.family_name ? `Family: ${language.family_name} · ` : ''}
        {language.slug}
      </div>

      {language.is_constructed && (
        <div className="section">
          <div className="section-label">Owners</div>
          {ownership
            .filter((o) => o.status === 'owner')
            .map((o) => (
              <span key={o.id} className="chip">
                {usernameById[o.user_id] || o.user_id}
                {iCanGovern && (
                  <span className="x" onClick={() => removeOwnership(o.id)}>
                    ✕
                  </span>
                )}
              </span>
            ))}
          {ownership
            .filter((o) => o.status === 'invited')
            .map((o) => (
              <span key={o.id} className="chip dim">
                {usernameById[o.user_id] || o.user_id} (invited)
                {iCanGovern && (
                  <span className="x" onClick={() => removeOwnership(o.id)}>
                    ✕
                  </span>
                )}
              </span>
            ))}
          {ownership
            .filter((o) => o.status === 'requested')
            .map((o) => (
              <span key={o.id} className="chip requested">
                {usernameById[o.user_id] || o.user_id} (requested)
                {iCanGovern && (
                  <>
                    <span className="x approve" onClick={() => approveRequest(o.id)}>
                      ✓ approve
                    </span>
                    <span className="x" onClick={() => removeOwnership(o.id)}>
                      ✕
                    </span>
                  </>
                )}
              </span>
            ))}
          <div className="form-row">
            {iCanGovern && (
              <>
                <input
                  className="text-input narrow"
                  placeholder="invite by username"
                  value={inviteUsername}
                  onChange={(e) => setInviteUsername(e.target.value)}
                />
                <button className="btn secondary" onClick={inviteOwner}>
                  Invite
                </button>
              </>
            )}
            {!myRow && language.visibility === 'public' && (
              <button className="btn secondary" onClick={requestOwnership}>
                Request ownership
              </button>
            )}
            {myRow?.status === 'owner' && (
              <button className="btn secondary danger" onClick={() => removeOwnership(myRow.id)}>
                Leave
              </button>
            )}
          </div>
        </div>
      )}

      {language.is_constructed && iCanGovern && (
        <div className="section">
          <div className="section-label">Governance</div>
          <div className="form-row">
            <label className="checkbox-label inline">
              <input type="checkbox" checked={language.visibility === 'private'} onChange={(e) => setVisibility(e.target.checked)} /> Private
            </label>
            {language.visibility === 'public' && (
              <label className="checkbox-label inline">
                <input type="checkbox" checked={language.publicly_editable} onChange={(e) => setPubliclyEditable(e.target.checked)} /> Open to
                public editing
              </label>
            )}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-label">Parent languages</div>
        {parentEdges.map((e) => (
          <span key={e.id} className={'chip' + (e.is_primary ? ' primary' : '')} onClick={() => navigate(`/languages/${e.parent_language_id}`)}>
            {langNameById[e.parent_language_id] || '…'} {e.is_primary ? '(primary)' : `(${e.confidence})`}
            {iCanGovern && (
              <span
                className="x"
                onClick={(ev) => {
                  ev.stopPropagation();
                  removeGenealogyEdge(e.id);
                }}
              >
                ✕
              </span>
            )}
          </span>
        ))}
        {!parentEdges.length && <span className="hint">No parents recorded — this is a root.</span>}
        {iCanGovern && (
          <div className="form-row" style={{ marginTop: '0.5rem' }}>
            <input
              className="text-input narrow"
              placeholder="search languages to add as parent..."
              value={parentSearch}
              onChange={(e) => searchParentCandidates(e.target.value)}
            />
            <select value={parentConfidence} onChange={(e) => setParentConfidence(e.target.value as Confidence)}>
              <option value="attested">attested</option>
              <option value="probable">probable</option>
              <option value="hypothetical">hypothetical</option>
              <option value="disputed">disputed</option>
            </select>
            <label className="checkbox-label inline">
              <input type="checkbox" checked={parentPrimary} onChange={(e) => setParentPrimary(e.target.checked)} /> primary
            </label>
          </div>
        )}
        {parentCandidates.map((c) => (
          <span key={c.id} className="chip" onClick={() => addParent(c.id)}>
            {c.name}
          </span>
        ))}
      </div>

      <div className="section">
        <div className="section-label">Descendant languages</div>
        {childEdges.map((e) => (
          <span key={e.id} className={'chip' + (e.is_primary ? ' primary' : '')} onClick={() => navigate(`/languages/${e.child_language_id}`)}>
            {langNameById[e.child_language_id] || '…'} {e.is_primary ? '(primary)' : `(${e.confidence})`}
          </span>
        ))}
        {!childEdges.length && <span className="hint">None yet.</span>}
      </div>

      <div className="section">
        <div className="section-label">Vocabulary contribution</div>
        {!showVocab ? (
          <button className="btn secondary" onClick={() => setShowVocab(true)}>
            Show contribution chart
          </button>
        ) : (
          <GenealogyDisplay language={language} parentEdges={parentEdges} />
        )}
      </div>

      <div className="section">
        <div className="section-label">Lexemes ({lexemes.length})</div>
        <div className="row-list">
          {lexemes.map((w) => (
            <div key={w.id} className="row-item" onClick={() => navigate(`/lexemes/${w.id}`)}>
              <div className="row-main">
                {w.form} <span className="row-sub">{w.gloss || ''}</span>
              </div>
              {iCanEditContent && (
                <span
                  className="row-remove"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    deleteLexeme(w.id);
                  }}
                >
                  delete
                </span>
              )}
            </div>
          ))}
        </div>
        {iCanEditContent && (
          <div className="form-row" style={{ marginTop: '0.75rem' }}>
            <input className="text-input narrow" placeholder="word" value={newWordForm} onChange={(e) => setNewWordForm(e.target.value)} />
            <input
              className="text-input narrow"
              placeholder="/transcription/"
              value={newWordTranscription}
              onChange={(e) => setNewWordTranscription(e.target.value)}
            />
            <input className="text-input" placeholder="gloss / meaning" value={newWordGloss} onChange={(e) => setNewWordGloss(e.target.value)} />
            <button className="btn secondary" onClick={addLexeme}>
              + Add lexeme
            </button>
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-label">Public edit history</div>
        <div className="hint">Not wired up yet — revision writes need a trusted server-side function (schema's ready; see migration 0001).</div>
      </div>
    </div>
  );
}
