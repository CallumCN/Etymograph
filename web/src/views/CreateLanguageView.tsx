import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { createMainDisplaysForLanguage } from '../lib/displays';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function CreateLanguageView({ userId }: { userId: string }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState(() => randomId());
  const [familyName, setFamilyName] = useState('');
  const [kind, setKind] = useState<'natural' | 'constructed'>('natural');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [ack, setAck] = useState(false);
  const [publiclyEditable, setPubliclyEditable] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    const finalSlug = slugify(slug);
    if (!finalSlug) {
      setError('Id is required.');
      return;
    }

    const { data: clash } = await supabase.from('languages').select('id').eq('slug', finalSlug).maybeSingle();
    if (clash) {
      setError('That id is already taken — choose another.');
      return;
    }

    const isConstructed = kind === 'constructed';
    let vis: 'public' | 'private' = 'public';
    let editable = false;
    let acknowledged = false;

    if (isConstructed) {
      vis = visibility;
      if (vis === 'private') {
        if (!ack) {
          setError("Private constructed languages require the authorship acknowledgment.");
          return;
        }
        acknowledged = true;
      } else {
        editable = publiclyEditable;
      }
    }

    const { data: lang, error: insertError } = await supabase
      .from('languages')
      .insert({
        name,
        slug: finalSlug,
        is_constructed: isConstructed,
        visibility: vis,
        publicly_editable: editable,
        family_name: familyName.trim() || null,
        original_creation_acknowledged: acknowledged,
        original_creation_acknowledged_at: acknowledged ? new Date().toISOString() : null,
        created_by: userId,
      })
      .select()
      .single();

    if (insertError || !lang) {
      setError(insertError?.code === '23505' ? 'That id is already taken — choose another.' : insertError?.message || 'Could not create language.');
      return;
    }

    if (isConstructed) {
      const { error: ownErr } = await supabase
        .from('language_ownership')
        .insert({ language_id: lang.id, user_id: userId, status: 'owner' });
      if (ownErr) console.error(ownErr);
    }

    await createMainDisplaysForLanguage(lang.id, lang.name, userId, vis);

    navigate(`/languages/${lang.id}`);
  }

  return (
    <div>
      <h2 className="view-title">New language</h2>
      <div className="form-group">
        <label>Name</label>
        <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Old Marish" />
      </div>
      <div className="form-group">
        <label>Id <span className="hint-inline">(a random one is suggested — customize it if you like)</span></label>
        <input className="text-input" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
      </div>
      <div className="form-group">
        <label>
          Family name <span className="hint-inline">(optional — only meaningful if this is a root with no parent)</span>
        </label>
        <input className="text-input" value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="e.g. Marish" />
      </div>
      <div className="form-group">
        <label>Type</label>
        <label className="radio-label">
          <input type="radio" checked={kind === 'natural'} onChange={() => setKind('natural')} /> Natural
        </label>
        <label className="radio-label">
          <input type="radio" checked={kind === 'constructed'} onChange={() => setKind('constructed')} /> Constructed
        </label>
        <div className="hint">Natural languages are always public, with open editing. Constructed languages are yours to configure.</div>
      </div>
      {kind === 'constructed' && (
        <div className="form-group">
          <label>Visibility</label>
          <label className="radio-label">
            <input type="radio" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Public
          </label>
          <label className="radio-label">
            <input type="radio" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Private
          </label>
          {visibility === 'private' ? (
            <label className="checkbox-label">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>
                I am the creator of this constructed language, or am acting with the creator's authorization, and I'm
                choosing to keep it private.
              </span>
            </label>
          ) : (
            <label className="checkbox-label">
              <input type="checkbox" checked={publiclyEditable} onChange={(e) => setPubliclyEditable(e.target.checked)} />
              <span>Allow other signed-in users to edit this language's lexemes directly (you can turn this off again later).</span>
            </label>
          )}
        </div>
      )}
      <div className="err">{error}</div>
      <div className="form-row">
        <button className="btn" onClick={submit}>
          Create
        </button>
        <button className="btn secondary" onClick={() => navigate('/')}>
          Cancel
        </button>
      </div>
    </div>
  );
}
