import { Container, Graphics, Text } from 'pixi.js';
import { LEVELUP_SECONDS, levelUpFrame } from '../anim-levelup.js';

interface Active {
  born: number;
  text: Text;
}

/**
 * Draws the level-up flourish (a ▲, sparkles and "LEVEL UP") over members. A scene calls `trigger` when a
 * `level_up` moment arrives, then `begin`, `drawFor` once per member and `end` every frame.
 */
export class LevelFx {
  readonly layer = new Container();
  private g = new Graphics();
  private active = new Map<string, Active>();
  private drawn = new Set<string>();

  constructor(
    private reduced: boolean,
    private color = 0xffd23f,
    private outline = 0x1b1b24,
  ) {
    this.layer.addChild(this.g);
    this.layer.eventMode = 'none';
  }

  trigger(partyId: string, paneId: string, t: number): void {
    const key = `${partyId}/${paneId}`;
    const old = this.active.get(key);
    if (old) old.born = t;
    else {
      const text = new Text({ text: 'LEVEL UP', style: { fontFamily: 'monospace', fontWeight: 'bold', fontSize: 7, fill: this.color, stroke: { color: this.outline, width: 2 } }, resolution: 4 });
      text.anchor.set(0.5, 1);
      text.visible = false;
      this.layer.addChild(text);
      this.active.set(key, { born: t, text });
    }
  }

  begin(): void {
    this.g.clear();
    this.drawn.clear();
  }

  /** `x` and `headY` are the member's head in scene pixels; `unit` is how many scene pixels one art pixel is. */
  drawFor(partyId: string, paneId: string, x: number, headY: number, unit: number, t: number): void {
    const key = `${partyId}/${paneId}`;
    const a = this.active.get(key);
    if (!a) return;
    const f = levelUpFrame(t - a.born, this.reduced);
    if (!f) return;
    this.drawn.add(key);
    // The arrow and sparkles are drawn a bit larger than a pixel of art so they read at a glance; the text keeps the art unit.
    const u = Math.max(0.5, unit) * 1.5;
    const tu = Math.max(0.5, unit);
    const g = this.g;
    const ay = headY - f.arrowRise * u;
    // The arrow: a solid ▲ built from rows, outlined in the dark ink.
    for (let row = 0; row < 4; row++) {
      const w = (row + 1) * 2 - 1;
      g.rect(Math.round(x - (w * u) / 2) - u * 0.5, Math.round(ay - (4 - row) * u), w * u + u, u).fill({ color: this.outline, alpha: f.alpha });
    }
    for (let row = 0; row < 4; row++) {
      const w = (row + 1) * 2 - 1;
      g.rect(Math.round(x - (w * u) / 2), Math.round(ay - (4 - row) * u), w * u, u).fill({ color: this.color, alpha: f.alpha });
    }
    g.rect(Math.round(x - u / 2), Math.round(ay), u, 2 * u).fill({ color: this.color, alpha: f.alpha });
    for (const s of f.sparkles) g.rect(Math.round(x + s.dx * u), Math.round(headY + s.dy * u), s.size * u, s.size * u).fill({ color: 0xffffff, alpha: s.alpha });
    a.text.visible = true;
    a.text.alpha = f.textAlpha;
    a.text.scale.set(Math.max(0.6, tu));
    a.text.position.set(Math.round(x), Math.round(ay - 5 * u));
  }

  /** Drops finished flourishes and hides the text of members not drawn this frame. */
  end(t: number): void {
    for (const [key, a] of this.active) {
      if (t - a.born >= LEVELUP_SECONDS) {
        a.text.destroy();
        this.active.delete(key);
      } else if (!this.drawn.has(key)) a.text.visible = false;
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.active.clear();
  }
}
