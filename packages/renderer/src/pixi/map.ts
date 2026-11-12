import type { Member, Party, Status, World } from '@bellwether/adapter/core';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { groupFellowships, mixHex, pickFollower, type Fellowship, type FellowshipView } from '../fellowship.js';
import type { FeedState } from '../feed.js';
import { pickPartner } from '../map/chatter.js';
import type { MapArt } from '../map/assets.js';
import { fitZoom, focusZoom, nearestParty, screenToWorld, stepCamera, type Camera } from '../map/camera.js';
import { describeParty, type DetailRow } from '../map/detail.js';
import { agentsByRepo, campSize, campSlots, pop, townSize, townSlots } from '../map/growth.js';
import { layoutMap, repoKey, settlementName, tileToWorld, TILE, type MapLayout } from '../map/layout.js';
import { buildTerrain, groundTileName } from '../map/terrain.js';
import { nextRiding, parkSpot, RIDE_SPEED, summonPlan } from '../map/ride.js';
import { isMoving, spawnWanderer, stepWanderer, type Bounds, type Wanderer } from '../map/wander.js';
import { SPEED, beaconAlpha, bob, hash01, walkFrame } from '../sim.js';
import { FRAME_NAMES, SPRITE_H, SPRITE_W, buildFrame, paletteFor, rasterize, type FrameName } from '../sprites.js';
import { vitalsLook, type Theme, type VitalsLook } from '../theme.js';
import { isLow } from '../vitals.js';
import { birthTime, prefersReducedMotion, spawnPose } from '../spawn.js';
import { Figure } from './figure.js';
import { drawPuff } from './spawnfx.js';
import type { LoadedArt } from './pack.js';

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
const CAMP_RADIUS = 22;
/** How far a rider sits above the ground while mounted, in world pixels. */
const RIDER_LIFT = 8;
/** A leader farther than this from its settlement rides home. */
const HOME_RADIUS = 40;
/** Sprite-sheet characters are drawn smaller on the map so a camp still fits among the tiles. */
const FIGURE_SCALE = 0.75;
/** Leaders stand around their settlement, closer in than camps. */
const LEADER_RADIUS = 12;
/** A member on foot walks over to talk only to someone this close, in world pixels. */
const WALK_TO_TALK = 160;
/** Keep characters this far inside the map edge, in world pixels. */
const EDGE = 8;

interface MemberView {
  sprite: Sprite;
  figure?: Figure;
  bubble: Container;
  text: Text;
  bg: Graphics;
  w: Wanderer;
  phase: number;
  /** Scene time the member first appeared; arrival plays from here. */
  born: number;
  /** An orchestrator's mount: ridden on long journeys, parked and idling otherwise. */
  mount?: { sprite: Sprite; x: number; y: number; dir: 1 | -1; riding: boolean };
}

interface StepCtx {
  /** Party whose speech this member owns. */
  sayParty: string;
  /** Stable id for the member's wandering. */
  wid: string;
  status: Status;
  tint?: string | undefined;
  /** Leaders walk to this point when they speak. */
  meetPoint?: { x: number; y: number } | undefined;
  /** A leader riding out to summon a new camp: where, and how fast. */
  summon?: { to: { x: number; y: number }; speed: number } | undefined;
}

interface PartyView {
  root: Container;
  glow: Sprite;
  camp: Sprite;
  fire: Sprite;
  /** Extra tents added as the party grows, with the time each was built. */
  tents: Sprite[];
  tentBorn: number[];
  flag: Graphics;
  tint?: string | undefined;
  label: Text;
  members: Map<string, MemberView>;
}

