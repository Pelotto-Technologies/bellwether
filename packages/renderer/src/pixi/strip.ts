import type { Member, Party, Role } from '@bellwether/adapter/core';
import { Application, Container, Graphics, NineSliceSprite, Sprite, Text, Texture } from 'pixi.js';
import type { FeedState } from '../feed.js';
import { beaconAlpha, bob, hash01, layoutLanes, memberX, stepWalker, walkFrame, SPEED, type Walker } from '../sim.js';
import { beaconPixels, buildFrame, FRAME_NAMES, paletteFor, rasterize, SPRITE_H, SPRITE_W, type FrameName } from '../sprites.js';
import type { Theme } from '../theme.js';
import { Figure } from './figure.js';
import type { LoadedArt } from './pack.js';

interface MemberView {
  sprite: Sprite;
  /** Sprite-sheet mode: the shared figure (frame, cloak mask and status light). */
  figure?: Figure;
  bubbleSkin?: NineSliceSprite;
  bubbleTail?: Sprite;
  glow: Graphics;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  phase: number;
}

interface PartyView {
  root: Container;
  label: Text;
  plate?: NineSliceSprite;
  icon?: Sprite;
  members: Map<string, MemberView>;
  walker: Walker;
}

/** Rows of the 16px ground tile that show above the window's bottom edge, in art pixels. */
const GROUND_SHOW = 8;
/** How far a character's feet sink into the ground, in art pixels. */
const FEET_SINK = 3;

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

/** Strip mode: parties walk along a ground line at the bottom of the window. */
export class StripScene {
  private textures = new Map<string, { texture: Texture; grid: string[] }>();
  private parties = new Map<string, PartyView>();
  private ground = new Graphics();
  private layer = new Container();
  private t = 0;

  constructor(
    private app: Application,
    private theme: Theme,
    private feed: FeedState,
    private scale: number,
    private art: LoadedArt | null = null,
  ) {
    app.stage.addChild(this.ground, this.layer);
    this.ground.eventMode = 'none';
  }

  private groundTiles: Sprite[] = [];
  private groundWidth = 0;

  /** Rebuilds the ground strip from the pack's tiles. Only the top rows show; the rest sits below the window. */
  private layoutGround(width: number, height: number) {
    const a = this.art!;
    const s = this.scale;
    const tile = 16 * s;
    if (width !== this.groundWidth || this.groundTiles.length === 0) {
      for (const t of this.groundTiles) t.destroy();
      this.groundTiles = [];
      const names = a.art.ground.tiles;
      for (let i = 0; i * tile < width; i++) {
        const tex = a.ground.textures[names[Math.floor(hash01(`g${i}`) * names.length)]!]!;
        const sp = new Sprite(tex);
        sp.scale.set(s);
        sp.x = i * tile;
        this.ground.addChild(sp);
        this.groundTiles.push(sp);
      }
      this.groundWidth = width;
    }
    for (const t of this.groundTiles) t.y = height - GROUND_SHOW * s;
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
    const view: MemberView = { sprite, ...(figure ? { figure } : {}), glow, bubble, bubbleText, bubbleBg, phase: hash01(paneId) * 10 };
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
    party.root.addChild(figure ? figure.container : sprite, glow, bubble);
    party.members.set(paneId, view);
    return view;
  }

