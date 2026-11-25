import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { signOut } from '../lib/auth';
import Popup from './Popup';

interface FollowNotification {
  follower_id: string;
  created_at: string;
  username: string;
}

export default function Header({ userId }: { userId: string }) {
  const [username, setUsername] = useState('');
  const [openPanel, setOpenPanel] = useState<'notifications' | 'menu' | null>(null);
  const [followNotifications, setFollowNotifications] = useState<FollowNotification[]>([]);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setUsername(data?.username || ''));
  }, [userId]);

  async function toggleNotifications() {
    if (openPanel === 'notifications') {
      setOpenPanel(null);
      return;
    }
    setOpenPanel('notifications');
    const { data: rows } = await supabase
      .from('follows')
      .select('follower_id,created_at')
      .eq('followee_id', userId)
      .order('created_at', { ascending: false })
      .limit(15);
    const followerIds = [...new Set((rows || []).map((r) => r.follower_id))];
    const { data: profs } = followerIds.length
      ? await supabase.from('profiles').select('id,username').in('id', followerIds)
      : { data: [] as { id: string; username: string }[] };
    const nameById = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));
    setFollowNotifications((rows || []).map((r) => ({ ...r, username: nameById[r.follower_id] || r.follower_id })));
  }

  return (
    <nav className="topnav">
      <div className="icon-anchor">
        <span className="icon-btn" role="button" onClick={toggleNotifications} title="Notifications" aria-label="Notifications">
          🔔
        </span>
        {openPanel === 'notifications' && (
          <Popup align="left" onClose={() => setOpenPanel(null)}>
            <div className="popup-section-label">Follows</div>
            {followNotifications.length ? (
              followNotifications.map((f) => (
                <div
                  key={f.follower_id}
                  className="popup-row"
                  onClick={() => {
                    navigate(`/users/${f.username}`);
                    setOpenPanel(null);
                  }}
                >
                  <strong>{f.username}</strong> started following you
                </div>
              ))
            ) : (
              <div className="hint popup-row">No new follows.</div>
            )}
            <div className="popup-section-label">Comments</div>
            <div className="hint popup-row">Not implemented yet.</div>
            <div className="popup-section-label">Likes</div>
            <div className="hint popup-row">Not implemented yet.</div>
          </Popup>
        )}
      </div>

      <span className="nav-title link" onClick={() => navigate('/')}>
        Etymograph
      </span>

      <div className="icon-anchor">
        <span
          className="icon-btn"
          role="button"
          onClick={() => setOpenPanel(openPanel === 'menu' ? null : 'menu')}
          title="Menu"
          aria-label="Menu"
        >
          ☰
        </span>
        {openPanel === 'menu' && (
          <Popup align="right" onClose={() => setOpenPanel(null)}>
            <div
              className="popup-row"
              onClick={() => {
                navigate('/settings');
                setOpenPanel(null);
              }}
            >
              Account settings
            </div>
            <div
              className="popup-row"
              onClick={() => {
                navigate(`/users/${username}/edit`);
                setOpenPanel(null);
              }}
            >
              Edit profile
            </div>
            <div
              className="popup-row"
              onClick={() => {
                navigate('/dms');
                setOpenPanel(null);
              }}
            >
              Messages
            </div>
            <div className="popup-row" onClick={() => signOut()}>
              Sign out
            </div>
          </Popup>
        )}
      </div>
    </nav>
  );
}
