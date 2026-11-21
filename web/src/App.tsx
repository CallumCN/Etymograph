import { useSession } from './lib/auth';
import { useRoute } from './lib/router';
import Header from './components/Header';
import BrowsePage from './views/BrowsePage';
import CreateLanguageView from './views/CreateLanguageView';
import LanguageView from './views/LanguageView';
import LexemeView from './views/LexemeView';
import UserProfileView from './views/UserProfileView';
import DisplayView from './views/DisplayView';
import SettingsView from './views/SettingsView';
import DMView from './views/DMView';

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

  // DisplayView owns its own sidebar+canvas shell — everything else is a
  // plain page under the header.
  if (route.view === 'display') {
    return (
      <div className="app-shell">
        <Header userId={userId} />
        <DisplayView key={route.id} displayId={route.id} userId={userId} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Header userId={userId} />
      <main className="main-panel plain">
        {route.view === 'browse' && <BrowsePage userId={userId} />}
        {route.view === 'create-language' && <CreateLanguageView userId={userId} />}
        {route.view === 'language' && <LanguageView key={route.id} languageId={route.id} userId={userId} />}
        {route.view === 'lexeme' && <LexemeView key={route.id} lexemeId={route.id} userId={userId} />}
        {route.view === 'user' && (
          <UserProfileView key={route.username} username={route.username} userId={userId} initialEdit={route.edit} />
        )}
        {route.view === 'settings' && <SettingsView userId={userId} />}
        {route.view === 'dms' && <DMView />}
      </main>
    </div>
  );
}
