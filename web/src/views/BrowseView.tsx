import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import type { Language, Lexeme, Profile } from '../types';

type Tab = 'languages' | 'lexemes' | 'users';

export default function BrowseView() {
  const [tab, setTab] = useState<Tab>('languages');
  const [term, setTerm] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [lexemes, setLexemes] = useState<(Lexeme & { languageName?: string })[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (tab === 'languages') {
        let q = supabase.from('languages').select('*').order('name').limit(50);
        if (term) q = q.ilike('name', `%${term}%`);
        const { data } = await q;
        if (active) setLanguages(data || []);
      } else if (tab === 'lexemes') {
        let q = supabase.from('lexemes').select('*').order('form').limit(50);
        if (term) q = q.ilike('form', `%${term}%`);
        const { data } = await q;
        const langIds = [...new Set((data || []).map((l) => l.language_id))];
        const { data: langs } = langIds.length
          ? await supabase.from('languages').select('id,name').in('id', langIds)
          : { data: [] as { id: string; name: string }[] };
        const nameById = Object.fromEntries((langs || []).map((l) => [l.id, l.name]));
        if (active) setLexemes((data || []).map((l) => ({ ...l, languageName: nameById[l.language_id] })));
      } else {
        let q = supabase.from('profiles').select('*').order('username').limit(50);
        if (term) q = q.ilike('username', `%${term}%`);
        const { data } = await q;
        if (active) setUsers(data || []);
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, term]);

  return (
    <div className="browse">
      <div className="sidebar-head">
        <input
          className="search-input"
          placeholder={`search ${tab}...`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="browse-tabs">
          {(['languages', 'lexemes', 'users'] as Tab[]).map((t) => (
            <span key={t} className={'browse-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="lang-list">
        {tab === 'languages' &&
          languages.map((l) => (
            <div key={l.id} className="lang-item" onClick={() => navigate(`/languages/${l.id}`)}>
              <div className="lang-item-name">{l.name}</div>
              <div className="lang-item-meta">
                {l.is_constructed ? 'constructed' : 'natural'} · {l.visibility}
              </div>
            </div>
          ))}
        {tab === 'lexemes' &&
          lexemes.map((w) => (
            <div key={w.id} className="lang-item" onClick={() => navigate(`/lexemes/${w.id}`)}>
              <div className="lang-item-name">{w.form}</div>
              <div className="lang-item-meta">
                {w.languageName} {w.gloss ? `· ${w.gloss}` : ''}
              </div>
            </div>
          ))}
        {tab === 'users' &&
          users.map((p) => (
            <div key={p.id} className="lang-item" onClick={() => navigate(`/users/${p.username}`)}>
              <div className="lang-item-name">{p.display_name || p.username}</div>
              <div className="lang-item-meta">@{p.username}</div>
            </div>
          ))}
      </div>
      <button className="btn add-btn" onClick={() => navigate('/languages/new')}>
        + New language
      </button>
    </div>
  );
}