/** Map mode: a stylised pixel world with a glow per party, leaders at their settlements, and click-to-zoom. */
export class MapScene {
  private world = new Container();
  private terrainLayer = new Container();
  private buildingLayer = new Container();
  private actorLayer = new Container();
  private marks = new Graphics();
  private marksSig = '';
  /** Arrival puffs, redrawn every frame. */
  private fx = new Graphics();
  private reduced = prefersReducedMotion();
  /** New led camps waiting for their orchestrator to ride out and summon them. */
  private summons = new Map<string, { prefix: string; to: { x: number; y: number }; arrive: number; speed: number }>();
  private waterSprites: { sprite: Sprite; a: Texture; b: Texture }[] = [];
  private parties = new Map<string, PartyView>();
  private leaders = new Map<string, MemberView>();
  /** Leader view id to the Herdr workspace its pane lives in, so a click on a leader opens that workspace. */
  private leaderParty = new Map<string, string>();
  private fellowships: FellowshipView = groupFellowships({ machine: 'local', parties: {} });
  private settlementViews: Container[] = [];
  private towns = new Map<string, Container>();
  /** Build time of each building per settlement, kept across layout rebuilds so growth pops once. */
  private townBorn = new Map<string, number[]>();
  /** False until the first world arrives, so what already exists does not pop in. */
  private primed = false;
  private textures = new Map<string, Texture>();
  private layout: MapLayout = layoutMap({ machine: 'local', parties: {} });
  private cam: Camera = { cx: 0, cy: 0, zoom: 1 };
  private focus: string | undefined;
  private t = 0;
  private dt = 1 / 60;
  private textScale = 1;
  private panel: HTMLElement | null = document.getElementById('detail');

