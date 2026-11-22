import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import Popup from '../components/Popup';
import type { Display, Language, Profile } from '../types';

type Tab = 'users' | 'languages' | 'displays';
type BandPanel = 'followedUsers' | 'lexicons' | 'savedLexicons' | 'displays' | 'savedDisplays' | null;

interface Item {
  id: string;
  title: string;
  subtitle: string;
  route: string;
}

const BAND_ITEMS: { key: Exclude<BandPanel, null>; label: string }[] = [
  { key: 'followedUsers', label: 'Followed users' },
  { key: 'lexicons', label: "My lexicons" },
  { key: 'savedLexicons', label: 'Saved lexicons' },
  { key: 'displays', label: 'My displays' },
  { key: 'savedDisplays', label: 'Saved displays' },
];

export default function BrowsePage({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('languages');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [openBandPanel, setOpenBandPanel] = useState<BandPanel>(null);
  const [bandItems, setBandItems] = useState<Item[]>([]);
  const [bandError, setBandError] = useState<string | null>(null);
  const [bandLoading, setBandLoading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (tab === 'languages') {
        let q = supabase.from('languages').select('*').order('name').limit(60);
        if (term) q = q.ilike('name', `%${term}%`);
        const { data } = await q;
        if (!active) return;
        setItems(
          (data || []).map((l: Language) => ({
            id: l.id,
            title: l.name,
            subtitle: `${l.is_constructed ? 'constructed' : 'natural'} · ${l.visibility}`,
            route: `/languages/${l.id}`,
          }))
        );
      } else if (tab === 'users') {
        let q = supabase.from('profiles').select('*').order('username').limit(60);
        if (term) q = q.ilike('username', `%${term}%`);
        const { data } = await q;
        if (!active) return;
        setItems(
          (data || []).map((p: Profile) => ({
            id: p.id,
            title: p.display_name || p.username,
            subtitle: `@${p.username}`,
            route: `/users/${p.username}`,
          }))
        );
      } else {
        let q = supabase.from('displays').select('*').order('updated_at', { ascending: false }).limit(60);
        if (term) q = q.ilike('title', `%${term}%`);
        const { data } = await q;
        if (!active) return;
        setItems(
          (data || []).map((d: Display) => ({
            id: d.id,
            title: d.title,
            subtitle: d.kind === 'etymology' ? 'etymology display' : 'genealogy display',
            route: `/displays/${d.id}`,
          }))
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [tab, term]);

  async function openBand(panel: Exclude<BandPanel, null>) {
    if (openBandPanel === panel) {
      setOpenBandPanel(null);
      return;
    }
    setOpenBandPanel(panel);
    setBandLoading(true);
    const { items: loaded, error } = await loadBandItems(panel, userId);
    setBandItems(loaded);
    setBandError(error);
    setBandLoading(false);
  }

  return (
    <div className="browse-page">
      <div className="band">
        {BAND_ITEMS.map((b) => (
          <div key={b.key} className="band-anchor">
            <div className="band-rect" onClick={() => openBand(b.key)}>
              {b.label}
            </div>
            {openBandPanel === b.key && (
              <Popup align="left" onClose={() => setOpenBandPanel(null)}>
                {bandLoading ? (
                  <div className="hint popup-row">Loading…</div>
                ) : bandError ? (
                  <div className="err popup-row">{bandError}</div>
                ) : bandItems.length ? (
                  bandItems.map((it) => (
                    <div
                      key={it.id}
                      className="popup-row"
                      onClick={() => {
                        navigate(it.route);
                        setOpenBandPanel(null);
                      }}
                    >
                      <strong>{it.title}</strong> <span className="row-sub">{it.subtitle}</span>
                    </div>
                  ))
                ) : (
                  <div className="hint popup-row">Nothing here yet.</div>
                )}
              </Popup>
            )}
          </div>
        ))}
      </div>

      <div className="category-switch">
        {(['users', 'languages', 'displays'] as Tab[]).map((t) => (
          <span key={t} className={'category-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </span>
        ))}
      </div>

      <input className="search-input browse-search" placeholder={`search ${tab}...`} value={term} onChange={(e) => setTerm(e.target.value)} />

      {tab === 'languages' && (
        <div className="form-row" style={{ margin: '0.75rem 0' }}>
          <button className="btn secondary" onClick={() => navigate('/languages/new')}>
            + New language
          </button>
        </div>
      )}

      <div className={term ? 'items-list' : 'items-grid'}>
        {items.map((it) => (
          <div key={it.id} className={term ? 'item-row' : 'item-card'} onClick={() => navigate(it.route)}>
            <div className="item-title">{it.title}</div>
            <div className="item-subtitle">{it.subtitle}</div>
          </div>
        ))}
        {!items.length && <div className="hint">Nothing found.</div>}
      </div>
    </div>
  );
}

async function loadBandItems(panel: Exclude<BandPanel, null>, userId: string): Promise<{ items: Item[]; error: string | null }> {
  if (panel === 'followedUsers') {
    const { data: rows, error: e1 } = await supabase.from('follows').select('followee_id').eq('follower_id', userId);
    if (e1) return { items: [], error: e1.message };
    const ids = (rows || []).map((r) => r.followee_id);
    if (!ids.length) return { items: [], error: null };
    const { data: profs, error: e2 } = await supabase.from('profiles').select('*').in('id', ids);
    if (e2) return { items: [], error: e2.message };
    return {
      items: (profs || []).map((p: Profile) => ({ id: p.id, title: p.display_name || p.username, subtitle: `@${p.username}`, route: `/users/${p.username}` })),
      error: null,
    };
  }
  if (panel === 'lexicons' || panel === 'savedLexicons') {
    const ownedQuery =
      panel === 'lexicons'
        ? supabase.from('language_ownership').select('language_id').eq('user_id', userId).eq('status', 'owner')
        : supabase.from('saved_languages').select('language_id').eq('user_id', userId);
    const { data: rows, error: e1 } = await ownedQuery;
    if (e1) return { items: [], error: e1.message };
    const ids = (rows || []).map((r) => r.language_id);
    if (!ids.length) return { items: [], error: null };
    const { data: langs, error: e2 } = await supabase.from('languages').select('*').in('id', ids);
    if (e2) return { items: [], error: e2.message };
    return {
      items: (langs || []).map((l: Language) => ({ id: l.id, title: l.name, subtitle: l.is_constructed ? 'constructed' : 'natural', route: `/languages/${l.id}` })),
      error: null,
    };
  }
  if (panel === 'displays') {
    const { data: displays, error } = await supabase.from('displays').select('*').eq('owner_id', userId);
    if (error) return { items: [], error: error.message };
    return { items: (displays || []).map((d: Display) => ({ id: d.id, title: d.title, subtitle: d.kind, route: `/displays/${d.id}` })), error: null };
  }
  // savedDisplays
  const { data: rows, error: e1 } = await supabase.from('saved_displays').select('display_id').eq('user_id', userId);
  if (e1) return { items: [], error: e1.message };
  const ids = (rows || []).map((r) => r.display_id);
  if (!ids.length) return { items: [], error: null };
  const { data: displays, error: e2 } = await supabase.from('displays').select('*').in('id', ids);
  if (e2) return { items: [], error: e2.message };
  return { items: (displays || []).map((d: Display) => ({ id: d.id, title: d.title, subtitle: d.kind, route: `/displays/${d.id}` })), error: null };
}