  private makeParty(party: Party, lane: { start: number; end: number }): PartyView {
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
    root.addChild(label);
    this.layer.addChild(root);
    const start = lane.start + hash01(party.id) * Math.max(0, lane.end - lane.start - 60);
    const view: PartyView = { root, label, ...(plate ? { plate } : {}), ...(icon ? { icon } : {}), members: new Map(), walker: { x: start, dir: hash01(party.id + '!') > 0.5 ? 1 : -1 } };
    this.parties.set(party.id, view);
    return view;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    const { width, height } = this.app.screen;
    const s = this.scale;
    const art = this.art?.art;
    const figW = art ? art.character.w : SPRITE_W;
    const figH = art ? art.character.h : SPRITE_H;
    let groundY: number;
    if (art) {
      this.layoutGround(width, height);
      groundY = height - (GROUND_SHOW - FEET_SINK) * s;
    } else {
      const groundH = 3 * s;
      groundY = height - groundH;
      this.ground.clear().rect(0, groundY, width, groundH).fill(hexNum(this.theme.ground));
    }

    const world = this.feed.world;
    const lanes = layoutLanes(Object.keys(world.parties), width);

    for (const [id, view] of this.parties) {
      if (!world.parties[id]) {
        view.root.destroy({ children: true });
        this.parties.delete(id);
      }
    }

    // Art characters have transparent margins; pack them a little tighter than their box.
    const spacing = (art ? figW * 0.7 : SPRITE_W + 3) * s;
    for (const party of Object.values(world.parties)) {
      const lane = lanes.get(party.id)!;
      const view = this.parties.get(party.id) ?? this.makeParty(party, lane);
      const members = Object.values(party.members).sort((a, b) => a.paneId.localeCompare(b.paneId));
      const span = Math.max(0, members.length - 1) * spacing + figW * s;
      view.walker = stepWalker(view.walker, party.status, lane, span, dt);
      const moving = SPEED[party.status] > 0;
      const beaconPane = (members.find((m) => m.role === this.theme.beacon) ?? members[0])?.paneId;

      for (const [paneId, mv] of view.members) {
        if (!party.members[paneId]) {
          if (mv.figure) mv.figure.destroy();
          else mv.sprite.destroy();
          mv.glow.destroy();
          mv.bubble.destroy({ children: true });
          view.members.delete(paneId);
        }
      }

      members.forEach((m, i) => {
        const mv = view.members.get(m.paneId) ?? this.makeMember(view, m.paneId);
        const cx = memberX(view.walker.x, i, spacing) + (figW * s) / 2;
        if (art) this.drawArtMember(mv, m, party, m.paneId === beaconPane, cx, groundY, moving, now);
        else this.drawMember(mv, m, party, m.paneId === beaconPane, cx, groundY, moving, now);
      });

      const center = view.walker.x + span / 2;
      const text = party.branch ? `${party.label} · ${party.branch}` : party.label;
      view.label.text = text;
      if (view.plate) {
        // Nameplate sits above the heads; the status icon colour rides on the label tint.
        const padX = 6 * s;
        const padY = 3 * s;
        const iconW = view.icon ? 9 * s + 3 * s : 0;
        const w = view.label.width + padX * 2 + iconW;
        const h = view.label.height + padY * 2;
        view.plate.width = w / s;
        view.plate.height = h / s;
        const top = groundY - figH * s - 6 - h;
        view.plate.position.set(center - w / 2, top);
        view.label.style.fill = 0xffffff;
        view.label.anchor.set(0, 0.5);
        view.label.position.set(center - w / 2 + padX + iconW, top + h / 2);
        if (view.icon) {
          view.icon.texture = this.art!.ui.textures[art!.ui.statusIcons[party.status]] ?? Texture.EMPTY;
          view.icon.position.set(center - w / 2 + padX, top + h / 2 - (9 * s) / 2);
        }
      } else {
        view.label.style.fill = hexNum(this.theme.palette[party.status]);
        view.label.position.set(center, groundY - figH * s - 4);
      }
    }
  }

  /** Sprite-sheet member: pick the animation, tint the cloak and the status light from their masks. */
  private drawArtMember(mv: MemberView, m: Member, party: Party, isBeacon: boolean, cx: number, groundY: number, moving: boolean, now: number) {
    const loaded = this.art!;
    const s = this.scale;
    const { art } = loaded;
    const text = this.feed.say(party.id, m.paneId, now);
    const dir = this.parties.get(party.id)!.walker.dir;
    const y = groundY + bob(m.status, this.t, mv.phase);
    mv.figure!.update({ member: m, partyStatus: party.status, isBeacon, moving: moving && m.status !== 'blocked', talking: !!text, t: this.t, phase: mv.phase }, dir, s, cx, y);

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
      const maxX = this.app.screen.width - w - 4;
      const above = art.character.h * s + (ui.tail ? 6 * s : 0) + (this.parties.get(party.id)!.plate ? 14 * s : 6);
      mv.bubble.position.set(Math.max(4, Math.min(maxX, cx - w / 2)), y - above - h);
    }
  }

  private drawMember(mv: MemberView, m: Member, party: Party, isBeacon: boolean, cx: number, groundY: number, moving: boolean, now: number) {
    const s = this.scale;
    const memberMoving = moving && m.status !== 'blocked';
    const frameName = FRAME_NAMES[walkFrame(memberMoving, this.t, mv.phase)]!;
    const { texture, grid } = this.frame(m.role, frameName, isBeacon);
    const dir = this.parties.get(party.id)!.walker.dir;
    const y = groundY + bob(m.status, this.t, mv.phase);
    mv.sprite.texture = texture;
    mv.sprite.scale.set(dir * s, s);
    mv.sprite.position.set(cx, y);
    mv.sprite.alpha = m.status === 'idle' || m.status === 'unknown' ? 0.85 : 1;

    mv.glow.clear();
    if (isBeacon) {
      const color = hexNum(this.theme.palette[party.status]);
      const alpha = beaconAlpha(party.status, this.t);
      for (const p of beaconPixels(grid)) {
        const gx = cx + dir * (p.x - SPRITE_W / 2 + 0.5) * s;
        const gy = y - (SPRITE_H - p.y - 0.5) * s;
        mv.glow.circle(gx, gy, 3.5 * s).fill({ color, alpha: alpha * 0.25 });
        mv.glow.rect(gx - s / 2, gy - s / 2, s, s).fill({ color, alpha });
      }
    }

    const text = this.feed.say(party.id, m.paneId, now);
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
      const maxX = this.app.screen.width - bw - 4;
      mv.bubble.position.set(Math.max(4, Math.min(maxX, cx - bw / 2)), y - SPRITE_H * s - 46);
    }
  }
}
