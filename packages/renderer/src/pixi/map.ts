import type { Member, Party } from '@bellwether/adapter/core';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { FeedState } from '../feed.js';
import { pickPartner } from '../map/chatter.js';
import type { MapArt } from '../map/assets.js';
import { fitZoom, focusZoom, minimapBox, minimapToWorld, nearestParty, screenToWorld, stepCamera, type Camera } from '../map/camera.js';
import { describeParty } from '../map/detail.js';
import { layoutMap, repoKey, settlementName, tileToWorld, TILE, type MapLayout } from '../map/layout.js';
import { buildTerrain, groundTileName } from '../map/terrain.js';
import { isMoving, spawnWanderer, stepWanderer, type Wanderer } from '../map/wander.js';
import { SPEED, beaconAlpha, bob, hash01, walkFrame } from '../sim.js';
import { FRAME_NAMES, SPRITE_H, SPRITE_W, buildFrame, paletteFor, rasterize, type FrameName } from '../sprites.js';
import type { Theme } from '../theme.js';
import { Figure } from './figure.js';
import type { LoadedArt } from './pack.js';

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
const CAMP_RADIUS = 22;
/** Sprite-sheet characters are drawn smaller on the map so a camp still fits among the tiles. */
const FIGURE_SCALE = 0.75;

interface MemberView {
  sprite: Sprite;
  figure?: Figure;
  bubble: Container;
  text: Text;
  bg: Graphics;
  w: Wanderer;
  phase: number;
}

interface PartyView {
  root: Container;
  glow: Sprite;
  camp: Sprite;
  fire: Sprite;
  label: Text;
  members: Map<string, MemberView>;
}

