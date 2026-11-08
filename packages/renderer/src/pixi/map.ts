import type { Member, Party, Status, World } from '@bellwether/adapter/core';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { groupFellowships, mixHex, pickFollower, type Fellowship, type FellowshipView } from '../fellowship.js';
import type { FeedState } from '../feed.js';
import { pickPartner } from '../map/chatter.js';
import type { MapArt } from '../map/assets.js';
import { fitZoom, focusZoom, nearestParty, screenToWorld, stepCamera, type Camera } from '../map/camera.js';
import { describeParty } from '../map/detail.js';
import { layoutMap, repoKey, settlementName, tileToWorld, TILE, type MapLayout } from '../map/layout.js';
import { buildTerrain, groundTileName } from '../map/terrain.js';
import { isMoving, spawnWanderer, stepWanderer, type Bounds, type Wanderer } from '../map/wander.js';
import { SPEED, beaconAlpha, bob, hash01, walkFrame } from '../sim.js';
import { FRAME_NAMES, SPRITE_H, SPRITE_W, buildFrame, paletteFor, rasterize, type FrameName } from '../sprites.js';
import type { Theme } from '../theme.js';
import { Figure } from './figure.js';
import type { LoadedArt } from './pack.js';

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
const CAMP_RADIUS = 22;
/** Sprite-sheet characters are drawn smaller on the map so a camp still fits among the tiles. */
const FIGURE_SCALE = 0.75;
/** Leaders stand around their settlement, closer in than camps. */
const LEADER_RADIUS = 12;
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
}

