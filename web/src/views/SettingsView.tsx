import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { signOut } from '../lib/auth';

export default function SettingsView({ userId }: { userId: string }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || ''));
    supabase.from('profiles').select('username').eq('id', userId).maybeSingle().then(({ data }) => setUsername(data?.username || ''));
  }, [userId]);

  return (
    <div>
      <div className="view-title">Account settings</div>
      <div className="section">
        <div className="section-label">Email</div>
        <div>{email}</div>
      </div>
      <div className="section">
        <div className="section-label">Profile</div>
        <button className="btn secondary" onClick={() => navigate(`/users/${username}/edit`)}>
          Edit profile
        </button>
      </div>
      <div className="section">
        <button className="btn secondary danger" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
