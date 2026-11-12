import type { Member, Party } from '@bellwether/adapter/core';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { FeedState } from '../feed.js';
import { mixHex } from '../fellowship.js';
import { activityOf, isTired, sits } from '../map/activity.js';
import type { MapArt } from '../map/assets.js';
import { crateCount, crateSlots, firePoint, hasCart, horizonY, PROP_DX, sceneryLayout, SCENE_MIN, stationLayout, type Station } from '../map/camp.js';
import type { CampArt } from '../map/campart.js';
import { campPose, sweat, zzz } from '../map/pose.js';
import { pop } from '../map/growth.js';
import { beaconAlpha, hash01, walkFrame } from '../sim.js';
import { FRAME_NAMES, type FrameName } from '../sprites.js';
import { birthTime, prefersReducedMotion, spawnPose } from '../spawn.js';
import { memberBox, placeBubble, TAIL, type Rect } from '../map/bubble.js';
import type { Theme } from '../theme.js';
import { Figure } from './figure.js';
import type { LoadedArt } from './pack.js';
import { drawPuff } from './spawnfx.js';

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
/** Width of the party panel the scene leaves room for, in CSS pixels. */
export const PANEL_W = 372;

interface MView {
  figure?: Figure;
  sprite?: Sprite;
  prop: Sprite;
  seat: Sprite;
  mark: Sprite;
  zzz: Sprite[];
  sweat: Sprite;
  bubble: Container;
  bg: Graphics;
  text: Text;
  phase: number;
  born: number;
  act: string;
  bubbleKey?: string;
  actSince: number;
}

export interface CampDeps {
  theme: Theme;
  feed: FeedState;
  mapArt: MapArt;
  art: CampArt;
  figures: LoadedArt | null;
  /** Procedural sprite for packs without sprite sheets. */
  procTexture: (role: Member['role'], frame: FrameName, beacon: boolean) => Texture;
}

/**
 * The camp scene: one party's campsite drawn at an integer zoom beside the party panel. Members stay at their
 * stations around the fire and play the activity their status and tool call for.
 */
export class CampScene {
  readonly root = new Container();
  private skyG = new Graphics();
  private ground = new Container();
  private stage = new Container();
  private overlay = new Container();
  private lights = new Container();
  private fx = new Graphics();
  private vignette = new Graphics();
  private fade = new Graphics();
  private statics: Container[] = [];
  private gitLayer: Container[] = [];
  private gitSig = '';
  private fire!: Sprite;
  private glow!: Sprite;
  private floorGlow!: Sprite;
  private views = new Map<string, MView>();
  private stations = new Map<string, Station>();
  /** Bubbles placed so far this frame, so later ones keep clear of them. */
  private bubbleBoxes: Rect[] = [];
  private sig = '';
  private partyId = '';
  private size = { w: 320, h: 220 };
  private zoom = 3;
  private t = 0;
  private openedAt = 0;
  private reduced = prefersReducedMotion();
  private faces = new Map<string, string | undefined>();
  private primed = false;

