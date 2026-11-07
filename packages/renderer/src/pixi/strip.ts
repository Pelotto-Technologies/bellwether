import type { Member, Party, Role } from '@bellwether/adapter/core';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { FeedState } from '../feed.js';
import { beaconAlpha, bob, hash01, layoutLanes, memberX, stepWalker, walkFrame, SPEED, type Walker } from '../sim.js';
import { beaconPixels, buildFrame, FRAME_NAMES, paletteFor, rasterize, SPRITE_H, SPRITE_W, type FrameName } from '../sprites.js';
import type { Theme } from '../theme.js';

interface MemberView {
  sprite: Sprite;
  glow: Graphics;
  bubble: Container;
  bubbleText: Text;
  bubbleBg: Graphics;
  phase: number;
}

interface PartyView {
  root: Container;
  label: Text;
  members: Map<string, MemberView>;
  walker: Walker;
}

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
  ) {
    app.stage.addChild(this.ground, this.layer);
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
    const glow = new Graphics();
    const bubbleBg = new Graphics();
    const bubbleText = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0x1b1b24 } });
    const bubble = new Container();
    bubble.addChild(bubbleBg, bubbleText);
    party.root.addChild(sprite, glow, bubble);
    const view = { sprite, glow, bubble, bubbleText, bubbleBg, phase: hash01(paneId) * 10 };
    party.members.set(paneId, view);
    return view;
  }

  private makeParty(party: Party, lane: { start: number; end: number }): PartyView {
    const root = new Container();
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    label.anchor.set(0.5, 1);
    root.addChild(label);
    this.layer.addChild(root);
    const start = lane.start + hash01(party.id) * Math.max(0, lane.end - lane.start - 60);
    const view: PartyView = { root, label, members: new Map(), walker: { x: start, dir: hash01(party.id + '!') > 0.5 ? 1 : -1 } };
    this.parties.set(party.id, view);
    return view;
  }

  update(dt: number, now: number): void {
    this.t += dt;
    const { width, height } = this.app.screen;
    const s = this.scale;
    const groundH = 3 * s;
    const groundY = height - groundH;
    this.ground.clear().rect(0, groundY, width, groundH).fill(hexNum(this.theme.ground));

    const world = this.feed.world;
    const lanes = layoutLanes(Object.keys(world.parties), width);

    for (const [id, view] of this.parties) {
      if (!world.parties[id]) {
        view.root.destroy({ children: true });
        this.parties.delete(id);
      }
    }

    const spacing = (SPRITE_W + 3) * s;
    for (const party of Object.values(world.parties)) {
      const lane = lanes.get(party.id)!;
      const view = this.parties.get(party.id) ?? this.makeParty(party, lane);
      const members = Object.values(party.members).sort((a, b) => a.paneId.localeCompare(b.paneId));
      const span = Math.max(0, members.length - 1) * spacing + SPRITE_W * s;
      view.walker = stepWalker(view.walker, party.status, lane, span, dt);
      const moving = SPEED[party.status] > 0;
      const beaconPane = (members.find((m) => m.role === this.theme.beacon) ?? members[0])?.paneId;

      for (const [paneId, mv] of view.members) {
        if (!party.members[paneId]) {
          mv.sprite.destroy();
          mv.glow.destroy();
          mv.bubble.destroy({ children: true });
          view.members.delete(paneId);
        }
      }

      members.forEach((m, i) => {
        const mv = view.members.get(m.paneId) ?? this.makeMember(view, m.paneId);
        const cx = memberX(view.walker.x, i, spacing) + (SPRITE_W * s) / 2;
        this.drawMember(mv, m, party, m.paneId === beaconPane, cx, groundY, moving, now);
      });

      const center = view.walker.x + span / 2;
      view.label.text = party.branch ? `${party.label} · ${party.branch}` : party.label;
      view.label.style.fill = hexNum(this.theme.palette[party.status]);
      view.label.position.set(center, groundY - SPRITE_H * s - 4);
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
