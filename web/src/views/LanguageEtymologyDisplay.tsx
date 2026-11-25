import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { colorFor } from '../lib/colors';
import type { Display, Etymology, Lexeme } from '../types';

interface RawNode {
  id: string;
  form: string;
  languageId: string;
  native: boolean;
}
interface RawEdge {
  descendantId: string;
  ancestorId: string;
  ranges: { start: number; end: number }[] | null;
}
interface GraphNode {
  id: string;
  form: string;
  languageId: string;
  native: boolean;
  width: number;
  height: number;
  x: number; // center
  y: number; // center
}

const NODE_HEIGHT = 32;
const NODE_PAD_X = 10;
const NODE_GAP = 28;
const ROW_HEIGHT = 110;
const TOP_PAD = 30;
const VIEW_W = 800;
const VIEW_H = 460;

// The language-wide aggregate etymology display, rendered the way the
// original app's "fluvial" view did it: words are text-fit boxes laid out
// by generation (root ancestors at top), connected by flowing bands whose
// width at the descendant end matches exactly the character range
// (grapheme_ranges) attributed to that ancestor — not plain lines between
// circles. Node positions persist in `display.config.positions`; a node
// without a saved position (a freshly added lexeme) gets the layout
// algorithm's computed slot, while every already-positioned node keeps
// its saved spot exactly, so edits never reshuffle the whole graph.
export default function LanguageEtymologyDisplay({
  display,
  languageId,
  canEdit,
}: {
  display: Display;
  languageId: string;
  canEdit: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const measureRef = useRef<SVGTextElement>(null);
  const [rawNodes, setRawNodes] = useState<RawNode[] | null>(null);
  const [edges, setEdges] = useState<RawEdge[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [charOffsetsById, setCharOffsetsById] = useState<Record<string, number[]>>({});
  const [loaded, setLoaded] = useState(false);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const panRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: nativeLexemes } = await supabase.from('lexemes').select('*').eq('language_id', languageId);
      const nativeIds = (nativeLexemes || []).map((w: Lexeme) => w.id);

      const { data: etys } = nativeIds.length
        ? await supabase.from('etymologies').select('*').in('descendant_lexeme_id', nativeIds)
        : { data: [] as Etymology[] };

      const ancestorIds = [...new Set((etys || []).map((e) => e.ancestor_lexeme_id))].filter((id) => !nativeIds.includes(id));
      const { data: ancestorLexemes } = ancestorIds.length
        ? await supabase.from('lexemes').select('*').in('id', ancestorIds)
        : { data: [] as Lexeme[] };

      if (!active) return;

      const nativeIdSet = new Set(nativeIds);
      const allLexemes = [...(nativeLexemes || []), ...(ancestorLexemes || [])];
      setRawNodes(allLexemes.map((w) => ({ id: w.id, form: w.form, languageId: w.language_id, native: nativeIdSet.has(w.id) })));
      setEdges((etys || []).map((e) => ({ descendantId: e.descendant_lexeme_id, ancestorId: e.ancestor_lexeme_id, ranges: e.grapheme_ranges })));
    })();
    return () => {
      active = false;
    };
  }, [languageId, display.id]);

  // Layout: runs once raw data is in and the hidden measurer is mounted.
  useEffect(() => {
    if (!rawNodes || !measureRef.current) return;
    const measureEl = measureRef.current;

    function charOffsets(word: string): number[] {
      const offsets = [0];
      let cum = 0;
      for (const ch of word) {
        measureEl.textContent = ch;
        cum += measureEl.getBBox().width || 6;
        offsets.push(cum);
      }
      return offsets;
    }

    const offsetsById: Record<string, number[]> = {};
    const widthById: Record<string, number> = {};
    rawNodes.forEach((n) => {
      const offsets = n.form.length ? charOffsets(n.form) : [0, 10];
      offsetsById[n.id] = offsets;
      widthById[n.id] = offsets[offsets.length - 1] + NODE_PAD_X * 2;
    });

    const parentsOf = new Map<string, string[]>();
    edges.forEach((e) => {
      const list = parentsOf.get(e.descendantId) || [];
      list.push(e.ancestorId);
      parentsOf.set(e.descendantId, list);
    });

    const depthById = new Map<string, number>();
    function depthOf(id: string, seen: Set<string>): number {
      if (depthById.has(id)) return depthById.get(id)!;
      if (seen.has(id)) return 0; // cycle guard — shouldn't happen, DB checks for cycles
      seen.add(id);
      const parents = parentsOf.get(id) || [];
      const d = parents.length ? Math.max(...parents.map((p) => depthOf(p, seen))) + 1 : 0;
      depthById.set(id, d);
      return d;
    }
    rawNodes.forEach((n) => depthOf(n.id, new Set()));

    const rows = new Map<number, string[]>();
    rawNodes.forEach((n) => {
      const d = depthById.get(n.id)!;
      const list = rows.get(d) || [];
      list.push(n.id);
      rows.set(d, list);
    });
    const maxDepth = Math.max(0, ...rows.keys());
    const formById = Object.fromEntries(rawNodes.map((n) => [n.id, n.form]));
    const xById = new Map<string, number>();

    for (let d = 0; d <= maxDepth; d++) {
      const ids = rows.get(d) || [];
      if (d === 0) {
        ids.sort((a, b) => formById[a].localeCompare(formById[b]));
      } else {
        ids.sort((a, b) => {
          const avgX = (id: string) => {
            const parents = parentsOf.get(id) || [];
            if (!parents.length) return 0;
            return parents.reduce((s, p) => s + (xById.get(p) || 0), 0) / parents.length;
          };
          return avgX(a) - avgX(b);
        });
      }
      let cursor = 0;
      ids.forEach((id) => {
        const w = widthById[id];
        xById.set(id, cursor + w / 2);
        cursor += w + NODE_GAP;
      });
    }

    const savedPositions = (display.config.positions as Record<string, { x: number; y: number }>) || {};
    const built: GraphNode[] = rawNodes.map((n) => {
      const saved = savedPositions[n.id];
      const defaultX = xById.get(n.id)!;
      const defaultY = TOP_PAD + depthById.get(n.id)! * ROW_HEIGHT + NODE_HEIGHT / 2;
      return {
        id: n.id,
        form: n.form,
        languageId: n.languageId,
        native: n.native,
        width: widthById[n.id],
        height: NODE_HEIGHT,
        x: saved ? saved.x : defaultX,
        y: saved ? saved.y : defaultY,
      };
    });

    setCharOffsetsById(offsetsById);
    setNodes(built);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes, edges, display.id]);

  async function persistPositions(next: GraphNode[]) {
    const positions: Record<string, { x: number; y: number }> = {};
    next.forEach((n) => {
      positions[n.id] = { x: n.x, y: n.y };
    });
    await supabase.from('displays').update({ config: { ...display.config, positions } }).eq('id', display.id);
  }

  function toWorld(clientX: number, clientY: number) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }

  function onNodeDown(e: React.MouseEvent, n: GraphNode) {
    e.stopPropagation();
    if (!canEdit) {
      navigate(`/lexemes/${n.id}`);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    dragRef.current = { id: n.id, offsetX: w.x - n.x, offsetY: w.y - n.y, moved: false };
  }

  function onBackgroundDown(e: React.MouseEvent) {
    panRef.current = { startX: e.clientX, startY: e.clientY, startTx: tx, startTy: ty };
  }

  function onSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (dragRef.current) {
      const w = toWorld(e.clientX, e.clientY);
      dragRef.current.moved = true;
      const id = dragRef.current.id;
      const { offsetX, offsetY } = dragRef.current;
      setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x: w.x - offsetX, y: w.y - offsetY } : n)));
    } else if (panRef.current) {
      const { startX, startY, startTx, startTy } = panRef.current;
      setTx(startTx + (e.clientX - startX));
      setTy(startTy + (e.clientY - startY));
    }
  }

  function onSvgMouseUp() {
    if (dragRef.current) {
      const { id, moved } = dragRef.current;
      dragRef.current = null;
      if (moved) persistPositions(nodes);
      else navigate(`/lexemes/${id}`);
    }
    panRef.current = null;
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(6, Math.max(0.2, scale * factor));
    setTx(mx - (mx - tx) * (next / scale));
    setTy(my - (my - ty) * (next / scale));
    setScale(next);
  }

  function recenter() {
    setTx(0);
    setTy(0);
    setScale(1);
  }

  const bands = useMemo(() => {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const out: { key: string; d: string; color: string }[] = [];
    edges.forEach((e, i) => {
      const anc = byId[e.ancestorId];
      const desc = byId[e.descendantId];
      if (!anc || !desc) return;
      const ranges = e.ranges && e.ranges.length ? e.ranges : [{ start: 0, end: desc.form.length }];
      const offsets = charOffsetsById[desc.id];
      ranges.forEach((r, j) => {
        const descLeft = desc.x - desc.width / 2 + NODE_PAD_X;
        const tx0 = offsets ? descLeft + offsets[Math.max(0, Math.min(r.start, offsets.length - 1))] : desc.x - desc.width / 2;
        const tx1 = offsets ? descLeft + offsets[Math.max(0, Math.min(r.end, offsets.length - 1))] : desc.x + desc.width / 2;
        const ax0 = anc.x - anc.width / 2;
        const ax1 = anc.x + anc.width / 2;
        const ay = anc.y + anc.height / 2;
        const dy = desc.y - desc.height / 2;
        const midY = (ay + dy) / 2;
        out.push({
          key: `${i}-${j}`,
          color: colorFor(anc.languageId),
          d: `M${ax0},${ay} C${ax0},${midY} ${tx0},${midY} ${tx0},${dy} L${tx1},${dy} C${tx1},${midY} ${ax1},${midY} ${ax1},${ay} Z`,
        });
      });
    });
    return out;
  }, [nodes, edges, charOffsetsById]);

  return (
    <div>
      <button className="btn secondary" style={{ marginBottom: '0.5rem' }} onClick={recenter}>
        Re-center
      </button>
      <svg
        ref={svgRef}
        width={VIEW_W}
        height={VIEW_H}
        className="etymology-graph-svg"
        onMouseDown={onBackgroundDown}
        onMouseMove={onSvgMouseMove}
        onMouseUp={onSvgMouseUp}
        onMouseLeave={() => {
          dragRef.current = null;
          panRef.current = null;
        }}
        onWheel={onWheel}
      >
        <text ref={measureRef} fontSize={13} fontFamily="Cormorant Garamond, serif" style={{ opacity: 0 }} />
        {!loaded && (
          <text x={20} y={30} fontSize={12} fontFamily="DM Mono, monospace" fill="var(--ink-light)">
            Loading…
          </text>
        )}
        {rawNodes && !rawNodes.length && (
          <text x={20} y={30} fontSize={12} fontFamily="DM Mono, monospace" fill="var(--ink-light)">
            No lexemes yet — add some to this language to see its etymology.
          </text>
        )}
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {bands.map((b) => (
            <path key={b.key} d={b.d} fill={b.color} opacity={0.28} stroke="none" />
          ))}
          {nodes.map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.x - n.width / 2},${n.y - n.height / 2})`}
              onMouseDown={(e) => onNodeDown(e, n)}
              style={{ cursor: canEdit ? 'grab' : 'pointer' }}
            >
              <rect width={n.width} height={n.height} fill="var(--paper)" stroke={colorFor(n.languageId)} strokeWidth={n.native ? 2 : 1.5} />
              <text x={n.width / 2} y={n.height / 2 + 5} textAnchor="middle" fontSize={13} fontFamily="Cormorant Garamond, serif" fill="var(--ink)">
                {n.form}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
