import { rollup, type Member, type Role, type Status } from '@bellwether/adapter/core';
import { Application, Container, Graphics, NineSliceSprite, Sprite, Text, Texture } from 'pixi.js';
import { groupFellowships, mixHex, type Fellowship } from '../fellowship.js';
import type { FeedState } from '../feed.js';
import { assignRows, beaconAlpha, bob, bumps, hash01, stepWalker, walkFrame, MAX_ROWS, ROAM_ROWS, SPEED, type SpanView, type Walker } from '../sim.js';
import { beaconPixels, buildFrame, FRAME_NAMES, paletteFor, rasterize, SPRITE_H, SPRITE_W, type FrameName } from '../sprites.js';
import type { Theme } from '../theme.js';
import { DoubleTap } from '../doubletap.js';
import { birthTime, prefersReducedMotion, spawnPose, type SpawnPose } from '../spawn.js';
import { drawPuff } from './spawnfx.js';
import { Figure } from './figure.js';
import type { LoadedArt } from './pack.js';

interface MemberView {
  sprite: Sprite;
  /** Sprite-sheet mode: the shared figure (frame, cloak mask and status light). */
  figure?: Figure;
  /** Eased x so a group can reorder (leader to the front) without anyone teleporting. */
  x?: number;
  bubbleSkin?: NineSliceSprite;
  bubbleTail?: Sprite;
  glow: Graphics;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  phase: number;
  /** Scene time the member first appeared; arrival plays from here. */
  born: number;
}

/** One nameplate's worth of characters: a party, or a fellowship's leaders. */
interface Segment {
  /** Unique per segment (the party id, or `lead:<fellowship>`). */
  id: string;
  label: string;
  status: Status;
  tint?: string | undefined;
  leader: boolean;
  members: Member[];
  /** Width the segment takes along the strip: its characters or its nameplate, whichever is wider. */
  width: number;
  /** Pane id to the party that owns its speech. */
  sayParty: Map<string, string>;
}

interface Train {
  id: string;
  fellowship?: Fellowship | undefined;
  /** Leader segment first, then followers; or a single party. */
  segments: Segment[];
}

interface Extent {
  seg: Segment;
  /** Whole segment, nameplate included. */
  x0: number;
  x1: number;
  /** Just the characters. */
  fig0: number;
  fig1: number;
}

interface TrainView {
  walker: Walker;
  /** Eased depth row (0 = front); a group steps back smoothly when the strip fills up. */
  depth: number;
  tether: Graphics;
  banner: Graphics;
}

interface PartyView {
  root: Container;
  label: Text;
  plate?: NineSliceSprite;
  icon?: Sprite;
  chip: Graphics;
  members: Map<string, MemberView>;
  dir: 1 | -1;
  born: number;
}

/** Colour of a leader's banner pole, tether and nameplate chip. */
const GOLD = 0xe8c547;
/** Width reserved for a leader's banner, in art pixels. */
const BANNER_W = 18;

/** Rows of the 16px ground tile that show above the window's bottom edge, in art pixels. */
const GROUND_SHOW = 8;
/** Extra rows of ground shown in minimal mode, so the status icon fits below the feet. */
const ICON_ROOM = 8;
/** How far a character's feet sink into the ground, in art pixels. */
const FEET_SINK = 3;
/** How far each depth row stands behind the one in front, in art pixels. */
export const ROW_LIFT = 4;
/** Brightness of each depth row: the back rows are in the shade. */
const ROW_SHADE = [0xffffff, 0xd8d8d8, 0xb4b4b4, 0x929292];

/** Walker state one strip window shares with the others when the strip spans monitors. */
export type WalkerSync = [id: string, x: number, dir: 1 | -1][];

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

/** Strip mode: parties walk along a ground line at the bottom of the window. */
export class StripScene {
  private textures = new Map<string, { texture: Texture; grid: string[] }>();
  private parties = new Map<string, PartyView>();
  private trains = new Map<string, TrainView>();
  private ground = new Graphics();
  private layer = new Container();
  private t = 0;
  /** Arrival puffs, redrawn every frame on top of the characters. */
  private fx = new Graphics();
  /** False until the first world arrives, so what already exists does not play an arrival. */
  private primed = false;
  private reduced = prefersReducedMotion();

