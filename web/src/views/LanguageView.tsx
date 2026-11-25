import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { fetchMainDisplays } from '../lib/displays';
import GenealogyDisplay from './GenealogyDisplay';
import LanguageEtymologyDisplay from './LanguageEtymologyDisplay';
import type { Confidence, Display, Language, LanguageGenealogyEdge, LanguageOwnership, Lexeme } from '../types';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Blank lexemes (no form text — shouldn't normally happen given the add
// form requires one, but can via direct API/import use) sort after every
// real entry instead of first, which is where an empty string would
// otherwise land alphabetically.
function sortLexemes(lexemes: Lexeme[]): Lexeme[] {
  return [...lexemes].sort((a, b) => {
    const aBlank = !a.form.trim();
    const bBlank = !b.form.trim();
    if (aBlank !== bBlank) return aBlank ? 1 : -1;
    return a.form.localeCompare(b.form);
  });
}

export default function LanguageView({ languageId, userId }: { languageId: string; userId: string }) {
  const [language, setLanguage] = useState<Language | null>(null);
  const [ownership, setOwnership] = useState<LanguageOwnership[]>([]);
  const [parentEdges, setParentEdges] = useState<LanguageGenealogyEdge[]>([]);
  const [childEdges, setChildEdges] = useState<LanguageGenealogyEdge[]>([]);
  const [lexemes, setLexemes] = useState<Lexeme[]>([]);
  const [mainDisplays, setMainDisplays] = useState<{ genealogy: Display | null; etymology: Display | null }>({ genealogy: null, etymology: null });
  const [langNameById, setLangNameById] = useState<Record<string, string>>({});
  const [usernameById, setUsernameById] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [renameError, setRenameError] = useState('');

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
    setEditName(lang.name);
    setEditSlug(lang.slug);

    const [{ data: own }, { data: parents }, { data: children }, { data: words }] = await Promise.all([
      supabase.from('language_ownership').select('*').eq('language_id', languageId),
      supabase.from('language_genealogy').select('*').eq('child_language_id', languageId),
      supabase.from('language_genealogy').select('*').eq('parent_language_id', languageId),
      supabase.from('lexemes').select('*').eq('language_id', languageId),
    ]);
    setOwnership(own || []);
    setParentEdges(parents || []);
    setChildEdges(children || []);
    setLexemes(sortLexemes(words || []));
    setMainDisplays(await fetchMainDisplays(languageId));

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

    const { data: saved } = await supabase.from('saved_languages').select('*').eq('user_id', userId).eq('language_id', languageId).maybeSingle();
    setIsSaved(!!saved);
  }, [languageId, userId]);

  useEffect(() => {
    setEditing(false);
    reload();
  }, [reload]);

  async function toggleSaved() {
    if (isSaved) {
      await supabase.from('saved_languages').delete().eq('user_id', userId).eq('language_id', languageId);
    } else {
      await supabase.from('saved_languages').insert({ user_id: userId, language_id: languageId });
    }
    setIsSaved(!isSaved);
  }

  if (error) return <div className="err">{error}</div>;
  if (!language) return <div className="hint">Loading…</div>;

  const myRow = ownership.find((o) => o.user_id === userId);
  const iCanGovern = !!myRow && myRow.status === 'owner';
  const iCanEditContent = !language.is_constructed || iCanGovern || (language.visibility === 'public' && language.publicly_editable);
  const canEdit = iCanGovern || iCanEditContent;

  async function saveRename() {
    if (!language) return;
    const name = editName.trim();
    const slug = slugify(editSlug);
    if (!name) {
      setRenameError('Name is required.');
      return;
    }
    if (!slug) {
      setRenameError('Id is required.');
      return;
    }
    if (slug !== language.slug) {
      const { data: clash } = await supabase.from('languages').select('id').eq('slug', slug).neq('id', languageId).maybeSingle();
      if (clash) {
        setRenameError('That id is already taken — choose another.');
        return;
      }
    }
    const { error: err } = await supabase.from('languages').update({ name, slug }).eq('id', languageId);
    if (err) {
      setRenameError(err.code === '23505' ? 'That id is already taken — choose another.' : err.message);
      return;
    }
    setRenameError('');
    reload();
  }

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

  // Kept reachable whenever the viewer already has an ownership row,
  // regardless of the language's *current* is_constructed value — so
  // converting constructed -> natural (which hides the Owners/Governance
  // sections, since those only render for constructed languages) doesn't
  // strand the owner without a way to convert back. Their ownership row
  // is never deleted by this, just temporarily moot while it's natural.
  async function setIsConstructed(makeConstructed: boolean) {
    if (!makeConstructed) {
      if (
        !confirm(
          'Convert this to a natural language? It becomes public and open to editing by anyone — you can convert it back later.'
        )
      ) {
        return;
      }
      const { error: err } = await supabase
        .from('languages')
        .update({ is_constructed: false, visibility: 'public', publicly_editable: false })
        .eq('id', languageId);
      if (err) {
        alert(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from('languages').update({ is_constructed: true }).eq('id', languageId);
      if (err) {
        alert(err.message);
        return;
      }
    }
    reload();
  }

  async function deleteLanguage() {
    if (
      !confirm(
        `Delete "${language?.name}"? This permanently removes all its lexemes, etymologies, genealogy links, and displays. This cannot be undone.`
      )
    ) {
      return;
    }
    const { error: err } = await supabase.from('languages').delete().eq('id', languageId);
    if (err) {
      alert(err.message);
      return;
    }
    navigate('/');
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

      <div className="form-row" style={{ marginBottom: '1.5rem' }}>
        {canEdit && (
          <button className="btn secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done editing' : 'Edit'}
          </button>
        )}
        {!iCanGovern && (
          <button className="btn secondary" onClick={toggleSaved}>
            {isSaved ? 'Unsave' : 'Save'} language
          </button>
        )}
      </div>

      {editing && iCanGovern && (
        <div className="section">
          <div className="section-label">Rename</div>
          <div className="form-group">
            <label>Title</label>
            <input className="text-input" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Id</label>
            <input className="text-input" value={editSlug} onChange={(e) => setEditSlug(slugify(e.target.value))} />
          </div>
          <div className="err">{renameError}</div>
          <button className="btn secondary" onClick={saveRename}>
            Save title &amp; id
          </button>
        </div>
      )}

      {editing && iCanGovern && (
        <div className="section">
          <div className="section-label">Language type</div>
          <label className="checkbox-label inline">
            <input type="checkbox" checked={language.is_constructed} onChange={(e) => setIsConstructed(e.target.checked)} /> Constructed
          </label>
          <div className="hint">Unchecking this makes it a natural language: always public, open to editing by anyone.</div>
        </div>
      )}

      {language.is_constructed && (
        <div className="section">
          <div className="section-label">Owners</div>
          {ownership
            .filter((o) => o.status === 'owner')
            .map((o) => (
              <span key={o.id} className="chip">
                {usernameById[o.user_id] || o.user_id}
                {editing && iCanGovern && (
                  <span className="x" onClick={() => removeOwnership(o.id)}>
                    ✕
                  </span>
                )}
              </span>
            ))}
          {editing &&
            ownership
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
          {editing &&
            ownership
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
          {editing && (
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
          )}
        </div>
      )}

      {editing && language.is_constructed && iCanGovern && (
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
            {editing && iCanGovern && (
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
        {editing && iCanGovern && (
          <>
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
            {parentCandidates.map((c) => (
              <span key={c.id} className="chip" onClick={() => addParent(c.id)}>
                {c.name}
              </span>
            ))}
          </>
        )}
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

      {mainDisplays.genealogy && (
        <div className="section">
          <div className="section-label">Genealogy</div>
          <GenealogyDisplay language={language} parentEdges={parentEdges} display={mainDisplays.genealogy} canEdit={iCanGovern} />
          <button className="btn secondary" style={{ marginTop: '0.5rem' }} onClick={() => navigate(`/displays/${mainDisplays.genealogy!.id}`)}>
            Open full display
          </button>
        </div>
      )}

      {mainDisplays.etymology && (
        <div className="section">
          <div className="section-label">Etymology</div>
          <LanguageEtymologyDisplay display={mainDisplays.etymology} languageId={languageId} canEdit={iCanGovern} />
          <button className="btn secondary" style={{ marginTop: '0.5rem' }} onClick={() => navigate(`/displays/${mainDisplays.etymology!.id}`)}>
            Open full display
          </button>
        </div>
      )}

      <div className="section">
        <div className="section-label">Lexemes ({lexemes.length})</div>
        <div className="row-list">
          {lexemes.map((w) => (
            <div key={w.id} className="row-item" onClick={() => navigate(`/lexemes/${w.id}`)}>
              <div className="row-main">
                {w.form || <span className="hint">(blank)</span>} <span className="row-sub">{w.gloss || ''}</span>
              </div>
              {editing && iCanEditContent && (
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
        {editing && iCanEditContent && (
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

      {editing && iCanGovern && (
        <div className="section">
          <div className="section-label">Danger zone</div>
          <button className="btn secondary danger" onClick={deleteLanguage}>
            Delete language
          </button>
        </div>
      )}
    </div>
  );
}
