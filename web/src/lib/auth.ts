import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Returns undefined while the session is still being restored, null if
// redirecting (never settles — the page is about to navigate away), or
// the signed-in user's id.
export function useSession(): string | null | undefined {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (!session) {
          window.location.replace('/auth.html');
          return;
        }
        setUserId(session.user.id);
      }
      if (event === 'SIGNED_OUT') {
        window.location.replace('/auth.html');
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return userId;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace('/auth.html');
}