  private doubleTap = new DoubleTap();
  /** One container per depth row, back rows first so they draw behind. */
  private rowLayers: Container[] = [];
  /** Eased number of back rows; the ground grows deeper with it. */
  private groundDepth = 0;
  /** Walker positions from the lead window, applied on the next frame. */
  private adopted: Map<string, Walker> | undefined;

  constructor(
    private app: Application,
    private theme: Theme,
    private feed: FeedState,
    private scale: number,
    private art: LoadedArt | null = null,
    /** Minimal labels: no nameplate above the heads, just a small status icon below the feet. */
    private minimal = false,
    /** This window's slice of a strip spanning several monitors; absent means the window is the whole strip. */
    private span?: SpanView,
  ) {
    this.baseShow = GROUND_SHOW + (minimal ? ICON_ROOM : 0);
    this.groundShow = this.baseShow;
    for (let r = 0; r < MAX_ROWS; r++) {
      const row = new Container();
      row.tint = ROW_SHADE[r] ?? 0x808080;
      this.rowLayers.push(row);
    }
    this.layer.addChild(...[...this.rowLayers].reverse());
    app.stage.addChild(this.ground, this.layer, this.fx);
    this.ground.eventMode = 'none';
    this.fx.eventMode = 'none';
  }

  private baseShow = GROUND_SHOW;
  private groundShow = GROUND_SHOW;
  private groundTiles: Sprite[] = [];
  private groundWidth = 0;
  private groundRows = 0;

  /** Width of the whole strip: every monitor's worth when spanning. */
  private worldWidth(): number {
    return this.span?.total ?? this.app.screen.width;
  }

  /** Current walker positions, for the lead window to share. */
  walkers(): WalkerSync {
    return [...this.trains].map(([id, tv]) => [id, tv.walker.x, tv.walker.dir]);
  }

  /** Take the lead window's walker positions so every monitor shows the same strip. */
  adopt(list: WalkerSync): void {
    this.adopted = new Map(list.map(([id, x, dir]) => [id, { x, dir }]));
  }

