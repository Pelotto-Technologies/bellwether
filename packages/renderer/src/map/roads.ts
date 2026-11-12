import type { MapLayout, Pt } from './layout.js';

/**
 * The map's road network as a graph: camps link to their settlement, settlements chain together in a stable order, and
 * with a fleet the hub links to every settlement. One source of truth: the terrain carves these edges, and a traveller
 * routes along them, so a journey follows the paths that are drawn.
 */

export const HUB_ID = 'hub';
export const settlementNode = (key: string) => `s:${key}`;
export const campNode = (partyId: string) => `c:${partyId}`;

export interface RoadNode {
  id: string;
  tile: Pt;
}

/** A road drawn as an L: along the row of `a` to the column of `b`, then along that column. */
export interface RoadEdge {
  a: string;
  b: string;
}

export interface RoadGraph {
  nodes: Map<string, RoadNode>;
  edges: RoadEdge[];
}

/** Camp-to-settlement roads, then the settlement chain; the same order the terrain has always carved them in. */
export function baseRoads(layout: Pick<MapLayout, 'settlements' | 'camps'>): RoadGraph {
  const nodes = new Map<string, RoadNode>();
  const edges: RoadEdge[] = [];
  for (const s of layout.settlements) nodes.set(settlementNode(s.key), { id: settlementNode(s.key), tile: s.tile });
  for (const c of layout.camps.values()) {
    nodes.set(campNode(c.partyId), { id: campNode(c.partyId), tile: c.tile });
    edges.push({ a: campNode(c.partyId), b: settlementNode(c.settlementKey) });
  }
  const ordered = [...layout.settlements].sort((a, b) => a.tile.x - b.tile.x || a.tile.y - b.tile.y);
  for (let i = 1; i < ordered.length; i++) edges.push({ a: settlementNode(ordered[i - 1]!.key), b: settlementNode(ordered[i]!.key) });
  return { nodes, edges };
}

/** Every road of a layout, the hub's included when it has one. */
export function buildRoads(layout: Pick<MapLayout, 'settlements' | 'camps'> & { hub?: Pt | undefined }): RoadGraph {
  const g = baseRoads(layout);
  if (layout.hub) {
    g.nodes.set(HUB_ID, { id: HUB_ID, tile: layout.hub });
    for (const s of layout.settlements) g.edges.push({ a: HUB_ID, b: settlementNode(s.key) });
  }
  return g;
}

/** Tiles a road passes through, corners included: a, the corner, b. */
export function edgeCorners(g: RoadGraph, e: RoadEdge): Pt[] {
  const a = g.nodes.get(e.a)!.tile;
  const b = g.nodes.get(e.b)!.tile;
  return [a, { x: b.x, y: a.y }, b];
}

const len = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + Math.abs(p.x - pts[i - 1]!.x) + Math.abs(p.y - pts[i - 1]!.y) : 0), 0);

/**
 * Shortest route between two nodes along the roads, as tile corners from `from` to `to`. Undefined when either node is
 * unknown or no road links them (a node alone in the world).
 */
export function routeTiles(g: RoadGraph, from: string, to: string): Pt[] | undefined {
  if (!g.nodes.has(from) || !g.nodes.has(to)) return undefined;
  if (from === to) return [g.nodes.get(from)!.tile];
  const adj = new Map<string, { to: string; pts: Pt[] }[]>();
  const link = (a: string, b: string, pts: Pt[]) => adj.set(a, [...(adj.get(a) ?? []), { to: b, pts }]);
  for (const e of g.edges) {
    if (!g.nodes.has(e.a) || !g.nodes.has(e.b)) continue;
    const pts = edgeCorners(g, e);
    link(e.a, e.b, pts);
    link(e.b, e.a, [...pts].reverse());
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; pts: Pt[] }>();
  const open = new Set<string>([from]);
  while (open.size) {
    // Few nodes (tens), so a linear scan beats a heap; ties break on the id so the route is deterministic.
    let cur = '';
    for (const n of [...open].sort()) if (!cur || dist.get(n)! < dist.get(cur)!) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const hop of adj.get(cur) ?? []) {
      const d = dist.get(cur)! + len(hop.pts);
      if (d < (dist.get(hop.to) ?? Infinity)) {
        dist.set(hop.to, d);
        prev.set(hop.to, { node: cur, pts: hop.pts });
        open.add(hop.to);
      }
    }
  }
  if (!prev.has(to)) return undefined;
  const hops: Pt[][] = [];
  for (let n = to; n !== from; n = prev.get(n)!.node) hops.unshift(prev.get(n)!.pts);
  const out: Pt[] = [];
  for (const pts of hops) for (const p of pts) if (!out.length || out[out.length - 1]!.x !== p.x || out[out.length - 1]!.y !== p.y) out.push(p);
  return out;
}
