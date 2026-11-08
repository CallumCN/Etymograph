import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import type { Language, Profile } from '../types';

export default function UserProfileView({ username, userId }: { username: string; userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ownedLanguages, setOwnedLanguages] = useState<Language[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  const reload = useCallback(async () => {
    const { data: p, error: err } = await supabase.from('profiles').select('*').eq('username', username).maybeSingle();
    if (err || !p) {
      setError('No such user.');
      return;
    }
    setError('');
    setProfile(p);
    setDisplayName(p.display_name || '');
    setBio(p.bio || '');

    const { data: own } = await supabase.from('language_ownership').select('language_id').eq('user_id', p.id).eq('status', 'owner');
    const langIds = (own || []).map((o) => o.language_id);
    const { data: langs } = langIds.length ? await supabase.from('languages').select('*').in('id', langIds) : { data: [] as Language[] };
    setOwnedLanguages(langs || []);
  }, [username]);

  useEffect(() => {
    setEditing(false);
    reload();
  }, [reload]);

  if (error) return <div className="err">{error}</div>;
  if (!profile) return <div className="hint">Loading…</div>;

  const isSelf = profile.id === userId;

  async function save() {
    const { error: err } = await supabase.from('profiles').update({ display_name: displayName || null, bio: bio || null }).eq('id', profile!.id);
    if (err) {
      alert(err.message);
      return;
    }
    setEditing(false);
    reload();
  }

  return (
    <div>
      <div className="view-title">
        {profile.display_name || profile.username}
        <span className="badge">@{profile.username}</span>
      </div>
      {!editing ? (
        <>
          <div className="view-meaning">{profile.bio || <span className="hint">No bio yet.</span>}</div>
          {isSelf && (
            <button className="btn secondary" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </>
      ) : (
        <>
          <div className="form-group">
            <label>Display name</label>
            <input className="text-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Bio</label>
            <textarea className="text-input" value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <div className="form-row">
            <button className="btn" onClick={save}>
              Save
            </button>
            <button className="btn secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}

      <div className="section">
        <div className="section-label">Languages owned</div>
        {ownedLanguages.map((l) => (
          <span key={l.id} className="chip" onClick={() => navigate(`/languages/${l.id}`)}>
            {l.name}
          </span>
        ))}
        {!ownedLanguages.length && <span className="hint">None yet.</span>}
      </div>
    </div>
  );
}