  constructor(private deps: CampDeps) {
    this.stage.sortableChildren = true;
    this.root.addChild(this.skyG, this.ground, this.lights, this.stage, this.fx, this.overlay, this.vignette, this.fade);
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  enter(partyId: string): void {
    if (this.partyId !== partyId) this.reset();
    this.partyId = partyId;
    this.root.visible = true;
    this.openedAt = this.t;
  }

  leave(): void {
    this.root.visible = false;
  }

  private reset(): void {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    this.sig = '';
    this.primed = false;
  }

  /** A head-and-shoulders crop of a role's sprite as a data URL, for the party panel. Undefined without sprite sheets. */
  face(role: Member['role']): string | undefined {
    if (this.faces.has(role)) return this.faces.get(role);
    let url: string | undefined;
    try {
      const tex = this.deps.figures?.sheets[role]?.textures['idle_0'];
      const src = tex?.source.resource as CanvasImageSource | undefined;
      if (tex && src) {
        const c = document.createElement('canvas');
        c.width = 18;
        c.height = 20;
        c.getContext('2d')!.drawImage(src, tex.frame.x + 3, tex.frame.y, 18, 20, 0, 0, 18, 20);
        url = c.toDataURL();
      }
    } catch {
      url = undefined;
    }
    this.faces.set(role, url);
    return url;
  }

  /** Fits the scene into the part of the window left of the panel. Integer zoom keeps the pixels crisp. */
  private fit(areaW: number, areaH: number): void {
    // Whole-number zoom keeps pixels crisp; below 3x a quarter step is allowed so a smaller window still fills.
    const raw = Math.min(areaW / SCENE_MIN.w, areaH / SCENE_MIN.h);
    const z = Math.max(1, Math.min(6, raw >= 3 ? Math.floor(raw) : Math.floor(raw * 4) / 4));
    const w = Math.max(SCENE_MIN.w, Math.floor(areaW / z));
    const h = Math.max(SCENE_MIN.h, Math.floor(areaH / z));
    this.zoom = z;
    this.root.scale.set(z);
    this.root.position.set(Math.max(0, Math.floor((areaW - w * z) / 2)), Math.max(0, Math.floor((areaH - h * z) / 2)));
    this.size = { w, h };
  }

  update(dt: number, now: number, party: Party, tint: string | undefined, areaW: number, areaH: number): void {
    this.t += dt;
    this.fit(areaW, areaH);
    const { w, h } = this.size;
    const members = Object.values(party.members).sort((a, b) => a.paneId.localeCompare(b.paneId));
    const sig = `${party.id}|${w}x${h}|${members.map((m) => m.paneId).join(',')}|${this.deps.theme.name}`;
    if (sig !== this.sig) this.rebuild(sig, party, members);
    const f = firePoint(w, h);
    const look = this.deps.art.look;
    const outpost = look.tone === 'outpost';

    // Sky, clouds or stars.
    const sky = this.skyG.clear();
    const hz = horizonY(h);
    const bands = 12;
    for (let i = 0; i < bands; i++) sky.rect(0, Math.floor((hz * i) / bands), w, Math.ceil(hz / bands) + 1).fill(hexNum(mixHex(look.sky[0], look.sky[1], i / (bands - 1))));
    if (outpost) {
      for (let i = 0; i < 40; i++) {
        const tw = 0.5 + 0.5 * Math.sin(this.t * (1 + hash01(`s${i}`) * 2) + i);
        sky.rect(Math.floor(hash01(`sx${i}`) * w), Math.floor(hash01(`sy${i}`) * (hz - 10)), 1, 1).fill({ color: 0xffffff, alpha: 0.35 + 0.65 * tw });
      }
      sky.circle(w * 0.78, hz * 0.45, 13).fill(0x5a3a98).circle(w * 0.78 - 3, hz * 0.45 - 3, 9).fill(0x7a56b8);
    } else {
      sky.circle(w * 0.84, hz * 0.34, 7).fill({ color: 0xfff2b0, alpha: 0.9 });
      for (let i = 0; i < 4; i++) {
        const cx = ((hash01(`c${i}`) * (w + 80) + this.t * (3 + i)) % (w + 80)) - 40;
        const cy = 8 + hash01(`cy${i}`) * (hz - 34);
        sky.rect(cx, cy, 26, 4).fill({ color: 0xffffff, alpha: 0.75 }).rect(cx + 5, cy - 3, 14, 4).fill({ color: 0xffffff, alpha: 0.75 });
      }
    }

    // Fire, its light and the party's status ring.
    const reduced = this.reduced;
    const rate = party.status === 'working' ? 9 : 5;
    const frame = Math.floor(this.t * rate) % 4;
    this.fire.texture = this.deps.art.frame(`fire_${frame}`);
    this.fire.alpha = party.status === 'idle' || party.status === 'unknown' ? 0.8 : 1;
    const flick = 0.78 + 0.22 * Math.sin(this.t * 11) * Math.sin(this.t * 7.3);
    this.glow.alpha = (party.status === 'idle' ? 0.22 : 0.4) * flick * (outpost ? 0.7 : 1);
    this.floorGlow.alpha = (party.status === 'idle' ? 0.16 : 0.3) * flick * (outpost ? 0.4 : 1);
    const color = hexNum(this.deps.theme.palette[party.status]);
    const fx = this.fx.clear();
    fx.ellipse(f.x, f.y + 2, 36, 12).stroke({ color, width: 1, alpha: 0.35 + 0.35 * beaconAlpha(party.status, this.t) });
    for (let i = 0; i < 8; i++) {
      const p = (this.t * 0.35 + i / 8) % 1;
      fx.rect(Math.round(f.x + Math.sin(i * 12.9 + this.t * 0.7) * 7 * p + (hash01(`e${i}`) - 0.5) * 8), Math.round(f.y - 24 - p * 44), 1, 1).fill({ color: hexNum(look.glow), alpha: (1 - p) * 0.9 });
    }

    // Members.
    this.bubbleBoxes = [];
    const beaconPane = (members.find((m) => m.role === this.deps.theme.beacon) ?? members[0])?.paneId;
    for (const [id, v] of this.views) {
      if (!party.members[id]) {
        this.destroyView(v);
        this.views.delete(id);
      }
    }
    for (const m of members) {
      let v = this.views.get(m.paneId);
      const st = this.stations.get(m.paneId);
      if (!st) continue;
      if (!v) {
        v = this.makeView(m.paneId);
        v.born = birthTime(this.t, this.primed, reduced);
        this.views.set(m.paneId, v);
      }
      this.stepMember(v, st, m, party, tint, m.paneId === beaconPane, now);
    }
    this.primed = true;
    this.drawGit(party);

    // A soft fade in when the camp opens.
    const age = this.t - this.openedAt;
    this.fade.clear();
    if (!reduced && age < 0.3) this.fade.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 1 - age / 0.3 });
  }

  private makeView(paneId: string): MView {
    const art = this.deps.art;
    const mk = (parent: Container, anchorY = 1): Sprite => {
      const s = new Sprite();
      s.anchor.set(0.5, anchorY);
      parent.addChild(s);
      return s;
    };
    const figure = this.deps.figures ? new Figure(this.deps.figures, this.deps.theme) : undefined;
    const sprite = figure ? undefined : new Sprite();
    if (sprite) sprite.anchor.set(0.5, 1);
    const body = figure ? figure.container : sprite!;
    this.stage.addChild(body);
    const prop = mk(this.stage, 31 / 32);
    const seat = mk(this.stage);
    seat.texture = art.frame('seat');
    const mark = mk(this.overlay);
    const zs = [0, 1, 2].map((i) => {
      const s = mk(this.overlay, 0.5);
      s.texture = art.frame(`fx_zzz_${i}`);
      return s;
    });
    const sw = mk(this.overlay, 0.5);
    sw.texture = art.frame('fx_sweat');
    const bg = new Graphics();
    const text = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 7, fill: 0x1b1b24, wordWrap: true, wordWrapWidth: 92, lineHeight: 8 }, resolution: 4 });
    const bubble = new Container();
    bubble.addChild(bg, text);
    this.overlay.addChild(bubble);
    return { ...(figure ? { figure } : {}), ...(sprite ? { sprite } : {}), prop, seat, mark, zzz: zs, sweat: sw, bubble, bg, text, phase: hash01(paneId) * 10, born: 0, act: '', actSince: this.t };
  }

  private destroyView(v: MView): void {
    if (v.figure) v.figure.destroy();
    else v.sprite?.destroy();
    for (const s of [v.prop, v.seat, v.mark, ...v.zzz, v.sweat]) s.destroy();
    v.bubble.destroy({ children: true });
  }

  private stepMember(v: MView, st: Station, m: Member, party: Party, tint: string | undefined, beacon: boolean, now: number): void {
    const art = this.deps.art;
    const feed = this.deps.feed;
    const act = activityOf(m);
    if (v.act !== act) {
      v.act = act;
      v.actSince = this.t;
    }
    const tired = feed.vitalsOn && isTired(m);
    const sheet = this.deps.figures?.sheets[m.role];
    const has = !!sheet?.textures['work_0'];
    const talking = feed.talking(party.id, m.paneId, now);
    const pose = campPose(act, this.t, v.phase, has);
    let { anim, index } = pose;
    if (talking && !(act === 'blocked')) {
      anim = 'talk';
      index = Math.floor((this.t + v.phase) * 6) % 2;
    }
    const sit = sits(act);
    const dir = pose.face || st.side;
    const x = st.x + pose.dx;
    const y = st.y + pose.dy + (sit ? 4 : 0) + (tired ? 1 : 0);
    const counts = this.deps.figures?.art.character.counts as Record<string, number> | undefined;
    const frames = anim === 'work' ? 2 : (counts?.[anim] ?? 1);
    const body = v.figure ? v.figure.container : v.sprite!;
    if (v.figure) {
      v.figure.update({ member: m, partyStatus: party.status, isBeacon: beacon, moving: false, talking: false, t: this.t, phase: v.phase, tint, override: { anim, index: index % Math.max(1, frames) } }, dir, 1, x, y);
      if (tired) body.scale.y = 0.94;
    } else {
      const frame = FRAME_NAMES[walkFrame(anim === 'walk', this.t, v.phase)]!;
      v.sprite!.texture = this.deps.procTexture(m.role, frame, beacon);
      v.sprite!.scale.set(dir * 0.75, 0.75);
      v.sprite!.position.set(x, y);
      v.sprite!.alpha = 1;
      v.sprite!.tint = m.status === 'blocked' ? 0xffd0d0 : tint ? hexNum(mixHex('#ffffff', tint, 0.55)) : 0xffffff;
    }
    body.zIndex = st.y;
    // The member arrives like it does on the map: beamed in with a puff of sparks.
    const age = this.t - v.born;
    const sp = spawnPose(age);
    if (sp.alpha < 1 || sp.lift !== 0) {
      body.alpha *= sp.alpha;
      body.scale.x *= sp.sx;
      body.scale.y *= sp.sy;
      body.y -= sp.lift;
      drawPuff(this.fx, st.x, st.y, age, hexNum(this.deps.theme.palette[m.status]), 1, 12);
    }

    // Station prop: the thing they are working at, or the log they sit on.
    v.seat.visible = sit;
    v.prop.visible = !sit;
    if (sit) {
      v.seat.position.set(st.x, st.y + 6);
      v.seat.scale.x = dir;
      v.seat.zIndex = st.y + 1;
    } else {
      const name = `st_${act}_${pose.prop}`;
      v.prop.texture = art.frame(art.has(name) ? name : `st_think_0`);
      v.prop.position.set(st.x + st.side * PROP_DX, st.y + 1);
      const grow = this.reduced ? 1 : 0.5 + 0.5 * pop(this.t - v.actSince, 0.35);
      v.prop.scale.set(grow);
      // Benches and pots stand in front of the member; tall posts and boards stand behind.
      v.prop.zIndex = st.y + (act === 'edit' || act === 'shell' || act === 'delegate' ? 0.5 : -0.5);
    }

    // Marks over the head: the flashing alert, a question, z's, sweat.
    const headY = y - 37;
    const showMark = act === 'blocked' || act === 'unknown';
    v.mark.visible = showMark;
    if (showMark) {
      v.mark.texture = art.frame(act === 'blocked' ? `fx_alert_${pose.mark}` : 'fx_question');
      // Beside the head, on the side away from the fire, so it never covers the neighbour above.
      v.mark.position.set(Math.round(x - dir * 15), Math.round(y - 20 - (act === 'unknown' ? Math.round(Math.sin(this.t * 2.5 + v.phase) + 1) : 0)));
    }
    const zs = act === 'idle' ? zzz(this.t, v.phase) : [];
    v.zzz.forEach((s, i) => {
      const z = zs[i];
      s.visible = !!z;
      if (z) {
        s.position.set(Math.round(x + dir * (6 + z.x)), Math.round(headY + 8 + z.y));
        s.alpha = z.alpha;
      }
    });
    v.sweat.visible = tired;
    if (tired) {
      const s = sweat(this.t, v.phase);
      v.sweat.position.set(Math.round(x + dir * 9), Math.round(y - 27 + s.y));
      v.sweat.alpha = s.alpha;
    }

    // Speech bubble over the speaker.
    const say = feed.say(party.id, m.paneId, now);
    v.bubble.visible = !!say;
    if (say) {
      if (v.text.text !== say) v.text.text = say;
      const bw = v.text.width + 8;
      const bh = v.text.height + 6;
      const others: Rect[] = [...this.stations.values()].filter((o) => o.paneId !== m.paneId).map((o) => memberBox(o)).concat(this.bubbleBoxes);
      const pl = placeBubble({ speaker: { x, y }, size: { w: bw, h: bh }, obstacles: others, scene: this.size, lift: showMark ? 6 : 0 });
      this.bubbleBoxes.push({ x: pl.x, y: pl.y, w: bw, h: bh + TAIL });
      const tx = pl.tailX;
      const key = `${say}|${tx}|${pl.tailDown}`;
      if (key !== v.bubbleKey) {
        v.bubbleKey = key;
        const ink = { color: 0x1b1b24, width: 1 };
        const g = v.bg.clear().roundRect(0, 0, bw, bh, 3).fill({ color: 0xffffff, alpha: 0.95 }).stroke(ink);
        if (pl.tailDown) g.poly([tx - 3, bh - 0.5, tx + 3, bh - 0.5, tx, bh + TAIL]).fill({ color: 0xffffff }).moveTo(tx - 3, bh).lineTo(tx, bh + TAIL).lineTo(tx + 3, bh).stroke(ink);
        else g.poly([tx - 3, 0.5, tx + 3, 0.5, tx, -TAIL]).fill({ color: 0xffffff }).moveTo(tx - 3, 0).lineTo(tx, -TAIL).lineTo(tx + 3, 0).stroke(ink);
        v.text.position.set(4, 3);
      }
      v.bubble.position.set(pl.x, pl.tailDown ? pl.y : pl.y + TAIL);
    }
  }

  private rebuild(sig: string, party: Party, members: Member[]): void {
    this.sig = sig;
    const { w, h } = this.size;
    const { art, mapArt, theme } = this.deps;
    for (const c of this.statics) c.destroy({ children: true });
    this.statics = [];
    this.ground.removeChildren();
    this.lights.removeChildren();
    const keep = new Set<Container>([...this.views.values()].flatMap((v) => [v.figure?.container, v.sprite, v.prop, v.seat].filter((c): c is Container => !!c)));
    for (const c of this.stage.removeChildren()) if (keep.has(c as Container)) this.stage.addChild(c);

    const f = firePoint(w, h);
    const hz = horizonY(h);
    const outpost = art.look.tone === 'outpost';
    // Far hills (or ridges) along the horizon.
    const hills = new Graphics();
    const base = hexNum(mixHex(theme.ground, '#000000', 0.35));
    hills.moveTo(0, hz);
    for (let x = 0; x <= w; x += 8) hills.lineTo(x, hz - 6 - Math.round(7 * (0.5 + 0.5 * Math.sin(x * 0.045 + 1) * Math.sin(x * 0.013 + 2)) * (outpost ? 1.6 : 1)));
    hills.lineTo(w, hz).closePath().fill(base);
    this.ground.addChild(hills);
    // Ground: grass everywhere, a trodden clearing (or a plated bay) around the fire.
    for (let ty = hz / 16; ty * 16 < h; ty++) {
      for (let tx = 0; tx * 16 < w; tx++) {
        const cx = tx * 16 + 8;
        const cy = ty * 16 + 8;
        const dx = (cx - f.x) / (outpost ? 176 : 168);
        const dy = (cy - f.y) / (outpost ? 82 : 76);
        const noise = (hash01(`f${tx},${ty}`) - 0.5) * 0.28;
        const inClearing = outpost ? Math.max(Math.abs(dx), Math.abs(dy)) + noise * 0.4 < 1 && dx * dx + dy * dy < 1.9 : dx * dx + dy * dy + noise < 1;
        const name = inClearing ? `floor_${Math.floor(hash01(`v${tx},${ty}`) * 4)}` : hash01(`g${tx},${ty}`) < 0.07 && mapArt.hasTile('flowers') ? 'flowers' : `grass_${Math.floor(hash01(`g${tx},${ty}`) * 4)}`;
        const s = new Sprite(inClearing ? art.frame(name) : mapArt.tile(name));
        s.position.set(tx * 16, ty * 16);
        this.ground.addChild(s);
      }
    }
    // Scenery, drawn with the members so things behind them stay behind.
    const stations = stationLayout(members.map((m) => m.paneId), w, h);
    this.stations = new Map(stations.map((s) => [s.paneId, s]));
    const sc = sceneryLayout(w, h, stations, party.id, Math.max(1, Math.min(4, Math.ceil(members.length / 2))));
    const put = (name: string, x: number, y: number, scaleX = 1) => {
      const s = new Sprite(art.frame(name));
      s.anchor.set(0.5, 1);
      s.position.set(x, y);
      s.scale.x = scaleX;
      s.zIndex = y;
      this.stage.addChild(s);
      this.statics.push(s);
    };
    for (const [i, t] of sc.tents.entries()) put('tent', t.x, t.y, i % 2 ? -1 : 1);
    for (const t of sc.tall) put(`tall_${t.v}`, t.x, t.y, hash01(`${t.x}`) < 0.5 ? -1 : 1);
    for (const l of sc.low) put(`low_${l.v}`, l.x, l.y);

    this.fire = new Sprite(art.frame('fire_0'));
    this.fire.anchor.set(0.5, 36 / 40);
    this.fire.position.set(f.x, f.y);
    this.fire.zIndex = f.y;
    this.stage.addChild(this.fire);
    this.statics.push(this.fire);
    const glowTex = mapArt.prop('glow');
    const tintC = hexNum(art.look.glow);
    this.glow = new Sprite(glowTex);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = tintC;
    this.glow.scale.set(11);
    this.glow.position.set(f.x, f.y - 14);
    this.floorGlow = new Sprite(glowTex);
    this.floorGlow.anchor.set(0.5);
    this.floorGlow.blendMode = 'add';
    this.floorGlow.tint = tintC;
    this.floorGlow.scale.set(13, 5);
    this.floorGlow.position.set(f.x, f.y + 2);
    this.lights.addChild(this.floorGlow, this.glow);

    // Soft vignette at the edges.
    const vg = this.vignette.clear();
    for (let i = 0; i < 6; i++) vg.rect(i * 3, i * 3, w - i * 6, h - i * 6).stroke({ color: 0x000000, width: 3, alpha: 0.07, alignment: 0 });
    this.gitSig = '';
  }

  /** Crates for uncommitted files and a loaded cart for unpushed commits. Nothing when the party has no git state. */
  private drawGit(party: Party): void {
    const n = crateCount(party.git);
    const cart = hasCart(party.git);
    const sig = `${this.sig}|${n}|${cart}`;
    if (sig === this.gitSig) return;
    this.gitSig = sig;
    for (const c of this.gitLayer) c.destroy();
    this.gitLayer = [];
    const { w, h } = this.size;
    const art = this.deps.art;
    const put = (name: string, x: number, y: number, z: number) => {
      const s = new Sprite(art.frame(name));
      s.anchor.set(0.5, 1);
      s.position.set(Math.round(x), Math.round(y));
      s.zIndex = z;
      this.stage.addChild(s);
      this.gitLayer.push(s);
    };
    crateSlots(n).forEach((p, i) => put(`crate_${(i + (p.y < 0 ? 1 : 0)) % 2}`, w - 30 + p.x, h - 6 + p.y, h - 6 + p.y));
    if (cart) put('cart_loaded', 33, h - 6, h - 6);
  }
}
