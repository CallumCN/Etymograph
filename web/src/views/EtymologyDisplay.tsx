import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { colorFor } from '../lib/colors';
import type { Confidence, Etymology, EtymologyRelation, GraphemeRange, Lexeme } from '../types';

interface AncestorInfo {
  lexeme: Lexeme;
  languageName: string;
  etymology: Etymology;
}

// Character-level etymon assignment: proportions here come from which
// graphemes of the descendant form are attributed to which ancestor (not
// from aggregate vocabulary counts — that's the language-genealogy
// display's job, see GenealogyDisplay).
export default function EtymologyDisplay({
  lexeme,
  userId,
  canEditContent,
}: {
  lexeme: Lexeme;
  userId: string;
  canEditContent: boolean;
}) {
  const [ancestors, setAncestors] = useState<AncestorInfo[]>([]);
  const [armedAncestorId, setArmedAncestorId] = useState<string | null>(null);
  const [charMap, setCharMap] = useState<Record<number, string>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [candidates, setCandidates] = useState<{ id: string; form: string; languageName: string }[]>([]);
  const [relationType, setRelationType] = useState<EtymologyRelation>('inherited');
  const [confidence, setConfidence] = useState<Confidence>('attested');

  const reload = useCallback(async () => {
    const { data: etys } = await supabase.from('etymologies').select('*').eq('descendant_lexeme_id', lexeme.id);
    const ancestorIds = (etys || []).map((e) => e.ancestor_lexeme_id);
    const { data: ancestorLexemes } = ancestorIds.length
      ? await supabase.from('lexemes').select('*').in('id', ancestorIds)
      : { data: [] as Lexeme[] };
    const langIds = [...new Set((ancestorLexemes || []).map((l) => l.language_id))];
    const { data: langs } = langIds.length
      ? await supabase.from('languages').select('id,name').in('id', langIds)
      : { data: [] as { id: string; name: string }[] };
    const nameById = Object.fromEntries((langs || []).map((l) => [l.id, l.name]));
    const lexById = Object.fromEntries((ancestorLexemes || []).map((l) => [l.id, l]));

    const infos: AncestorInfo[] = (etys || [])
      .filter((e) => lexById[e.ancestor_lexeme_id])
      .map((e) => ({
        lexeme: lexById[e.ancestor_lexeme_id],
        languageName: nameById[lexById[e.ancestor_lexeme_id].language_id] || '…',
        etymology: e,
      }));
    setAncestors(infos);

    const nextCharMap: Record<number, string> = {};
    (etys || []).forEach((e) =>
      (e.grapheme_ranges || []).forEach((r: GraphemeRange) => {
        for (let i = r.start; i < r.end; i++) nextCharMap[i] = e.ancestor_lexeme_id;
      })
    );
    setCharMap(nextCharMap);
  }, [lexeme.id]);

  useEffect(() => {
    setArmedAncestorId(null);
    reload();
  }, [reload]);

  function paintChar(i: number) {
    if (!armedAncestorId) return;
    setCharMap((prev) => {
      const next = { ...prev };
      if (next[i] === armedAncestorId) delete next[i];
      else next[i] = armedAncestorId;
      return next;
    });
  }

  async function saveGraphemeRanges() {
    const byAncestor: Record<string, number[]> = {};
    Object.entries(charMap).forEach(([i, anc]) => {
      (byAncestor[anc] ||= []).push(Number(i));
    });
    for (const [ancestorId, idxsRaw] of Object.entries(byAncestor)) {
      const idxs = [...idxsRaw].sort((a, b) => a - b);
      const ranges: { start: number; end: number }[] = [];
      let start = idxs[0];
      let prev = idxs[0];
      for (let k = 1; k <= idxs.length; k++) {
        if (k < idxs.length && idxs[k] === prev + 1) {
          prev = idxs[k];
          continue;
        }
        ranges.push({ start, end: prev + 1 });
        if (k < idxs.length) {
          start = idxs[k];
          prev = idxs[k];
        }
      }
      await supabase.from('etymologies').update({ grapheme_ranges: ranges }).eq('descendant_lexeme_id', lexeme.id).eq('ancestor_lexeme_id', ancestorId);
    }
    setArmedAncestorId(null);
    reload();
  }

  async function searchCandidates(term: string) {
    setSearchTerm(term);
    if (!term) {
      setCandidates([]);
      return;
    }
    const { data } = await supabase.from('lexemes').select('id,form,language_id').ilike('form', `%${term}%`).neq('id', lexeme.id).limit(10);
    const langIds = [...new Set((data || []).map((l) => l.language_id))];
    const { data: langs } = langIds.length
      ? await supabase.from('languages').select('id,name').in('id', langIds)
      : { data: [] as { id: string; name: string }[] };
    const nameById = Object.fromEntries((langs || []).map((l) => [l.id, l.name]));
    setCandidates((data || []).map((l) => ({ id: l.id, form: l.form, languageName: nameById[l.language_id] || '…' })));
  }

  async function addEtymology(ancestorId: string) {
    const { error } = await supabase.from('etymologies').insert({
      descendant_lexeme_id: lexeme.id,
      ancestor_lexeme_id: ancestorId,
      relation_type: relationType,
      confidence,
      created_by: userId,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setSearchTerm('');
    setCandidates([]);
    reload();
  }

  async function removeEtymology(id: string) {
    const { error } = await supabase.from('etymologies').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    reload();
  }

  return (
    <div className="section">
      <div className="section-label">Etymology</div>
      <div className="char-row">
        {lexeme.form.split('').map((ch, i) => {
          const anc = charMap[i];
          return (
            <span
              key={i}
              className="morph-char"
              style={anc ? { background: colorFor(anc), color: '#fff', borderColor: 'transparent' } : undefined}
              onClick={() => paintChar(i)}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div className="hint">
        {armedAncestorId ? 'Click characters to toggle them onto the armed ancestor, then Save.' : 'Click an etymon below to arm it for character painting.'}
      </div>
      <div className="row-list">
        {ancestors.map((a) => (
          <div
            key={a.etymology.id}
            className={'row-item' + (armedAncestorId === a.lexeme.id ? ' active' : '')}
            onClick={() => setArmedAncestorId(armedAncestorId === a.lexeme.id ? null : a.lexeme.id)}
          >
            <span className="swatch" style={{ background: colorFor(a.lexeme.id) }} />
            <div
              className="row-main"
              onClick={(ev) => {
                ev.stopPropagation();
                navigate(`/lexemes/${a.lexeme.id}`);
              }}
            >
              {a.lexeme.form} <span className="row-sub">({a.languageName}) · {a.etymology.relation_type} · {a.etymology.confidence}</span>
            </div>
            <span
              className="row-remove"
              onClick={(ev) => {
                ev.stopPropagation();
                removeEtymology(a.etymology.id);
              }}
            >
              remove
            </span>
          </div>
        ))}
        {!ancestors.length && <span className="hint">No etymons yet.</span>}
      </div>
      {armedAncestorId && (
        <button className="btn secondary" onClick={saveGraphemeRanges}>
          Save character assignment
        </button>
      )}
      {canEditContent && (
        <div className="form-row" style={{ marginTop: '1rem' }}>
          <input
            className="text-input narrow"
            placeholder="search any lexeme to add as ancestor..."
            value={searchTerm}
            onChange={(e) => searchCandidates(e.target.value)}
          />
          <select value={relationType} onChange={(e) => setRelationType(e.target.value as EtymologyRelation)}>
            <option>inherited</option>
            <option>borrowed</option>
            <option>calque</option>
            <option>compound</option>
            <option>derivation</option>
            <option>influenced_by</option>
          </select>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
            <option>attested</option>
            <option>probable</option>
            <option>hypothetical</option>
            <option>disputed</option>
          </select>
        </div>
      )}
      <div className="candidates">
        {candidates.map((c) => (
          <span key={c.id} className="chip" onClick={() => addEtymology(c.id)}>
            {c.form} <span className="row-sub">({c.languageName})</span>
          </span>
        ))}
      </div>
    </div>
  );
}
