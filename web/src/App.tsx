import { useSession, signOut } from './lib/auth';
import { useRoute } from './lib/router';
import BrowseView from './views/BrowseView';
import CreateLanguageView from './views/CreateLanguageView';
import LanguageView from './views/LanguageView';
import LexemeView from './views/LexemeView';
import UserProfileView from './views/UserProfileView';

export default function App() {
  const userId = useSession();
  const route = useRoute();

  if (userId === undefined) {
    return <div className="auth-loading">loading…</div>;
  }
  if (!userId) {
    // useSession has already kicked off a redirect to /auth.html
    return null;
  }

  return (
    <div className="app-shell">
      <nav className="topnav">
        <div>
          <span className="nav-logo">Etymograph</span>
          <span className="nav-badge">languages prototype</span>
        </div>
        <div className="nav-right">
          <a className="link" href="/index.html">legacy lexicon</a>
          <a className="link" onClick={() => signOut()}>sign out</a>
        </div>
      </nav>
      <div className="app-body">
        <aside className="sidebar">
          <BrowseView />
        </aside>
        <main className="main-panel">
          {route.view === 'browse' && (
            <div className="empty-state">Select a language, lexeme, or user — or create a language</div>
          )}
          {route.view === 'create-language' && <CreateLanguageView userId={userId} />}
          {route.view === 'language' && <LanguageView key={route.id} languageId={route.id} userId={userId} />}
          {route.view === 'lexeme' && <LexemeView key={route.id} lexemeId={route.id} userId={userId} />}
          {route.view === 'user' && <UserProfileView key={route.username} username={route.username} userId={userId} />}
        </main>
      </div>
    </div>
  );
}
