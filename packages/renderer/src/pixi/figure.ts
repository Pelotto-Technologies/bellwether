import type { Member, Status } from '@bellwether/adapter/core';
import { Container, Sprite, Texture } from 'pixi.js';
import { chooseAnim, frameIndex, frameNames } from '../anim.js';
import { beaconAlpha } from '../sim.js';
import type { Theme } from '../theme.js';
import type { LoadedArt } from './pack.js';

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

export interface FigurePose {
  member: Member;
  /** Rolled-up status colour source for the beacon's light. */
  partyStatus: Status;
  isBeacon: boolean;
  moving: boolean;
  talking: boolean;
  t: number;
  phase: number;
}

/**
 * A sprite-sheet character: the base frame, its cloak mask (tinted per role) and the
 * status light (tinted per party status), mirrored by `dir`. Shared by strip and map modes.
 */
export class Figure {
  readonly container = new Container();
  private base = new Sprite();
  private cloak = new Sprite();
  private tip = new Sprite();
  private tipGlow = new Sprite();

  constructor(
    private art: LoadedArt,
    private theme: Theme,
  ) {
    this.tipGlow.blendMode = 'add';
    const a = art.art.character.anchor;
    for (const sp of [this.base, this.cloak, this.tip, this.tipGlow]) sp.anchor.set(a.x, a.y);
    this.container.addChild(this.base, this.cloak, this.tip, this.tipGlow);
  }

  /** Picks the animation and frame, applies tints and the mirror, and places the figure. */
  update(p: FigurePose, dir: 1 | -1, scale: number, x: number, y: number): void {
    const { art } = this.art;
    const m = p.member;
    const sheet = this.art.sheets[m.role];
    const anim = chooseAnim({ moving: p.moving, status: m.status, talking: p.talking }, p.t, p.phase);
    const idx = frameIndex(art.character.counts[anim], art.character.fps[anim], p.t, p.phase);
    const names = frameNames(anim, idx);

    this.base.texture = sheet.textures[names.base] ?? Texture.EMPTY;
    this.cloak.texture = sheet.textures[names.cloak] ?? Texture.EMPTY;
    this.cloak.tint = hexNum(art.roles[m.role].cloak);
    this.tip.visible = this.tipGlow.visible = p.isBeacon;
    if (p.isBeacon) {
      const color = hexNum(this.theme.palette[p.partyStatus]);
      const alpha = beaconAlpha(p.partyStatus, p.t);
      this.tip.texture = this.tipGlow.texture = sheet.textures[names.tip] ?? Texture.EMPTY;
      this.tip.tint = this.tipGlow.tint = color;
      this.tip.alpha = alpha;
      this.tipGlow.alpha = alpha * 0.5;
    }
    this.container.scale.set(dir * scale, scale);
    this.container.position.set(x, y);
    this.container.alpha = m.status === 'idle' || m.status === 'unknown' ? 0.85 : 1;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