  /** Rebuilds the ground strip from the pack's tiles. Only the top rows show; the rest sits below the window. */
  private layoutGround(width: number, height: number) {
    const a = this.art!;
    const s = this.scale;
    const tile = 16 * s;
    // A crowded strip shows more ground (the back rows stand on it), so it may need a second row of tiles.
    const rows = Math.max(1, Math.ceil(this.groundShow / 16));
    if (width !== this.groundWidth || rows !== this.groundRows || this.groundTiles.length === 0) {
      for (const t of this.groundTiles) t.destroy();
      this.groundTiles = [];
      const names = a.art.ground.tiles;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i * tile < width; i++) {
          const tex = a.ground.textures[names[Math.floor(hash01(r ? `g${i}r${r}` : `g${i}`) * names.length)]!]!;
          const sp = new Sprite(tex);
          sp.scale.set(s);
          sp.x = i * tile;
          this.ground.addChild(sp);
          this.groundTiles.push(sp);
        }
      }
      this.groundWidth = width;
      this.groundRows = rows;
    }
    const perRow = this.groundTiles.length / rows;
    this.groundTiles.forEach((t, k) => (t.y = height - this.groundShow * s + Math.floor(k / perRow) * tile));
  }

  private frame(role: Role, frame: FrameName, beacon: boolean) {
    const key = `${role}|${frame}|${beacon}`;
    let entry = this.textures.get(key);
    if (!entry) {
      const look = this.theme.roles[role];
      const grid = buildFrame(look, frame, beacon);
      const canvas = document.createElement('canvas');
      canvas.width = SPRITE_W;
      canvas.height = SPRITE_H;
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(new ImageData(rasterize(grid, paletteFor(look, this.theme)), SPRITE_W, SPRITE_H), 0, 0);
      const texture = Texture.from(canvas);
      texture.source.scaleMode = 'nearest';
      entry = { texture, grid };
      this.textures.set(key, entry);
    }
    return entry;
  }

  private makeMember(party: PartyView, paneId: string): MemberView {
    const sprite = new Sprite();
    sprite.anchor.set(0.5, 1);
    const figure = this.art ? new Figure(this.art, this.theme) : undefined;
    const glow = new Graphics();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0x1b1b24 } });
    const bubble = new Container();
    const view: MemberView = { sprite, ...(figure ? { figure } : {}), glow, bubble, bubbleText, bubbleBg, phase: hash01(paneId) * 10, born: birthTime(this.t, this.primed, this.reduced) };
    if (this.art) {
      const ui = this.art.art.ui;
      const sl = ui.bubble.slice;
      view.bubbleSkin = new NineSliceSprite({ texture: this.art.ui.textures[ui.bubble.frame]!, leftWidth: sl, topHeight: sl, rightWidth: sl, bottomHeight: sl });
      view.bubbleSkin.scale.set(this.scale);
      if (ui.bubble.tail) {
        view.bubbleTail = new Sprite(this.art.ui.textures[ui.bubble.tail]!);
        view.bubbleTail.anchor.set(0.5, 0);
        view.bubbleTail.scale.set(this.scale);
      }
      bubble.addChild(view.bubbleSkin, ...(view.bubbleTail ? [view.bubbleTail] : []), bubbleText);
    } else {
      bubble.addChild(bubbleBg, bubbleText);
    }
    const body = figure ? figure.container : sprite;
    body.eventMode = 'static';
    body.cursor = 'pointer';
    body.on('pointertap', () => {
      if (this.doubleTap.tap(paneId, performance.now())) this.feed.onFocus?.(paneId);
    });
    party.root.addChild(body, glow, bubble);
    party.members.set(paneId, view);
    return view;
  }

  private makePartyShell(id: string): PartyView {
    const root = new Container();
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    label.anchor.set(0.5, 1);
    let plate: NineSliceSprite | undefined;
    if (this.art) {
      const np = this.art.art.ui.nameplate;
      plate = new NineSliceSprite({ texture: this.art.ui.textures[np.frame]!, leftWidth: np.slice, topHeight: np.slice, rightWidth: np.slice, bottomHeight: np.slice });
      plate.scale.set(this.scale);
      label.style = { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff };
      root.addChild(plate);
    }
    let icon: Sprite | undefined;
    if (this.art) {
      icon = new Sprite();
      icon.scale.set(this.scale);
      root.addChild(icon);
    }
    const chip = new Graphics();
    root.addChild(chip, label);
    this.rowLayers[0]!.addChild(root);
    const view: PartyView = { root, label, ...(plate ? { plate } : {}), ...(icon ? { icon } : {}), chip, members: new Map(), dir: 1, born: birthTime(this.t, this.primed, this.reduced) };
    root.alpha = this.primed && !this.reduced ? 0 : 1;
    this.parties.set(id, view);
    return view;
  }

  private trainFor(world: ReturnType<typeof groupFellowships>): Train[] {
    const trains: Train[] = [];
    const seg = (id: string, label: string, members: Member[], origin: (m: Member) => string, tint: string | undefined, leader: boolean): Segment => {
      const sorted = [...members].sort((a, b) => a.paneId.localeCompare(b.paneId));
      return { id, label, status: rollup(sorted), tint, leader, members: sorted, width: 0, sayParty: new Map(sorted.map((m) => [m.paneId, origin(m)])) };
    };
    for (const f of world.fellowships) {
      const leaders = f.leaders.map((l) => l.member);
      const partyOf = new Map(f.leaders.map((l) => [l.member.paneId, l.partyId]));
      const segments = [seg(`lead:${f.key}`, `★ ${f.name}`, leaders, (m) => partyOf.get(m.paneId)!, undefined, true)];
      for (const id of f.partyIds) {
        const p = world.world.parties[id]!;
        segments.push(seg(id, p.branch ? `${p.label} · ${p.branch}` : p.label, Object.values(p.members), () => id, world.tints.get(id), false));
      }
      trains.push({ id: `fellow:${f.key}`, fellowship: f, segments });
    }
    for (const p of Object.values(world.world.parties)) {
      if (world.byParty.has(p.id)) continue;
      trains.push({ id: p.id, segments: [seg(p.id, p.branch ? `${p.label} · ${p.branch}` : p.label, Object.values(p.members), () => p.id, world.tints.get(p.id), false)] });
    }
    return trains;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.fx.clear();
    const { height } = this.app.screen;
    const width = this.worldWidth();
    // Spanning monitors: this window shows its own slice of the one long strip.
    this.app.stage.x = -(this.span?.offset ?? 0);
    const s = this.scale;
    const art = this.art?.art;
    const figW = art ? art.character.w : SPRITE_W;
    const figH = art ? art.character.h : SPRITE_H;

    const fv = groupFellowships(this.feed.world);
    const trains = this.trainFor(fv);
    // Art characters have transparent margins; pack them a little tighter than their box.
    const spacing = (art ? figW * 0.7 : SPRITE_W + 3) * s;
    const gap = spacing * 0.6;
    for (const t of trains) {
      for (const seg of t.segments) {
        const view = this.parties.get(seg.id) ?? this.makePartyShell(seg.id);
        const own = Math.max(0, seg.members.length - 1) * spacing + figW * s;
        const chrome = view.plate ? (6 * 2 + (view.icon ? 12 : 0)) * s : 0;
        // A nameplate may be a little wider than its characters, never much: long labels get an ellipsis.
        const room = Math.max(own * 1.25, 90 * s) - chrome;
        view.label.text = seg.label;
        let text = seg.label;
        while (view.label.width > room && text.length > 4) {
          text = `${text.slice(0, -2).trimEnd()}…`;
          view.label.text = text;
        }
        seg.label = text;
        seg.width = Math.max(own + (seg.leader ? BANNER_W * s : 0), view.label.width + chrome);
      }
    }
    const spanOf = (t: Train) => t.segments.reduce((n, g) => n + g.width, 0) + (t.segments.length - 1) * gap;
    // Everyone roams the whole strip (every monitor's worth when spanning). Groups are dealt into
    // depth rows so they cross paths, passing behind each other; a crowd opens extra rows.
    const rowOf = assignRows(trains.map((t) => ({ id: t.id, span: spanOf(t) })), width - 32, ROAM_ROWS);
    const lane = { start: 16, end: width - 16 };
    const backRows = Math.max(0, ...rowOf.values());
    const ease = 1 - Math.exp(-3 * dt);
    this.groundDepth += (backRows - this.groundDepth) * ease;
    if (Math.abs(backRows - this.groundDepth) < 0.01) this.groundDepth = backRows;
    this.groundShow = this.baseShow + Math.ceil(this.groundDepth * ROW_LIFT);
    let groundY: number;
    if (art) {
      this.layoutGround(width, height);
      groundY = height - (this.baseShow - FEET_SINK) * s;
    } else {
      const groundH = (3 + this.groundDepth * ROW_LIFT) * s;
      groundY = height - 3 * s;
      this.ground.clear().rect(0, height - groundH, width, groundH).fill(hexNum(this.theme.ground));
    }

    const liveSegs = new Set(trains.flatMap((t) => t.segments.map((g) => g.id)));
    for (const [id, view] of this.parties) {
      if (!liveSegs.has(id)) {
        view.root.destroy({ children: true });
        this.parties.delete(id);
      }
    }
    const liveTrains = new Set(trains.map((t) => t.id));
    for (const [id, tv] of this.trains) {
      if (!liveTrains.has(id)) {
        tv.tether.destroy();
        tv.banner.destroy();
        this.trains.delete(id);
      }
    }

    // Step every walker first, then turn around whoever is walking into a neighbour in its own row.
    const statusOf = new Map(trains.map((t) => [t.id, rollup(t.segments.flatMap((g) => g.members))]));
    const leads = !this.span || this.span.offset === 0;
    for (const train of trains) {
      const span = spanOf(train);
      let tv = this.trains.get(train.id);
      if (!tv) {
        const tether = new Graphics();
        const banner = new Graphics();
        this.layer.addChildAt(tether, 0);
        this.layer.addChild(banner);
        tv = { walker: { x: lane.start + hash01(train.id) * Math.max(0, lane.end - lane.start - span), dir: hash01(train.id + '!') > 0.5 ? 1 : -1 }, depth: rowOf.get(train.id) ?? 0, tether, banner };
        this.trains.set(train.id, tv);
      }
      const shared = this.adopted?.get(train.id);
      if (shared) tv.walker = shared;
      const status = statusOf.get(train.id)!;
      tv.walker = stepWalker(tv.walker, status, lane, span, dt);
      // Now and then a group changes its mind and wanders back. Only the lead window decides; the others follow it.
      if (leads && SPEED[status] > 0 && Math.random() < dt / 20) tv.walker = { ...tv.walker, dir: tv.walker.dir === 1 ? -1 : 1 };
    }
    for (let r = 0; r <= backRows; r++) {
      const row = trains
        .filter((t) => rowOf.get(t.id) === r)
        .map((t) => ({ id: t.id, x: this.trains.get(t.id)!.walker.x, dir: this.trains.get(t.id)!.walker.dir, span: spanOf(t), speed: SPEED[statusOf.get(t.id)!] }));
      for (const id of bumps(row)) {
        const tv = this.trains.get(id)!;
        tv.walker = { ...tv.walker, dir: tv.walker.dir === 1 ? -1 : 1 };
      }
    }

    for (const train of trains) {
      const tv = this.trains.get(train.id)!;
      const row = rowOf.get(train.id) ?? 0;
      tv.depth += (row - tv.depth) * ease;
      if (Math.abs(row - tv.depth) < 0.01) tv.depth = row;
      // Back rows stand a little higher on the ground and draw behind the front.
      const rowLayer = this.rowLayers[Math.min(row, MAX_ROWS - 1)]!;
      if (tv.tether.parent !== rowLayer) rowLayer.addChildAt(tv.tether, 0);
      if (tv.banner.parent !== rowLayer) rowLayer.addChild(tv.banner);
      for (const seg of train.segments) {
        const root = this.parties.get(seg.id)?.root;
        if (root && root.parent !== rowLayer) rowLayer.addChild(root);
      }
      const trainGround = groundY - tv.depth * ROW_LIFT * s;
      const status = statusOf.get(train.id)!;
      const moving = SPEED[status] > 0;
      const dir = tv.walker.dir;
      // The leader walks at the front: right end when heading right, left end when heading left.
      const order = dir === 1 ? [...train.segments].reverse() : train.segments;

      let off = 0;
      const extents: Extent[] = [];
      for (const seg of order) {
        const view = this.parties.get(seg.id) ?? this.makePartyShell(seg.id);
        view.dir = dir;
        for (const [paneId, mv] of view.members) {
          if (!seg.members.some((m) => m.paneId === paneId)) {
            if (mv.figure) mv.figure.destroy();
            else mv.sprite.destroy();
            mv.glow.destroy();
            mv.bubble.destroy({ children: true });
            view.members.delete(paneId);
          }
        }
        const own = Math.max(0, seg.members.length - 1) * spacing + figW * s;
        // Characters centre inside the segment when its nameplate is the wider part.
        // A leader reserves room ahead of itself for its banner, so the flag always fits in the window.
        const reserve = seg.leader ? BANNER_W * s : 0;
        const x0 = tv.walker.x + off + (dir === 1 ? 0 : reserve) + (seg.width - reserve - own) / 2;
        seg.members.forEach((m, i) => {
          const mv = view.members.get(m.paneId) ?? this.makeMember(view, m.paneId);
          const target = x0 + i * spacing + (figW * s) / 2;
          mv.x = mv.x === undefined ? target : mv.x + (target - mv.x) * (1 - Math.exp(-8 * dt));
          const beaconPane = (seg.members.find((q) => q.role === this.theme.beacon) ?? seg.members[0])?.paneId;
          const sayParty = seg.sayParty.get(m.paneId)!;
          if (art) this.drawArtMember(mv, m, view, seg, sayParty, seg.leader || m.paneId === beaconPane, mv.x, trainGround, moving, now);
          else this.drawMember(mv, m, view, seg, sayParty, seg.leader || m.paneId === beaconPane, mv.x, trainGround, moving, now);
        });
        const x1 = x0 + own;
        extents.push({ seg, x0: tv.walker.x + off, x1: tv.walker.x + off + seg.width, fig0: x0, fig1: x1 });
        off += seg.width + gap;
      }

      for (const { seg, fig0, fig1 } of extents) {
        const view = this.parties.get(seg.id)!;
        view.root.alpha = spawnPose(this.t - view.born).alpha;
        const center = (fig0 + fig1) / 2;
        view.label.text = seg.label;
        view.label.visible = !this.minimal;
        if (view.plate) view.plate.visible = !this.minimal;
        if (view.icon) view.icon.visible = true;
        if (this.minimal) {
          // Minimal: only a status icon (or a coloured square without art) centred just under the feet.
          view.chip.clear();
          if (view.icon && art) {
            view.icon.texture = this.art!.ui.textures[art.ui.statusIcons[seg.status]] ?? Texture.EMPTY;
            view.icon.position.set(center - (9 * s) / 2, trainGround + s);
          } else {
            view.chip.rect(center - 2 * s, trainGround + s, 4 * s, 4 * s).fill(hexNum(this.theme.palette[seg.status]));
          }
        } else if (view.plate) {
          // Nameplate sits above the heads; the status icon colour rides on the label tint.
          const padX = 6 * s;
          const padY = 3 * s;
          const iconW = view.icon ? 9 * s + 3 * s : 0;
          const w = view.label.width + padX * 2 + iconW;
          const h = view.label.height + padY * 2;
          view.plate.width = w / s;
          view.plate.height = h / s;
          const top = trainGround - figH * s - 6 - h;
          view.plate.position.set(center - w / 2, top);
          view.label.style.fill = 0xffffff;
          view.label.anchor.set(0, 0.5);
          view.label.position.set(center - w / 2 + padX + iconW, top + h / 2);
          if (view.icon) {
            view.icon.texture = this.art!.ui.textures[art!.ui.statusIcons[seg.status]] ?? Texture.EMPTY;
            view.icon.position.set(center - w / 2 + padX, top + h / 2 - (9 * s) / 2);
          }
          this.drawChip(view, seg, center - w / 2, top + h, w, s);
        } else {
          view.label.style.fill = hexNum(this.theme.palette[seg.status]);
          view.label.position.set(center, trainGround - figH * s - 4);
          this.drawChip(view, seg, center - view.label.width / 2, trainGround - figH * s - 2, view.label.width, s);
        }
      }
      this.drawTrain(tv, train, extents, dir, trainGround, figW, figH, s);
    }
    this.adopted = undefined;
    if (trains.length) this.primed = true;
  }

  /** Beam a new member in (fade, stretch, drop) and puff sparks in the party's status colour at its feet. */
  private arrive(mv: MemberView, body: { alpha: number; scale: { x: number; y: number }; y: number }, cx: number, groundY: number, status: Status): void {
    const age = this.t - mv.born;
    const pose: SpawnPose = spawnPose(age);
    if (pose.alpha >= 1 && pose.lift === 0) return;
    const s = this.scale;
    body.alpha *= pose.alpha;
    body.scale.x *= pose.sx;
    body.scale.y *= pose.sy;
    body.y -= pose.lift * s;
    drawPuff(this.fx, cx, groundY, age, hexNum(this.theme.palette[status]), s);
  }

  /** A coloured bar under a nameplate in the party's fellowship tint (gold for a leader). */
  private drawChip(view: PartyView, seg: Segment, x: number, y: number, w: number, s: number): void {
    view.chip.clear();
    const color = seg.leader ? GOLD : seg.tint ? hexNum(seg.tint) : undefined;
    if (color === undefined) return;
    view.chip.rect(x, y, w, 2 * s).fill(color);
  }

  /**
   * A led group shows who leads: a gold banner pole rises behind the leader, its flag striped in
   * the tint of every party it leads, and a tether runs along the ground through the whole group.
   */
  private drawTrain(tv: TrainView, train: Train, extents: Extent[], dir: 1 | -1, groundY: number, figW: number, figH: number, s: number): void {
    tv.tether.clear();
    tv.banner.clear();
    const f = train.fellowship;
    if (!f) return;
    const left = extents[0]!.x0;
    const right = extents[extents.length - 1]!.x1;
    tv.tether.rect(left, groundY + 1.5 * s, right - left, s).fill({ color: GOLD, alpha: 0.7 });
    for (const { seg, x0, x1 } of extents) {
      const color = seg.leader ? GOLD : seg.tint ? hexNum(seg.tint) : GOLD;
      tv.tether.rect(x0, groundY + 1.5 * s, x1 - x0, 2 * s).fill(color);
    }
    const lead = extents.find((e) => e.seg.leader)!;
    // The pole stands just ahead of the leader at head height; the flag streams forward from it.
    const poleX = dir === 1 ? lead.fig1 + 2 * s : lead.fig0 - 2 * s;
    const fw = (BANNER_W - 4) * s;
    const fh = 10 * s;
    const top = groundY - figH * s;
    tv.banner.rect(poleX - s / 2, top - 2 * s, s, groundY - top + 2 * s).fill(0x2a2118);
    tv.banner.rect(poleX - 1.5 * s, top - 4 * s, 3 * s, 2 * s).fill(GOLD);
    const stripes = extents.filter((e) => !e.seg.leader && e.seg.tint).map((e) => hexNum(e.seg.tint!));
    const fx = dir === 1 ? poleX + s / 2 : poleX - s / 2 - fw;
    const n = Math.max(1, stripes.length);
    (stripes.length ? stripes : [GOLD]).forEach((c, i) => tv.banner.rect(fx, top + (fh / n) * i, fw, fh / n).fill(c));
    tv.banner.rect(fx, top, fw, fh).stroke({ color: 0x2a2118, width: s, alignment: 1 });
  }

  /** Sprite-sheet member: pick the animation, tint the cloak and the status light from their masks. */
  private drawArtMember(mv: MemberView, m: Member, view: PartyView, seg: Segment, sayParty: string, isBeacon: boolean, cx: number, groundY: number, moving: boolean, now: number) {
    const loaded = this.art!;
    const s = this.scale;
    const { art } = loaded;
    const text = this.feed.say(sayParty, m.paneId, now);
    const dir = view.dir;
    const y = groundY + bob(m.status, this.t, mv.phase);
    mv.figure!.update({ member: m, partyStatus: seg.status, isBeacon, moving: moving && m.status !== 'blocked', talking: this.feed.talking(sayParty, m.paneId, now), t: this.t, phase: mv.phase, tint: seg.tint }, dir, s, cx, y);
    this.arrive(mv, mv.figure!.container, cx, groundY, seg.status);

    mv.bubble.visible = !!text;
    if (text) {
      const ui = art.ui.bubble;
      const sk = mv.bubbleSkin!;
      if (mv.bubbleText.text !== text) mv.bubbleText.text = text;
      const padX = 5 * s;
      const padY = 3 * s;
      const w = mv.bubbleText.width + padX * 2;
      const h = mv.bubbleText.height + padY * 2;
      sk.width = w / s;
      sk.height = h / s;
      mv.bubbleText.position.set(padX, padY);
      if (mv.bubbleTail) mv.bubbleTail.position.set(w / 2, h - s);
      const maxX = this.worldWidth() - w - 4;
      const above = art.character.h * s + (ui.tail ? 6 * s : 0) + (view.plate ? 14 * s : 6);
      mv.bubble.position.set(Math.max(4, Math.min(maxX, cx - w / 2)), y - above - h);
    }
  }

  private drawMember(mv: MemberView, m: Member, view: PartyView, seg: Segment, sayParty: string, isBeacon: boolean, cx: number, groundY: number, moving: boolean, now: number) {
    const s = this.scale;
    const memberMoving = moving && m.status !== 'blocked';
    const frameName = FRAME_NAMES[walkFrame(memberMoving, this.t, mv.phase)]!;
    const { texture, grid } = this.frame(m.role, frameName, isBeacon);
    const dir = view.dir;
    const y = groundY + bob(m.status, this.t, mv.phase);
    mv.sprite.texture = texture;
    mv.sprite.scale.set(dir * s, s);
    mv.sprite.position.set(cx, y);
    mv.sprite.alpha = m.status === 'idle' || m.status === 'unknown' ? 0.85 : 1;
    mv.sprite.tint = seg.tint ? hexNum(mixHex('#ffffff', seg.tint, 0.55)) : 0xffffff;
    this.arrive(mv, mv.sprite, cx, groundY, seg.status);

    mv.glow.clear();
    if (isBeacon) {
      const color = hexNum(this.theme.palette[seg.status]);
      const alpha = beaconAlpha(seg.status, this.t);
      for (const p of beaconPixels(grid)) {
        const gx = cx + dir * (p.x - SPRITE_W / 2 + 0.5) * s;
        const gy = y - (SPRITE_H - p.y - 0.5) * s;
        mv.glow.circle(gx, gy, 3.5 * s).fill({ color, alpha: alpha * 0.25 });
        mv.glow.rect(gx - s / 2, gy - s / 2, s, s).fill({ color, alpha });
      }
    }

    const text = this.feed.say(sayParty, m.paneId, now);
    mv.bubble.visible = !!text;
    if (text) {
      if (mv.bubbleText.text !== text) {
        mv.bubbleText.text = text;
        const w = mv.bubbleText.width + 10;
        const h = mv.bubbleText.height + 6;
        mv.bubbleBg.clear().roundRect(0, 0, w, h, 4).fill({ color: 0xffffff, alpha: 0.92 }).moveTo(w / 2 - 4, h).lineTo(w / 2, h + 5).lineTo(w / 2 + 4, h).fill({ color: 0xffffff, alpha: 0.92 });
        mv.bubbleText.position.set(5, 3);
      }
      const bw = mv.bubbleBg.width;
      const maxX = this.worldWidth() - bw - 4;
      mv.bubble.position.set(Math.max(4, Math.min(maxX, cx - bw / 2)), y - SPRITE_H * s - 46);
    }
  }
}