interface PartyView {
  root: Container;
  glow: Sprite;
  camp: Sprite;
  fire: Sprite;
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
  private waterSprites: { sprite: Sprite; a: Texture; b: Texture }[] = [];
  private parties = new Map<string, PartyView>();
  private leaders = new Map<string, MemberView>();
  private fellowships: FellowshipView = groupFellowships({ machine: 'local', parties: {} });
  private settlementViews: Container[] = [];
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
    this.world.addChild(this.terrainLayer, this.marks, this.buildingLayer, this.actorLayer);
    app.stage.addChild(this.world);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e) => this.click(e.global.x, e.global.y));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.setFocus(undefined);
    });
    document.getElementById('detail-close')?.addEventListener('click', () => this.setFocus(undefined));
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
    for (const l of [this.terrainLayer, this.buildingLayer]) l.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.waterSprites = [];
    this.settlementViews = [];
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
      const spr = new Sprite(this.art.prop('settlement'));
      spr.anchor.set(0.5, 1);
      const p = tileToWorld(s.tile);
      c.position.set(p.x, p.y);
      c.addChild(spr);
      const name = new Text({ text: s.name, style: { fontFamily: 'monospace', fontSize: 9, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
      name.anchor.set(0.5, 0);
      name.position.set(0, 2);
      name.scale.set(0.9);
      c.addChild(name);
      this.buildingLayer.addChild(c);
      this.settlementViews.push(c);
    }
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
    const view: PartyView = { root, glow, camp, fire, flag, label, members: new Map() };
    this.parties.set(id, view);
    return view;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.dt = dt;
    const fv = groupFellowships(this.feed.world);
    this.fellowships = fv;
    const world = fv.world;
    const layout = layoutMap(world);
    if (layout.signature !== this.layout.signature || !this.terrainLayer.children.length) {
      this.rebuild(layout);
      this.cam = { cx: this.mapPx().w / 2, cy: this.mapPx().h / 2, zoom: fitZoom(this.mapPx(), this.screenSize()) };
    }
    if (this.focus && !world.parties[this.focus]) this.setFocus(undefined);

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
        v.root.destroy({ children: true });
        this.parties.delete(id);
      }
    }
    for (const party of Object.values(world.parties)) this.updateParty(party, fv.tints.get(party.id), now);
    this.updateLeaders(fv.fellowships, world, now);
    this.drawMarks(fv.fellowships, fv.tints);
    this.updatePanel(now);
  }

  private camFocus(id: string) {
    const p = this.partyPoint(id)!;
    return { cx: p.x, cy: p.y - 8 };
  }

  private updateParty(party: Party, tint: string | undefined, now: number): void {
    const camp = this.layout.camps.get(party.id);
    if (!camp) return;
    const view = this.parties.get(party.id) ?? this.makeParty(party.id);
    const home = tileToWorld(camp.tile);
    view.root.position.set(home.x, home.y);
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
        if (mv.figure) mv.figure.destroy();
        else mv.sprite.destroy();
        mv.bubble.destroy({ children: true });
        view.members.delete(paneId);
      }
    }
    const beaconPane = (members.find((m) => m.role === this.theme.beacon) ?? members[0])?.paneId;
    members.forEach((m) => {
      let mv = view.members.get(m.paneId);
      if (!mv) {
        mv = this.makeMember(m.paneId, `${party.id}/${m.paneId}`, { x: home.x, y: home.y + 6 }, CAMP_RADIUS);
        view.members.set(m.paneId, mv);
      }
      this.stepMember(mv, { sayParty: party.id, wid: `${party.id}/${m.paneId}`, status: party.status, tint }, m, { x: home.x, y: home.y + 6 }, CAMP_RADIUS, m.paneId === beaconPane, now);
    });
  }

  private makeMember(paneId: string, wid: string, home: { x: number; y: number }, radius: number): MemberView {
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    const figure = this.figures ? new Figure(this.figures, this.theme) : undefined;
    const bg = new Graphics();
    const text = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 8, fill: 0x1b1b24 }, resolution: 4 });
    const bubble = new Container();
    bubble.addChild(bg, text);
    this.actorLayer.addChild(figure ? figure.container : sprite, bubble);
    return { sprite, ...(figure ? { figure } : {}), bubble, text, bg, phase: hash01(paneId) * 10, w: spawnWanderer(wid, home, radius, this.bounds()) };
  }

  private destroyMember(mv: MemberView): void {
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
        let mv = this.leaders.get(id);
        if (!mv) {
          mv = this.makeMember(l.member.paneId, `lead/${id}`, home, LEADER_RADIUS);
          this.leaders.set(id, mv);
        }
        const follower = pickFollower(f, l.member.paneId);
        const fp = follower ? Object.values(world.parties[follower]?.members ?? {}).sort((a, b) => a.paneId.localeCompare(b.paneId))[0] : undefined;
        const fv = follower && fp ? this.parties.get(follower)?.members.get(fp.paneId) : undefined;
        this.stepMember(mv, { sayParty: l.partyId, wid: `lead/${id}`, status: l.member.status, meetPoint: fv ? { x: fv.w.x, y: fv.w.y } : undefined }, l.member, home, LEADER_RADIUS, true, now);
      }
    }
    for (const [id, mv] of this.leaders) {
      if (live.has(id)) continue;
      this.destroyMember(mv);
      this.leaders.delete(id);
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
    // A speaker walks over to its partner; a listener holds still and turns to face them.
    let meet = ctx.meetPoint;
    if (say && !meet) {
      const partner = pickPartner(this.fellowships.world, this.layout.camps, ctx.sayParty, m.paneId);
      const pv = partner && this.parties.get(partner.partyId)?.members.get(partner.paneId);
      if (pv && partner && !(partner.partyId === ctx.sayParty && partner.paneId === m.paneId)) meet = { x: pv.w.x, y: pv.w.y };
    }
    if (!say) meet = undefined;
    mv.w = stepWanderer(mv.w, ctx.wid, m.status, home, radius, this.dt, meet, this.bounds());
    const moving = isMoving(mv.w) && SPEED[m.status] > 0;
    const figH = mv.figure ? this.figures!.art.character.h * FIGURE_SCALE : SPRITE_H;
    if (mv.figure) {
      mv.figure.update({ member: m, partyStatus: ctx.status, isBeacon: beacon, moving: moving && m.status !== 'blocked', talking: !!say, t: this.t, phase: mv.phase, tint: ctx.tint }, mv.w.dir, FIGURE_SCALE, mv.w.x, mv.w.y + bob(m.status, this.t, mv.phase) * 0.5);
    } else {
      const frame = FRAME_NAMES[walkFrame(moving, this.t, mv.phase)]!;
      mv.sprite.texture = this.frameTexture(m.role, frame, beacon);
      mv.sprite.scale.x = mv.w.dir;
      mv.sprite.position.set(mv.w.x, mv.w.y + bob(m.status, this.t, mv.phase) * 0.5);
      mv.sprite.tint = m.status === 'blocked' ? 0xffd0d0 : ctx.tint ? hexNum(mixHex('#ffffff', ctx.tint, 0.55)) : 0xffffff;
    }

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

  private updatePanel(now: number): void {
    if (!this.panel) return;
    const party = this.focus ? this.feed.world.parties[this.focus] : undefined;
    if (!party) {
      this.panel.hidden = true;
      return;
    }
    const camp = this.layout.camps.get(party.id);
    const d = describeParty(party, settlementName(camp?.settlementKey ?? repoKey(party)), this.theme.beacon, now);
    const html = `<h2>${esc(d.title)} <span class="st ${d.status}">${d.status}</span></h2><p class="sub">${esc(d.subtitle)}</p><ul>${d.rows
      .map((r) => `<li><span class="st ${r.status}">●</span> <b>${esc(r.role)}</b> <i>${esc(r.agent)}</i><br><span class="line">${esc(r.line)}</span></li>`)
      .join('')}</ul>`;
    const body = this.panel.querySelector('#detail-body');
    if (body && body.innerHTML !== html) body.innerHTML = html;
    this.panel.hidden = false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
