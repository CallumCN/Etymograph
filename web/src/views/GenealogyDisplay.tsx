import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { colorFor } from '../lib/colors';
import type { Display, Language, LanguageGenealogyEdge } from '../types';

interface Row {
  id: string;
  name: string;
  count: number;
  primary: boolean;
}

interface Segment {
  id: string;
  name: string;
  count: number;
  color: string;
  x: number;
  w: number;
  isResidual?: boolean;
}

// A simplified, single-generation stand-in for a full multi-level Sankey:
// parent languages (top) flow down into this language's vocabulary
// composition (bottom bar), proportioned by how many of its lexemes trace
// directly to each source. The "unknown / unselected" share always lands
// on the right of the bottom bar, per the checklist's current selection.
export default function GenealogyDisplay({
  language,
  parentEdges,
  display,
  canEdit,
}: {
  language: Language;
  parentEdges: LanguageGenealogyEdge[];
  display: Display;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: contrib }, { data: totalsRow }] = await Promise.all([
        supabase.from('language_vocab_contribution').select('*').eq('target_language_id', language.id),
        supabase.from('language_vocab_totals').select('*').eq('language_id', language.id).maybeSingle(),
      ]);
      const t = totalsRow?.total_lexemes || 0;
      const sourceIds = (contrib || []).map((c) => c.source_language_id);
      const { data: sourceLangs } = sourceIds.length
        ? await supabase.from('languages').select('id,name').in('id', sourceIds)
        : { data: [] as { id: string; name: string }[] };
      const nameById = Object.fromEntries((sourceLangs || []).map((l) => [l.id, l.name]));
      const primaryIds = new Set(parentEdges.filter((e) => e.is_primary).map((e) => e.parent_language_id));

      const r: Row[] = (contrib || [])
        .map((c) => ({
          id: c.source_language_id,
          name: nameById[c.source_language_id] || '…',
          count: c.contributed_count,
          primary: primaryIds.has(c.source_language_id),
        }))
        .sort((a, b) => b.count - a.count);

      if (!active) return;
      setTotal(t);
      setRows(r);

      const savedSelection = display.config.selectedSources as string[] | undefined;
      if (savedSelection) {
        setChecked(new Set(savedSelection.filter((id) => r.some((row) => row.id === id))));
      } else {
        const primaryOnly = r.filter((x) => x.primary);
        setChecked(new Set((primaryOnly.length ? primaryOnly : r).map((x) => x.id)));
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language.id, parentEdges, display.id]);

  function persistSelection(next: Set<string>) {
    supabase.from('displays').update({ config: { ...display.config, selectedSources: [...next] } }).eq('id', display.id);
  }

  if (!loaded) return <div className="hint">Loading…</div>;
  if (!total) return <div className="hint">No lexemes yet.</div>;
  if (!rows.length) return <div className="hint">No etymologies pointing outside this language yet — nothing to chart.</div>;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistSelection(next);
      return next;
    });
  }

  function selectAll() {
    const next = new Set(rows.map((r) => r.id));
    setChecked(next);
    persistSelection(next);
  }

  function selectPrimaryOnly() {
    const next = new Set(rows.filter((r) => r.primary).map((r) => r.id));
    setChecked(next);
    persistSelection(next);
  }

  const plotW = 640;
  const x0 = 20;
  const topY = 20;
  const topH = 36;
  const bottomY = 160;
  const bottomH = 36;

  const selectedRows = rows.filter((r) => checked.has(r.id));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.count, 0);
  const residual = Math.max(0, total - selectedTotal);

  const segments: Segment[] = [];
  let x = x0;
  selectedRows.forEach((r) => {
    const w = plotW * (r.count / total);
    segments.push({ id: r.id, name: r.name, count: r.count, color: colorFor(r.id), x, w });
    x += w;
  });
  if (residual > 0) {
    const w = plotW * (residual / total);
    segments.push({ id: '__unknown', name: 'Unknown / unselected', count: residual, color: '#b5b8bb', x, w, isResidual: true });
  }

  return (
    <div>
      {canEdit && (
        <div className="form-row">
          <button className="btn secondary" onClick={selectAll}>
            Select all
          </button>
          <button className="btn secondary" onClick={selectPrimaryOnly}>
            Only primary parents
          </button>
        </div>
      )}
      <div className="checklist">
        {rows.map((r) => (
          <label key={r.id} className="checklist-row">
            <input type="checkbox" checked={checked.has(r.id)} disabled={!canEdit} onChange={() => toggle(r.id)} />
            <span className="swatch" style={{ background: colorFor(r.id) }} />
            <span className="link" onClick={() => navigate(`/languages/${r.id}`)}>
              {r.name}
            </span>{' '}
            {r.primary && <span className="tag">primary</span>}
            <span className="pct">{((100 * r.count) / total).toFixed(1)}%</span>
          </label>
        ))}
      </div>
      <svg width={680} height={220} style={{ marginTop: '0.75rem' }}>
        {segments.map((seg) => (
          <g key={seg.id}>
            {!seg.isResidual && (
              <>
                <rect
                  x={seg.x}
                  y={topY}
                  width={seg.w}
                  height={topH}
                  fill={seg.color}
                  stroke="#fff"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/languages/${seg.id}`)}
                />
                {seg.w > 40 && (
                  <text x={seg.x + 4} y={topY - 6} fontSize={10} fontFamily="DM Mono, monospace" fill="var(--ink-mid)">
                    {seg.name}
                  </text>
                )}
                <path
                  d={`M${seg.x},${topY + topH} C${seg.x},${(topY + topH + bottomY) / 2} ${seg.x},${(topY + topH + bottomY) / 2} ${seg.x},${bottomY}
                      L${seg.x + seg.w},${bottomY} C${seg.x + seg.w},${(topY + topH + bottomY) / 2} ${seg.x + seg.w},${(topY + topH + bottomY) / 2} ${seg.x + seg.w},${topY + topH} Z`}
                  fill={seg.color}
                  opacity={0.22}
                />
              </>
            )}
            <rect x={seg.x} y={bottomY} width={seg.w} height={bottomH} fill={seg.color} stroke="#fff" />
          </g>
        ))}
        <text x={x0} y={bottomY + bottomH + 16} fontSize={11} fontFamily="DM Mono, monospace" fill="var(--ink)">
          {language.name} — vocabulary composition
        </text>
      </svg>
    </div>
  );
}
