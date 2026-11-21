import { useEffect, useState } from 'react';

export type Route =
  | { view: 'browse' }
  | { view: 'create-language' }
  | { view: 'language'; id: string }
  | { view: 'lexeme'; id: string }
  | { view: 'user'; username: string; edit?: boolean }
  | { view: 'display'; id: string }
  | { view: 'settings' }
  | { view: 'dms' };

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'languages' && parts[1] === 'new') return { view: 'create-language' };
  if (parts[0] === 'languages' && parts[1]) return { view: 'language', id: parts[1] };
  if (parts[0] === 'lexemes' && parts[1]) return { view: 'lexeme', id: parts[1] };
  if (parts[0] === 'users' && parts[1]) return { view: 'user', username: parts[1], edit: parts[2] === 'edit' };
  if (parts[0] === 'displays' && parts[1]) return { view: 'display', id: parts[1] };
  if (parts[0] === 'settings') return { view: 'settings' };
  if (parts[0] === 'dms') return { view: 'dms' };
  return { view: 'browse' };
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}
