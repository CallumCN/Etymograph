import { useEffect, useMemo, useRef, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, type SimulationNodeDatum } from 'd3-force';
import { supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { colorFor } from '../lib/colors';
import type { Display, Etymology, Lexeme } from '../types';

interface GraphNode extends SimulationNodeDatum {
  id: string;
  form: string;
  languageId: string;
  native: boolean;
}
interface GraphLink {
  source: string;
  target: string;
}

const WIDTH = 760;
const HEIGHT = 480;

// The language-wide aggregate etymology display: every lexeme in this
// language, plus their (possibly foreign-language) ancestors — nothing
// else. Node positions persist in `display.config.positions`; nodes
// without a saved position (freshly added lexemes) get placed near their
// linked neighbors by a small, localized simulation that leaves every
// already-positioned node fixed, rather than re-laying out the whole
// graph on every edit.
export default function LanguageEtymologyDisplay({
  display,
  languageId,
  canEdit,
}: {
  display: Display;
  languageId: string;
  canEdit: boolean;
}) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const savedPositions = (display.config.positions as Record<string, { x: number; y: number }>) || {};

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

      const allLexemes = [...(nativeLexemes || []), ...(ancestorLexemes || [])];
      const nativeIdSet = new Set(nativeIds);

      const builtNodes: GraphNode[] = allLexemes.map((w) => {
        const saved = savedPositions[w.id];
        return {
          id: w.id,
          form: w.form,
          languageId: w.language_id,
          native: nativeIdSet.has(w.id),
          x: saved?.x,
          y: saved?.y,
        };
      });
      const builtLinks: GraphLink[] = (etys || []).map((e) => ({ source: e.descendant_lexeme_id, target: e.ancestor_lexeme_id }));

      layoutNewNodes(builtNodes, builtLinks);
      setNodes(builtNodes);
      setLinks(builtLinks);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageId, display.id]);

  async function persistPositions(next: GraphNode[]) {
    const positions: Record<string, { x: number; y: number }> = {};
    next.forEach((n) => {
      if (typeof n.x === 'number' && typeof n.y === 'number') positions[n.id] = { x: n.x, y: n.y };
    });
    await supabase.from('displays').update({ config: { ...display.config, positions } }).eq('id', display.id);
  }

  function onNodeDown(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!canEdit) {
      navigate(`/lexemes/${id}`);
      return;
    }
    dragRef.current = { id, moved: false };
  }

  function onSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!canEdit || !dragRef.current) return;
    const svg = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svg.left;
    const y = e.clientY - svg.top;
    dragRef.current.moved = true;
    setNodes((prev) => prev.map((n) => (n.id === dragRef.current!.id ? { ...n, x, y } : n)));
  }

  function onSvgMouseUp() {
    if (!dragRef.current) return;
    const { id, moved } = dragRef.current;
    dragRef.current = null;
    if (moved) {
      setNodes((current) => {
        persistPositions(current);
        return current;
      });
    } else {
      navigate(`/lexemes/${id}`);
    }
  }

  const linkPaths = useMemo(() => {
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    return links
      .map((l) => ({ a: byId[l.source], b: byId[l.target] }))
      .filter((p) => p.a && p.b && typeof p.a.x === 'number' && typeof p.b.x === 'number');
  }, [nodes, links]);

  if (!loaded) return <div className="hint">Loading…</div>;
  if (!nodes.length) return <div className="hint">No lexemes yet — add some to this language to see its etymology.</div>;

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      className="etymology-graph-svg"
      onMouseMove={onSvgMouseMove}
      onMouseUp={onSvgMouseUp}
      onMouseLeave={() => (dragRef.current = null)}
    >
      {linkPaths.map((p, i) => (
        <line key={i} x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke="var(--paper-darker)" strokeWidth={1} />
      ))}
      {nodes.map((n) => (
        <g
          key={n.id}
          transform={`translate(${n.x ?? WIDTH / 2},${n.y ?? HEIGHT / 2})`}
          onMouseDown={(e) => onNodeDown(e, n.id)}
          style={{ cursor: canEdit ? 'grab' : 'pointer' }}
        >
          <circle r={n.native ? 7 : 5} fill={colorFor(n.languageId)} opacity={n.native ? 1 : 0.65} />
          <text x={10} y={4} fontSize={11} fontFamily="Cormorant Garamond, serif" fill="var(--ink)">
            {n.form}
          </text>
        </g>
      ))}
    </svg>
  );
}

// Runs a small, localized simulation that only moves nodes without a saved
// position — everything already placed stays fixed (fx/fy pinned) — so
// adding or removing lexemes never reshuffles the whole graph.
function layoutNewNodes(nodes: GraphNode[], links: GraphLink[]) {
  const unresolved = nodes.filter((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
  if (!unresolved.length) return;

  nodes.forEach((n) => {
    if (typeof n.x === 'number' && typeof n.y === 'number') {
      (n as GraphNode & { fx?: number; fy?: number }).fx = n.x;
      (n as GraphNode & { fx?: number; fy?: number }).fy = n.y;
    } else {
      n.x = WIDTH / 2 + (Math.random() - 0.5) * 40;
      n.y = HEIGHT / 2 + (Math.random() - 0.5) * 40;
    }
  });

  const sim = forceSimulation(nodes)
    .force(
      'link',
      forceLink(links as unknown as { source: string; target: string }[])
        .id((d: unknown) => (d as GraphNode).id)
        .distance(70)
    )
    .force('charge', forceManyBody().strength(-120))
    .force('collide', forceCollide(18))
    .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
    .stop();

  for (let i = 0; i < 200; i++) sim.tick();

  nodes.forEach((n) => {
    delete (n as GraphNode & { fx?: number; fy?: number }).fx;
    delete (n as GraphNode & { fx?: number; fy?: number }).fy;
  });
}
