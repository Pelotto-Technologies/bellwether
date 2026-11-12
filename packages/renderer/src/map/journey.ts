import { tileToWorld, type Pt } from './layout.js';
import { legPlan } from './ride.js';
import { routeTiles, type RoadGraph } from './roads.js';

/**
 * Couriers: when a member of one party speaks to a member of another, the speaker travels along the roads to the
 * listener's camp, settlement or the fleet hub, the line shows when it arrives, and it walks back home. This is the
 * pure planner: it queues and merges trips, orders their stops, scales the pace to the distance and caps the total. It
 * owns no art and no clock; the scene feeds it scene time and reads positions back.
 */

/** At most this many stops in one trip; more messages are delivered as plain bubbles at home. */
export const MAX_STOPS = 6;
/** The speaker waits this long at home before setting out, so messages sent together share one trip. */
export const DEPART_DELAY = 0.5;
/** How long the traveller stays at a stop, so the line can be read where the listener is. */
export const DWELL = 1.8;
/** A whole trip takes this long at the most; what is left is delivered at once and the traveller heads home. */
export const TRIP_CAP = 20;

export interface Place {
  /** A road node: settlement, camp or hub. */
  node: string;
  /** Where in the world the traveller stands there (feet). */
  pt: Pt;
}

type Hop = { kind: 'hop'; path: Pt[]; cum: number[]; len: number; t0: number; t1: number };
type Dwell = { kind: 'dwell'; place: Place; t0: number; t1: number; msgs: number[]; fired: boolean };
type Seg = Hop | Dwell;
interface Stop {
  place: Place;
  msgs: number[];
}

interface Trip {
  home: Place;
  /** Stops not yet delivered. */
  stops: Stop[];
  /** Stops ever added, delivered ones included, for the per-trip limit. */
  stopCount: number;
  segs: Seg[];
  /** When the first hop starts (or will). */
  departAt: number;
  /** Messages to deliver at the next update without travelling. */
  outbox: number[];
}

export interface Delivery {
  traveller: string;
  /** The id the message was pushed with. */
  id: number;
  /** Delivered without reaching its listener: over the time cap, or the trip changed. */
  immediate: boolean;
}

export interface TravelPose {
  x: number;
  y: number;
  dir: 1 | -1;
  /** On a hop (as opposed to standing at a stop). */
  moving: boolean;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function hop(path: Pt[], t0: number, secs: number): Hop {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + dist(path[i - 1]!, path[i]!));
  return { kind: 'hop', path, cum, len: cum[cum.length - 1]!, t0, t1: t0 + secs };
}

/** Where along a hop (0..len px) the traveller is, and which way it faces: the last sideways direction it took, else the next one. */
function onHop(h: Hop, d: number): TravelPose {
  let i = 1;
  while (i < h.path.length - 1 && h.cum[i]! < d) i++;
  const a = h.path[i - 1]!;
  const b = h.path[i]!;
  const segLen = h.cum[i]! - h.cum[i - 1]!;
  const f = segLen > 0 ? Math.min(1, Math.max(0, (d - h.cum[i - 1]!) / segLen)) : 1;
  let dir: 1 | -1 | 0 = 0;
  for (let j = i; j >= 1 && !dir; j--) {
    const dx = h.path[j]!.x - h.path[j - 1]!.x;
    if (Math.abs(dx) > 0.01) dir = dx > 0 ? 1 : -1;
  }
  for (let j = i + 1; j < h.path.length && !dir; j++) {
    const dx = h.path[j]!.x - h.path[j - 1]!.x;
    if (Math.abs(dx) > 0.01) dir = dx > 0 ? 1 : -1;
  }
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dir: dir || 1, moving: true };
}

export class JourneyBoard {
  private trips = new Map<string, Trip>();

  constructor(private roads: RoadGraph) {}

  /** The road network changed (a settlement came or went); trips under way keep the paths they were planned with. */
  setRoads(roads: RoadGraph): void {
    this.roads = roads;
  }

  reset(): void {
    this.trips.clear();
  }

  drop(traveller: string): void {
    this.trips.delete(traveller);
  }