  constructor(
    private app: Application,
    private theme: Theme,
    private feed: FeedState,
    private art: MapArt,
    private figures: LoadedArt | null = null,
  ) {
    this.world.addChild(this.terrainLayer, this.marks, this.buildingLayer, this.actorLayer, this.fx);
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e) => this.click(e.global.x, e.global.y));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setFocus(undefined);
    });
    document.getElementById('detail-close')?.addEventListener('click', () => this.setFocus(undefined));
    // Close-pane buttons in the panel: ends the agent in Herdr, after a confirm.
    this.panel?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('button[data-close]') as HTMLButtonElement | null;
      if (!btn) return;
      e.stopPropagation();
      const paneId = btn.dataset.close!;
      if (!window.confirm(`Close pane ${paneId} in Herdr? This ends the agent running in it.`)) return;
      this.feed.onClose?.(paneId);
      btn.disabled = true;
      btn.textContent = 'closing…';
    });
  }

  get focusedParty(): string | undefined {
    return this.focus;
  }

  setFocus(id: string | undefined): void {
    this.focus = id && this.feed.world.parties[id] ? id : undefined;
    if (!this.focus && this.panel) this.panel.hidden = true;
  }

  private screenSize() {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  private mapPx() {
    return { w: this.layout.w * TILE, h: this.layout.h * TILE };
  }

  private partyPoint(id: string) {
    const c = this.layout.camps.get(id);
    return c ? tileToWorld(c.tile) : undefined;
  }

  private click(sx: number, sy: number): void {
    const screen = this.screenSize();
    const points = [...this.layout.camps.keys()].map((id) => ({ id, ...this.partyPoint(id)! }));
    // Leaders are clickable too: they open the workspace their pane lives in.
    for (const [id, mv] of this.leaders) {
      const partyId = this.leaderParty.get(id);
      if (partyId) points.push({ id: partyId, x: mv.w.x, y: mv.w.y });
    }
    const w = screenToWorld(this.cam, screen, { x: sx, y: sy });
    // Hit radius is generous so a glow is easy to click, even at overview zoom.
    this.setFocus(nearestParty(points, { x: w.x, y: w.y - 10 }, Math.max(18, 28 / this.cam.zoom * 2)));
  }

  private frameTexture(role: Member['role'], frame: FrameName, beacon: boolean): Texture {
    const key = `${role}|${frame}|${beacon}`;
    let tex = this.textures.get(key);
    if (!tex) {
      const look = this.theme.roles[role];
      const canvas = document.createElement('canvas');
      canvas.width = SPRITE_W;
      canvas.height = SPRITE_H;
      canvas.getContext('2d')!.putImageData(new ImageData(rasterize(buildFrame(look, frame, beacon), paletteFor(look, this.theme)), SPRITE_W, SPRITE_H), 0, 0);
      tex = Texture.from(canvas);
      tex.source.scaleMode = 'nearest';
      this.textures.set(key, tex);
    }
    return tex;
  }

  private bounds(): Bounds {
    const m = this.mapPx();
    return { x0: EDGE, y0: EDGE * 2, x1: m.w - EDGE, y1: m.h - EDGE };
  }

  /** Rebuilds terrain and settlements; only runs when the layout changes. */
  private rebuild(layout: MapLayout): void {
    this.layout = layout;
    // Camps outlive a layout change (a new party moves the map around them), so keep their views.
    const camps = new Set<unknown>([...this.parties.values()].map((v) => v.root));
    for (const l of [this.terrainLayer, this.buildingLayer]) l.removeChildren().forEach((c) => (camps.has(c) ? undefined : c.destroy({ children: true })));
    this.waterSprites = [];
    this.settlementViews = [];
    this.towns.clear();
    const terrain = buildTerrain(layout);

    for (let y = 0; y < terrain.h; y++) {
      for (let x = 0; x < terrain.w; x++) {
        const i = y * terrain.w + x;
        const base = terrain.ground[i] === 'water' ? new Sprite(this.art.tile(groundTileName(terrain, x, y, 0))) : new Sprite(this.art.tile(groundTileName(terrain, x, y)));
        base.position.set(x * TILE, y * TILE);
        base.roundPixels = true;
        this.terrainLayer.addChild(base);
        if (terrain.ground[i] === 'water') this.waterSprites.push({ sprite: base, a: this.art.tile(groundTileName(terrain, x, y, 0)), b: this.art.tile(groundTileName(terrain, x, y, 1)) });
        const raw = terrain.scenery[i];
        // Snow packs ship a runestone where other packs have a stump.
        const s = raw === 'stump' && !this.art.hasTile('stump') ? 'runestone' : raw;
        if (s && this.art.hasTile(s)) {
          const o = new Sprite(this.art.tile(s));
          o.position.set(x * TILE, y * TILE);
          this.terrainLayer.addChild(o);
        }
      }
    }

    for (const s of layout.settlements) {
      const c = new Container();
      const town = new Container();
      this.towns.set(s.key, town);
      const p = tileToWorld(s.tile);
      c.position.set(p.x, p.y);
      c.addChild(town);
      const name = new Text({ text: s.name, style: { fontFamily: 'monospace', fontSize: 9, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
      name.anchor.set(0.5, 0);
      name.position.set(0, 2);
      name.scale.set(0.9);
      c.addChild(name);
      this.buildingLayer.addChild(c);
      this.settlementViews.push(c);
    }
    for (const v of this.parties.values()) this.buildingLayer.addChild(v.root);
  }

  private makeParty(id: string): PartyView {
    const root = new Container();
    const glow = new Sprite(this.art.prop('glow'));
    glow.anchor.set(0.5, 0.75);
    glow.blendMode = 'add';
    const camp = new Sprite(this.art.prop('camp'));
    camp.anchor.set(0.5, 1);
    const fire = new Sprite(this.art.prop('campfire_0'));
    fire.anchor.set(0.5, 1);
    fire.position.set(14, 0);
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 9, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
    label.anchor.set(0.5, 1);
    label.position.set(0, -24);
    const flag = new Graphics();
    root.addChild(glow, camp, fire, flag, label);
    this.buildingLayer.addChild(root);
    const view: PartyView = { root, glow, camp, fire, tents: [], tentBorn: [], flag, label, members: new Map() };
    this.parties.set(id, view);
    return view;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.dt = dt;
    this.fx.clear();
    const fv = groupFellowships(this.feed.world, { leadAlone: true });
    this.fellowships = fv;
    const world = fv.world;
    const layout = layoutMap(world, fv.fellowships.map((f) => f.key.slice(f.key.indexOf('|') + 1)));
    if (layout.signature !== this.layout.signature || !this.terrainLayer.children.length) {
      this.rebuild(layout);
      this.cam = { cx: this.mapPx().w / 2, cy: this.mapPx().h / 2, zoom: fitZoom(this.mapPx(), this.screenSize()) };
    }
    // Focus is on the raw world: a leader's own workspace has no camp but can still be opened.
    if (this.focus && !this.feed.world.parties[this.focus]) this.setFocus(undefined);

    const screen = this.screenSize();
    const target: Camera = this.focus
      ? { ...this.camFocus(this.focus), zoom: focusZoom(screen) }
      : { cx: this.mapPx().w / 2, cy: this.mapPx().h / 2, zoom: fitZoom(this.mapPx(), screen) };
    this.cam = stepCamera(this.cam, target, dt);
    this.world.scale.set(this.cam.zoom);
    this.world.position.set(screen.w / 2 - this.cam.cx * this.cam.zoom, screen.h / 2 - this.cam.cy * this.cam.zoom);
    this.app.stage.hitArea = this.app.screen;

    // Water shimmer.
    const wf = Math.floor(this.t * 2) % 2;
    // Keep text a readable size at every zoom.
    const ts = Math.min(1.2, Math.max(0.35, 2.2 / this.cam.zoom));
    this.textScale = ts;
    for (const c of this.settlementViews) c.children[1]?.scale.set(ts);
    for (const w of this.waterSprites) w.sprite.texture = wf ? w.b : w.a;

    for (const [id, v] of this.parties) {
      if (!world.parties[id]) {
        // Member bodies live on the actor layer, not under the camp, so they go separately.
        // Leaving them behind is what made ghosts: a lone agent renamed to orchestrator
        // left its camp, and its old body stood frozen where the camp had been.
        for (const mv of v.members.values()) this.destroyMember(mv);
        v.root.destroy({ children: true });
        this.parties.delete(id);
      }
    }
    this.growTowns();
    for (const party of Object.values(world.parties)) this.updateParty(party, fv.tints.get(party.id), now);
    this.updateLeaders(fv.fellowships, world, now);
    if (Object.keys(world.parties).length) this.primed = true;
    this.drawMarks(fv.fellowships, fv.tints);
    this.updatePanel(now);
  }

  private camFocus(id: string) {
    const p = this.partyPoint(id) ?? this.leaderPoint(id) ?? { x: this.mapPx().w / 2, y: this.mapPx().h / 2 };
    return { cx: p.x, cy: p.y - 8 };
  }

  private leaderPoint(partyId: string) {
    for (const [id, mv] of this.leaders) if (this.leaderParty.get(id) === partyId) return { x: mv.w.x, y: mv.w.y };
    return undefined;
  }

  /** One more building in a repo's settlement for every four agents; new ones pop in. */
  private growTowns(): void {
    const raw = this.feed.world;
    if (!this.primed && Object.keys(raw.parties).length === 0) return;
    const counts = agentsByRepo(raw);
    for (const [key, town] of this.towns) {
      const n = townSize(counts.get(key) ?? 0);
      const born = this.townBorn.get(key) ?? [];
      while (born.length < n) born.push(birthTime(this.t, this.primed, this.reduced));
      this.townBorn.set(key, born);
      while (town.children.length < n) {
        const spr = new Sprite(this.art.prop('settlement'));
        spr.anchor.set(0.5, 1);
        town.addChild(spr);
      }
      const slots = townSlots(n);
      // Back to front so nearer buildings overlap farther ones.
      const order = slots.map((_, i) => i).sort((a, b) => slots[a]!.y - slots[b]!.y);
      order.forEach((slot, z) => {
        const spr = town.children[slot] as Sprite;
        spr.position.set(slots[slot]!.x, slots[slot]!.y);
        spr.scale.set(pop(this.t - born[slot]!));
        town.setChildIndex(spr, z);
      });
    }
  }

  /** A new camp in a led fellowship waits for its orchestrator, who rides out to summon it. */
  private planSummon(partyId: string, home: { x: number; y: number }): void {
    const f = this.fellowships.byParty.get(partyId);
    if (!f || !this.primed || this.reduced) return;
    const prefix = `${f.key}/`;
    const leader = [...this.leaders].find(([id]) => id.startsWith(prefix))?.[1];
    if (!leader) return;
    const plan = summonPlan(this.t, { x: leader.w.x, y: leader.w.y }, home);
    this.summons.set(partyId, { prefix, to: home, arrive: plan.arrive, speed: plan.speed });
  }

  private growCamp(view: PartyView, members: number, arrive?: number): void {
    const n = campSize(members);
    while (view.tentBorn.length < n) view.tentBorn.push(arrive ?? birthTime(this.t, this.primed, this.reduced));
    while (view.tents.length < n - 1) {
      const t = new Sprite(this.art.prop('camp'));
      t.anchor.set(0.5, 1);
      view.root.addChildAt(t, view.root.getChildIndex(view.camp));
      view.tents.push(t);
    }
    const slots = campSlots(n);
    view.camp.position.set(slots[0]!.x, slots[0]!.y);
    view.camp.scale.set(pop(this.t - view.tentBorn[0]!));
    // A new camp (a new worktree or workspace) lands in a ring of sparks; a new tent gets its own smaller one.
    view.tentBorn.forEach((born, i) => drawPuff(this.fx, view.root.x + (slots[i] ?? slots[0]!).x, view.root.y + (slots[i] ?? slots[0]!).y, this.t - born, 0xe8c547, 1, i === 0 ? 26 : 14));
    view.tents.forEach((t, i) => {
      t.position.set(slots[i + 1]!.x, slots[i + 1]!.y);
      t.scale.set(pop(this.t - view.tentBorn[i + 1]!));
    });
  }

  private updateParty(party: Party, tint: string | undefined, now: number): void {
    const camp = this.layout.camps.get(party.id);
    if (!camp) return;
    const isNew = !this.parties.has(party.id);
    const view = this.parties.get(party.id) ?? this.makeParty(party.id);
    const home = tileToWorld(camp.tile);
    view.root.position.set(home.x, home.y);
    if (isNew) this.planSummon(party.id, home);
    const summon = this.summons.get(party.id);
    if (summon && this.t > summon.arrive + 0.5) this.summons.delete(party.id);
    // A summoned camp appears when its orchestrator arrives.
    view.root.visible = !summon || this.t >= summon.arrive;
    this.growCamp(view, Object.keys(party.members).length, summon?.arrive);
    if (view.tint !== tint) {
      view.tint = tint;
      view.flag.clear();
      if (tint) view.flag.rect(-17, -22, 1, 22).fill(0x2a2118).rect(-16, -22, 10, 7).fill(hexNum(tint)).rect(-16, -22, 10, 1).fill({ color: 0xffffff, alpha: 0.35 });
    }

    const color = hexNum(this.theme.palette[party.status]);
    const pulse = beaconAlpha(party.status, this.t);
    view.glow.tint = color;
    view.glow.alpha = 0.35 + 0.45 * pulse;
    const focused = this.focus === party.id;
    // Glows are large at overview zoom so every party reads at a glance, smaller when zoomed in.
    const glowScale = focused ? 1.6 : Math.min(3.2, Math.max(1.2, 1.6 / this.cam.zoom * 2.2));
    view.glow.scale.set(glowScale * (1 + (party.status === 'blocked' ? 0.08 * Math.sin(this.t * 8) : 0)));
    view.fire.texture = this.art.prop(`campfire_${Math.floor(this.t * (party.status === 'working' ? 8 : 4)) % 4}`);
    view.fire.alpha = party.status === 'idle' || party.status === 'unknown' ? 0.55 : 1;
    view.label.text = party.branch ? `${party.label} · ${party.branch}` : party.label;
    view.label.style.fill = color;
    view.label.scale.set(this.textScale);
    view.label.visible = focused || this.cam.zoom > 2;

    const members = Object.values(party.members).sort((a, b) => a.paneId.localeCompare(b.paneId));
    for (const [paneId, mv] of view.members) {
      if (!party.members[paneId]) {
        this.destroyMember(mv);
        view.members.delete(paneId);
      }
    }
    const beaconPane = (members.find((m) => m.role === this.theme.beacon) ?? members[0])?.paneId;
    members.forEach((m) => {
      let mv = view.members.get(m.paneId);
      if (!mv) {
        mv = this.makeMember(m.paneId, `${party.id}/${m.paneId}`, { x: home.x, y: home.y + 6 }, CAMP_RADIUS);
        if (summon) mv.born = summon.arrive;
        view.members.set(m.paneId, mv);
      }
      this.stepMember(mv, { sayParty: party.id, wid: `${party.id}/${m.paneId}`, status: party.status, tint }, m, { x: home.x, y: home.y + 6 }, CAMP_RADIUS, m.paneId === beaconPane, now);
    });
  }

  private makeMember(paneId: string, wid: string, home: { x: number; y: number }, radius: number, rider = false): MemberView {
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    const figure = this.figures ? new Figure(this.figures, this.theme) : undefined;
    const bg = new Graphics();
    const text = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 8, fill: 0x1b1b24 }, resolution: 4 });
    const bubble = new Container();
    bubble.addChild(bg, text);
    const body = figure ? figure.container : sprite;
    let mount: MemberView['mount'];
    if (rider && this.art.hasProp('mount_idle')) {
      const ms = new Sprite(this.art.prop('mount_idle'));
      ms.anchor.set(0.5, 1);
      ms.visible = false;
      // The mount stands behind its rider.
      this.actorLayer.addChild(ms);
      mount = { sprite: ms, x: home.x, y: home.y, dir: 1, riding: false };
    }
    this.actorLayer.addChild(body, bubble);
    return { ...(mount ? { mount } : {}), sprite, ...(figure ? { figure } : {}), bubble, text, bg, phase: hash01(paneId) * 10, born: birthTime(this.t, this.primed, this.reduced), w: spawnWanderer(wid, home, radius, this.bounds()) };
  }

  private destroyMember(mv: MemberView): void {
    mv.mount?.sprite.destroy();
    if (mv.figure) mv.figure.destroy();
    else mv.sprite.destroy();
    mv.bubble.destroy({ children: true });
  }

  /** Orchestrators stand at the root of their project, the settlement, with the beacon light on. */
  private updateLeaders(fellowships: Fellowship[], world: World, now: number): void {
    const live = new Set<string>();
    for (const f of fellowships) {
      const settlement = this.layout.settlements.find((s) => s.key === f.key.slice(f.key.indexOf('|') + 1));
      if (!settlement) continue;
      const p = tileToWorld(settlement.tile);
      const home = { x: p.x, y: p.y + 8 };
      for (const l of f.leaders) {
        const id = `${f.key}/${l.member.paneId}`;
        live.add(id);
        this.leaderParty.set(id, l.partyId);
        let mv = this.leaders.get(id);
        if (!mv) {
          mv = this.makeMember(l.member.paneId, `lead/${id}`, home, LEADER_RADIUS, true);
          this.leaders.set(id, mv);
        }
        const follower = pickFollower(f, l.member.paneId);
        const fp = follower ? Object.values(world.parties[follower]?.members ?? {}).sort((a, b) => a.paneId.localeCompare(b.paneId))[0] : undefined;
        const fv = follower && fp ? this.parties.get(follower)?.members.get(fp.paneId) : undefined;
        const sm = [...this.summons.values()].find((s) => id.startsWith(s.prefix) && this.t < s.arrive);
        this.stepMember(mv, { sayParty: l.partyId, wid: `lead/${id}`, status: l.member.status, meetPoint: fv ? { x: fv.w.x, y: fv.w.y } : undefined, summon: sm ? { to: sm.to, speed: sm.speed } : undefined }, l.member, home, LEADER_RADIUS, true, now);
      }
    }
    for (const [id, mv] of this.leaders) {
      if (live.has(id)) continue;
      this.destroyMember(mv);
      this.leaders.delete(id);
      this.leaderParty.delete(id);
    }
  }

  /** Banners at each led settlement and tinted trails to the camps it leads. */
  private drawMarks(fellowships: Fellowship[], tints: Map<string, string>): void {
    const sig = `${this.layout.signature}#${fellowships.map((f) => `${f.key}:${f.partyIds.map((id) => `${id}=${tints.get(id)}`).join(',')}`).join(';')}`;
    if (sig === this.marksSig) return;
    this.marksSig = sig;
    const g = this.marks.clear();
    for (const f of fellowships) {
      const settlement = this.layout.settlements.find((s) => s.key === f.key.slice(f.key.indexOf('|') + 1));
      if (!settlement) continue;
      const from = tileToWorld(settlement.tile);
      for (const id of f.partyIds) {
        const camp = this.layout.camps.get(id);
        const color = tints.get(id);
        if (!camp || !color) continue;
        const to = tileToWorld(camp.tile);
        const n = Math.max(2, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 6));
        for (let i = 1; i < n; i++) {
          const t = i / n;
          g.rect(Math.round(from.x + (to.x - from.x) * t) - 1, Math.round(from.y - 2 + (to.y - from.y - 2) * t) - 1, 2, 2).fill({ color: hexNum(color), alpha: 0.85 });
        }
      }
      // An orchestrator alone in its repo gets no banner until it has camps to lead.
      if (!f.partyIds.length) continue;
      // Banner pole beside the settlement, flag striped in the tint of every camp it leads.
      const bx = Math.round(from.x + 22);
      const by = Math.round(from.y);
      g.rect(bx, by - 40, 1, 40).fill(0x2a2118);
      g.rect(bx - 1, by - 41, 3, 2).fill(0xe8c547);
      const stripes = f.partyIds.map((id) => tints.get(id)).filter((c): c is string => !!c);
      const h = 14;
      const sh = Math.max(1, Math.floor(h / Math.max(1, stripes.length)));
      stripes.forEach((c, i) => g.rect(bx + 1, by - 39 + i * sh, 12, sh).fill(hexNum(c)));
      g.rect(bx + 1, by - 39, 12, h).stroke({ color: 0x2a2118, width: 1, alignment: 1 });
    }
  }

  private stepMember(mv: MemberView, ctx: StepCtx, m: Member, home: { x: number; y: number }, radius: number, beacon: boolean, now: number): void {
    const say = this.feed.say(ctx.sayParty, m.paneId, now);
    const talking = this.feed.talking(ctx.sayParty, m.paneId, now);
    // A speaker walks over to its partner; a listener holds still and turns to face them.
    // A real message names its listener; an orchestrator rides out to a far camp, a member
    // on foot only crosses to someone nearby. Without a named listener, pick a likely one.
    let meet: { x: number; y: number } | undefined;
    if (talking) {
      const to = this.feed.sayTo(ctx.sayParty, m.paneId, now);
      const tv = to && this.viewOf(to.partyId, to.paneId);
      if (to) {
        if (tv && tv !== mv && (mv.mount || Math.hypot(tv.w.x - mv.w.x, tv.w.y - mv.w.y) <= WALK_TO_TALK)) meet = { x: tv.w.x, y: tv.w.y };
      } else {
        meet = ctx.meetPoint;
        if (!meet) {
          const partner = pickPartner(this.fellowships.world, this.layout.camps, ctx.sayParty, m.paneId);
          const pv = partner && this.parties.get(partner.partyId)?.members.get(partner.paneId);
          if (pv && partner && !(partner.partyId === ctx.sayParty && partner.paneId === m.paneId)) meet = { x: pv.w.x, y: pv.w.y };
        }
      }
    }
    let speed: number | undefined;
    const mount = mv.mount;
    if (ctx.summon) {
      // Summoning a camp beats chatting: ride out to where it will stand.
      meet = ctx.summon.to;
      speed = ctx.summon.speed;
    }
    if (mount) {
      const homeDist = Math.hypot(home.x - mv.w.x, home.y - mv.w.y);
      // A rider far from its settlement, or mid-ride, heads home when it has nothing else to do.
      if (!meet && (mount.riding || homeDist > HOME_RADIUS)) meet = home;
      const dist = meet ? Math.hypot(meet.x - mv.w.x, meet.y - mv.w.y) : 0;
      const was = mount.riding;
      mount.riding = nextRiding(mount.riding, dist, !!meet);
      if (mount.riding) speed ??= RIDE_SPEED;
      if (was && !mount.riding) {
        const p = parkSpot(mv.w, mv.w.dir);
        Object.assign(mount, { x: p.x, y: p.y, dir: mv.w.dir });
      }
    }
    mv.w = stepWanderer(mv.w, ctx.wid, m.status, home, radius, this.dt, meet, this.bounds(), speed);
    const moving = isMoving(mv.w) && (SPEED[m.status] > 0 || speed !== undefined);
    const lift = mount?.riding ? RIDER_LIFT : 0;
    if (mount) {
      if (mount.riding) Object.assign(mount, { x: mv.w.x, y: mv.w.y, dir: mv.w.dir });
      mount.sprite.visible = true;
      mount.sprite.texture = this.art.prop(mount.riding && moving ? `mount_walk_${Math.floor(this.t * 8) % 4}` : 'mount_idle');
      mount.sprite.scale.set(mount.dir * FIGURE_SCALE, FIGURE_SCALE);
      mount.sprite.position.set(mount.x, mount.y);
    }
    const figH = mv.figure ? this.figures!.art.character.h * FIGURE_SCALE : SPRITE_H;
    if (mv.figure) {
      mv.figure.update({ member: m, partyStatus: ctx.status, isBeacon: beacon, moving: moving && m.status !== 'blocked', talking, t: this.t, phase: mv.phase, tint: ctx.tint }, mv.w.dir, FIGURE_SCALE, mv.w.x, mv.w.y - lift + bob(m.status, this.t, mv.phase) * 0.5);
    } else {
      const frame = FRAME_NAMES[walkFrame(moving, this.t, mv.phase)]!;
      mv.sprite.texture = this.frameTexture(m.role, frame, beacon);
      mv.sprite.scale.x = mv.w.dir;
      mv.sprite.position.set(mv.w.x, mv.w.y - lift + bob(m.status, this.t, mv.phase) * 0.5);
      mv.sprite.tint = m.status === 'blocked' ? 0xffd0d0 : ctx.tint ? hexNum(mixHex('#ffffff', ctx.tint, 0.55)) : 0xffffff;
    }

    this.arrive(mv, mv.figure ? mv.figure.container : mv.sprite, ctx.status);
    mv.bubble.visible = !!say;
    if (say) {
      if (mv.text.text !== say) {
        mv.text.text = say;
        const w = mv.text.width + 6;
        const h = mv.text.height + 4;
        mv.bg.clear().roundRect(0, 0, w, h, 3).fill({ color: 0xffffff, alpha: 0.92 });
        mv.text.position.set(3, 2);
      }
      mv.bubble.scale.set(this.textScale);
      mv.bubble.position.set(mv.w.x - (mv.bg.width * this.textScale) / 2, mv.w.y - figH - mv.bg.height * this.textScale - 2);
    }
  }

  /** The character drawn for a pane: a camp member, or an orchestrator standing at its settlement. */
  private viewOf(partyId: string, paneId: string): MemberView | undefined {
    const camp = this.parties.get(partyId)?.members.get(paneId);
    if (camp) return camp;
    for (const [id, mv] of this.leaders) if (this.leaderParty.get(id) === partyId && id.endsWith(`/${paneId}`)) return mv;
    return undefined;
  }

  /** Beam a new member in and puff sparks in its status colour at its feet. */
  private arrive(mv: MemberView, body: { alpha: number; scale: { x: number; y: number }; y: number }, status: Status): void {
    const age = this.t - mv.born;
    const pose = spawnPose(age);
    if (pose.alpha >= 1 && pose.lift === 0) return;
    body.alpha *= pose.alpha;
    body.scale.x *= pose.sx;
    body.scale.y *= pose.sy;
    body.y -= pose.lift;
    drawPuff(this.fx, mv.w.x, mv.w.y, age, hexNum(this.theme.palette[status]), 1, 10);
  }

  private updatePanel(now: number): void {
    if (!this.panel) return;
    const party = this.focus ? this.feed.world.parties[this.focus] : undefined;
    if (!party) {
      this.panel.hidden = true;
      return;
    }
    const camp = this.layout.camps.get(party.id);
    const d = describeParty(party, settlementName(camp?.settlementKey ?? repoKey(party)), this.theme.beacon, now, this.feed.vitalsOn);
    const html = `<h2>${esc(d.title)} <span class="st ${d.status}">${d.status}</span></h2><p class="sub">${esc(d.subtitle)}</p><ul>${d.rows
      .map((r) => `<li><span class="st ${r.status}">●</span> <b>${esc(r.role)}</b> <i>${esc(r.agent)}</i><button class="kill" data-close="${esc(r.paneId)}" title="Close this pane in Herdr (ends the agent)">close</button>${vitalsHtml(r, vitalsLook(this.theme))}<br><span class="line">${esc(r.line)}</span></li>`)
      .join('')}</ul>`;
    const body = this.panel.querySelector('#detail-body');
    if (body && body.innerHTML !== html) body.innerHTML = html;
    this.panel.hidden = false;
  }
}

/** Model line, the two bars with their percentages, and the quest, for one panel row. Empty when the agent reports none of it. */
function vitalsHtml(r: DetailRow, look: VitalsLook): string {
  const bar = (label: string, pct: number | undefined, color: string) =>
    pct === undefined
      ? ''
      : `<div class="vit"><span>${label}</span><span class="bar"><i style="width:${pct}%;background:${isLow(pct) && label === 'HP' ? look.low : color}"></i></span><span class="pct">${pct}%</span></div>`;
  const bars = bar('HP', r.context, look.context) + bar('SP', r.quota, look.quota);
  return `${r.model ? `<div class="model">${esc(r.model)}</div>` : ''}${bars}${r.quest ? `<div class="quest">quest: ${esc(r.quest)}</div>` : ''}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