/** Map mode: a stylised pixel world with a glow per party, a minimap, and click-to-zoom. */
export class MapScene {
  private world = new Container();
  private terrainLayer = new Container();
  private buildingLayer = new Container();
  private actorLayer = new Container();
  private overlay = new Container();
  private mini = new Graphics();
  private miniTerrain = new Graphics();
  private waterSprites: { sprite: Sprite; a: Texture; b: Texture }[] = [];
  private parties = new Map<string, PartyView>();
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
    this.world.addChild(this.terrainLayer, this.buildingLayer, this.actorLayer);
    app.stage.addChild(this.world, this.overlay);
    this.overlay.addChild(this.miniTerrain, this.mini);
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
    const box = minimapBox(this.mapPx(), screen);
    const onMini = minimapToWorld(box, { x: sx, y: sy });
    const points = [...this.layout.camps.keys()].map((id) => ({ id, ...this.partyPoint(id)! }));
    if (onMini) {
      const hit = nearestParty(points, onMini, 28);
      if (hit) this.setFocus(hit);
      else this.setFocus(undefined);
      return;
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

  /** Rebuilds terrain, settlements and the minimap backdrop; only runs when the layout changes. */
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
        const s = terrain.scenery[i];
        if (s) {
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

    // Minimap backdrop: one coloured rect per tile, drawn once per layout.
    const box = minimapBox(this.mapPx(), this.screenSize());
    const px = box.scale * TILE;
    this.miniTerrain.clear();
    this.miniTerrain.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4).fill({ color: 0x0c0f18, alpha: 0.85 });
    for (let y = 0; y < terrain.h; y++) {
      for (let x = 0; x < terrain.w; x++) {
        const g = terrain.ground[y * terrain.w + x];
        const color = g === 'water' ? 0x2f6fa0 : g === 'path' ? 0xb59868 : hexNum(this.theme.ground);
        this.miniTerrain.rect(box.x + x * px, box.y + y * px, Math.ceil(px), Math.ceil(px)).fill(color);
      }
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
    root.addChild(glow, camp, fire, label);
    this.buildingLayer.addChild(root);
    const view: PartyView = { root, glow, camp, fire, label, members: new Map() };
    this.parties.set(id, view);
    return view;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.dt = dt;
    const world = this.feed.world;
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
    for (const party of Object.values(world.parties)) this.updateParty(party, now);

    this.drawMinimap(screen);
    this.updatePanel(now);
  }

  private camFocus(id: string) {
    const p = this.partyPoint(id)!;
    return { cx: p.x, cy: p.y - 8 };
  }

  private updateParty(party: Party, now: number): void {
    const camp = this.layout.camps.get(party.id);
    if (!camp) return;
    const view = this.parties.get(party.id) ?? this.makeParty(party.id);
    const home = tileToWorld(camp.tile);
    view.root.position.set(home.x, home.y);

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
        const sprite = new Sprite();
        sprite.anchor.set(0.5, 1);
        const figure = this.figures ? new Figure(this.figures, this.theme) : undefined;
        const bg = new Graphics();
        const text = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 8, fill: 0x1b1b24 }, resolution: 4 });
        const bubble = new Container();
        bubble.addChild(bg, text);
        this.actorLayer.addChild(figure ? figure.container : sprite, bubble);
        const home2 = { x: home.x, y: home.y + 6 };
        mv = { sprite, ...(figure ? { figure } : {}), bubble, text, bg, phase: hash01(m.paneId) * 10, w: spawnWanderer(`${party.id}/${m.paneId}`, home2, CAMP_RADIUS) };
        view.members.set(m.paneId, mv);
      }
      this.stepMember(mv, party, m, home, m.paneId === beaconPane, now);
    });
  }

  private stepMember(mv: MemberView, party: Party, m: Member, home: { x: number; y: number }, beacon: boolean, now: number): void {
    const say = this.feed.say(party.id, m.paneId, now);
    // A speaker walks over to its partner; a listener holds still and turns to face them.
    let meet: { x: number; y: number } | undefined;
    if (say) {
      const partner = pickPartner(this.feed.world, this.layout.camps, party.id, m.paneId);
      const pv = partner && this.parties.get(partner.partyId)?.members.get(partner.paneId);
      if (pv && partner && !(partner.partyId === party.id && partner.paneId === m.paneId)) meet = { x: pv.w.x, y: pv.w.y };
    }
    mv.w = stepWanderer(mv.w, `${party.id}/${m.paneId}`, m.status, { x: home.x, y: home.y + 6 }, CAMP_RADIUS, this.dt, meet);
    const moving = isMoving(mv.w) && SPEED[m.status] > 0;
    const figH = mv.figure ? this.figures!.art.character.h * FIGURE_SCALE : SPRITE_H;
    if (mv.figure) {
      mv.figure.update({ member: m, partyStatus: party.status, isBeacon: beacon, moving: moving && m.status !== 'blocked', talking: !!say, t: this.t, phase: mv.phase }, mv.w.dir, FIGURE_SCALE, mv.w.x, mv.w.y + bob(m.status, this.t, mv.phase) * 0.5);
    } else {
      const frame = FRAME_NAMES[walkFrame(moving, this.t, mv.phase)]!;
      mv.sprite.texture = this.frameTexture(m.role, frame, beacon);
      mv.sprite.scale.x = mv.w.dir;
      mv.sprite.position.set(mv.w.x, mv.w.y + bob(m.status, this.t, mv.phase) * 0.5);
      mv.sprite.tint = m.status === 'blocked' ? 0xffd0d0 : 0xffffff;
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

  private drawMinimap(screen: { w: number; h: number }): void {
    const box = minimapBox(this.mapPx(), screen);
    const g = this.mini.clear();
    const t = this.t;
    for (const party of Object.values(this.feed.world.parties)) {
      const p = this.partyPoint(party.id);
      if (!p) continue;
      const color = hexNum(this.theme.palette[party.status]);
      const a = beaconAlpha(party.status, t);
      const x = box.x + p.x * box.scale;
      const y = box.y + p.y * box.scale;
      g.circle(x, y, 7).fill({ color, alpha: 0.25 * a });
      g.circle(x, y, 3).fill({ color, alpha: a });
      if (party.id === this.focus) g.circle(x, y, 6).stroke({ color: 0xffffff, width: 1 });
    }
    // Viewport rectangle.
    const tl = screenToWorld(this.cam, screen, { x: 0, y: 0 });
    const br = screenToWorld(this.cam, screen, { x: screen.w, y: screen.h });
    const rx = Math.max(box.x, box.x + tl.x * box.scale);
    const ry = Math.max(box.y, box.y + tl.y * box.scale);
    const rw = Math.min(box.x + box.w, box.x + br.x * box.scale) - rx;
    const rh = Math.min(box.y + box.h, box.y + br.y * box.scale) - ry;
    if (rw > 0 && rh > 0 && this.cam.zoom > fitZoom(this.mapPx(), screen) * 1.2) g.rect(rx, ry, rw, rh).stroke({ color: 0xffffff, width: 1, alpha: 0.8 });
    g.rect(box.x - 2, box.y - 2, box.w + 4, box.h + 4).stroke({ color: 0xffffff, width: 1, alpha: 0.35 });
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