  /** The polyline of a leg between two places along the roads, from the exact spot to the exact spot. */
  private leg(a: Place, b: Place): Pt[] {
    // Two places at one node (the traveller is already there) are joined directly, not by a trip to the road and back.
    const tiles = a.node === b.node ? [] : routeTiles(this.roads, a.node, b.node);
    const pts: Pt[] = [a.pt, ...(tiles ?? []).map(tileToWorld), b.pt];
    return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 0.01);
  }

  private legLen(a: Place, b: Place): number {
    const p = this.leg(a, b);
    let n = 0;
    for (let i = 1; i < p.length; i++) n += dist(p[i - 1]!, p[i]!);
    return n;
  }

  /** The order of stops that keeps the whole path, home included, shortest. Few stops, so every order is tried. */
  private order(at: Place, stops: Stop[], home: Place): Stop[] {
    const list = [...stops].sort((a, b) => a.place.node.localeCompare(b.place.node));
    if (list.length < 2) return list;
    const memo = new Map<string, number>();
    const d = (a: Place, b: Place) => {
      const k = `${a.node}>${b.node}`;
      let v = memo.get(k);
      if (v === undefined) memo.set(k, (v = this.legLen(a, b)));
      return v;
    };
    let best = list;
    let bestCost = Infinity;
    const walk = (rest: Stop[], chosen: Stop[], cost: number, cur: Place) => {
      if (cost >= bestCost) return;
      if (!rest.length) {
        const total = cost + d(cur, home);
        if (total < bestCost) {
          bestCost = total;
          best = chosen;
        }
        return;
      }
      rest.forEach((s, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...chosen, s], cost + d(cur, s.place), s.place));
    };
    walk(list, [], 0, at);
    return best;
  }

  /** Schedules the remaining stops from `at` at time `t`, then home. Stops that would break the time cap become `immediate`. */
  private schedule(trip: Trip, at: Place, t: number, tripStart: number): { segs: Seg[]; immediate: number[] } {
    const segs: Seg[] = [];
    const immediate: number[] = [];
    let cur = at;
    let time = t;
    const ordered = this.order(at, trip.stops, trip.home);
    for (let i = 0; i < ordered.length; i++) {
      const stop = ordered[i]!;
      const path = this.leg(cur, stop.place);
      const len = path.slice(1).reduce((n, p, j) => n + dist(path[j]!, p), 0);
      const secs = legPlan(len).secs;
      const back = legPlan(this.legLen(stop.place, trip.home)).secs;
      if (time + secs + DWELL + back - tripStart > TRIP_CAP) {
        for (const s of ordered.slice(i)) immediate.push(...s.msgs);
        break;
      }
      if (len > 0) {
        segs.push(hop(path, time, secs));
        time += secs;
      }
      segs.push({ kind: 'dwell', place: stop.place, t0: time, t1: time + DWELL, msgs: stop.msgs, fired: false });
      time += DWELL;
      cur = stop.place;
    }
    const home = this.leg(cur, trip.home);
    const len = home.slice(1).reduce((n, p, j) => n + dist(home[j]!, p), 0);
    if (len > 0) segs.push(hop(home, time, legPlan(len).secs));
    return { segs, immediate };
  }

  /**
   * Queues a message from `traveller` (standing at `home`) to `target`. Returns `'trip'` when the line will be delivered
   * on arrival (collect it from `update`), or `'plain'` when the caller should show it at the speaker right away: the
   * target is where the speaker already is, no road leads there, or the trip already has `MAX_STOPS` stops.
   */
  push(traveller: string, home: Place, target: Place, id: number, now: number): 'trip' | 'plain' {
    if (target.node === home.node) return 'plain';
    if (!this.roads.nodes.has(home.node) || !this.roads.nodes.has(target.node) || !routeTiles(this.roads, home.node, target.node)) return 'plain';
    let trip = this.trips.get(traveller);
    if (!trip) {
      trip = { home, stops: [], stopCount: 0, segs: [], departAt: now + DEPART_DELAY, outbox: [] };
      this.trips.set(traveller, trip);
    }
    const same = trip.stops.find((s) => s.place.node === target.node);
    if (same) same.msgs.push(id);
    else {
      if (trip.stopCount >= MAX_STOPS) return 'plain';
      trip.stops.push({ place: target, msgs: [id] });
      trip.stopCount++;
    }
    this.replan(trip, now);
    return 'trip';
  }

  /** Keeps what is under way (the hop or the stay in progress) and schedules everything after it again. */
  private replan(trip: Trip, now: number): void {
    const departed = trip.segs.length > 0 && trip.segs[0]!.t0 <= now;
    if (!departed) {
      const t = Math.max(now, trip.departAt);
      const { segs, immediate } = this.schedule(trip, trip.home, t, t);
      trip.segs = segs;
      this.shed(trip, immediate);
      return;
    }
    const cur = trip.segs.find((s) => now < s.t1) ?? trip.segs[trip.segs.length - 1]!;
    const idx = trip.segs.indexOf(cur);
    const keep = trip.segs.slice(0, idx + 1);
    const last = cur.kind === 'hop' ? cur.path[cur.path.length - 1]! : cur.place.pt;
    // After a hop the traveller is at the stop it was heading for (or home); stops it has not delivered yet include that one.
    const at = this.placeAfter(trip, cur, last);
    const { segs, immediate } = this.schedule(trip, at, cur.t1, trip.segs[0]!.t0);
    trip.segs = [...keep, ...segs];
    this.shed(trip, immediate);
  }

  private placeAfter(trip: Trip, seg: Seg, pt: Pt): Place {
    if (seg.kind === 'dwell') return seg.place;
    const stop = trip.stops.find((s) => dist(s.place.pt, pt) < 0.01);
    return stop ? stop.place : trip.home;
  }

  /** Stops that no longer fit are delivered as plain lines at the next update. */
  private shed(trip: Trip, immediate: number[]): void {
    if (!immediate.length) return;
    const drop = new Set(immediate);
    trip.outbox.push(...immediate);
    trip.stops = trip.stops.map((s) => ({ ...s, msgs: s.msgs.filter((m) => !drop.has(m)) })).filter((s) => s.msgs.length);
  }

  /** Delivers what has arrived (and what was shed) and retires finished trips. Call once per frame with scene time. */
  update(now: number): Delivery[] {
    const out: Delivery[] = [];
    for (const [traveller, trip] of this.trips) {
      for (const id of trip.outbox.splice(0)) out.push({ traveller, id, immediate: true });
      for (const s of trip.segs) {
        if (s.kind !== 'dwell' || s.fired || s.t0 > now) continue;
        s.fired = true;
        for (const id of s.msgs) out.push({ traveller, id, immediate: false });
        trip.stops = trip.stops.filter((st) => st.place.node !== s.place.node);
      }
      const end = trip.segs[trip.segs.length - 1]?.t1;
      if (end !== undefined && now >= end && !trip.stops.length) this.trips.delete(traveller);
      else if (!trip.segs.length && !trip.stops.length) this.trips.delete(traveller);
    }
    return out;
  }

  /** Where the traveller is while it is out. Undefined while it is at home (waiting to set out counts as home). */
  pose(traveller: string, now: number): TravelPose | undefined {
    const trip = this.trips.get(traveller);
    if (!trip || !trip.segs.length || now < trip.segs[0]!.t0) return undefined;
    const s = trip.segs.find((x) => now < x.t1);
    if (!s) return undefined;
    if (s.kind === 'dwell') return { x: s.place.pt.x, y: s.place.pt.y, dir: 1, moving: false };
    const f = (now - s.t0) / (s.t1 - s.t0);
    return onHop(s, s.len * Math.min(1, Math.max(0, f)));
  }

  /** Whether the traveller is out (on the road or at a stop): its home shows the empty-seat marker. */
  away(traveller: string, now: number): boolean {
    const trip = this.trips.get(traveller);
    return !!trip && trip.segs.length > 0 && now >= trip.segs[0]!.t0 && now < trip.segs[trip.segs.length - 1]!.t1;
  }

  /** Homes of every traveller that is out. */
  homes(now: number): { traveller: string; pt: Pt }[] {
    return [...this.trips].filter(([k]) => this.away(k, now)).map(([traveller, t]) => ({ traveller, pt: t.home.pt }));
  }

  /** Whether the traveller has a trip planned or under way. */
  busy(traveller: string): boolean {
    return this.trips.has(traveller);
  }

  /** Time the trip ends (back home), if planned. */
  endsAt(traveller: string): number | undefined {
    return this.trips.get(traveller)?.segs.at(-1)?.t1;
  }
}
