import type { Role } from '@bellwether/adapter/core';
import type { Theme } from '../theme.js';
import type { FaceProvider } from './face.js';
import { RecapController, type RecapModel } from './recap.js';

const CSS = `
#recap { position: fixed; z-index: 60; left: 50%; top: 14%; transform: translateX(-50%); display: none; cursor: pointer;
  --frame: #ffd23f; --bg: #1b1b24; --ink: #f3efe6; --dim: #a9a49a; --accent: #ffd23f;
  box-sizing: border-box; width: min(380px, calc(100vw - 32px)); padding: 14px 18px 10px; color: var(--ink); background: var(--bg);
  font: 700 13px/1.35 ui-monospace, "Cascadia Mono", Menlo, monospace; text-align: left; user-select: none;
  /* Pixel frame: notched square corners from four offset shadows, plus an inner rule. */
  box-shadow: 0 -4px 0 0 var(--frame), 0 4px 0 0 var(--frame), -4px 0 0 0 var(--frame), 4px 0 0 0 var(--frame), 0 10px 0 0 rgba(0,0,0,.4), inset 0 0 0 2px var(--bg), inset 0 0 0 3px rgba(255,255,255,.14); }
#recap.on { display: block; animation: recap-in .24s steps(5, end) both; }
body.camp-view #recap { left: calc((100vw - 372px) / 2); }
@keyframes recap-in { from { opacity: 0; transform: translateX(-50%) translateY(-14px) scale(.94); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { #recap.on { animation: none; } }
#recap .title { font-size: 17px; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); text-align: center; }
#recap .party { margin-top: 2px; text-align: center; color: var(--dim); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#recap .faces { display: flex; justify-content: center; gap: 6px; margin: 8px 0 4px; min-height: 2px; }
#recap .faces img { width: 36px; height: 30px; image-rendering: pixelated; object-fit: contain; }
#recap .rule { height: 2px; margin: 8px 0; background: repeating-linear-gradient(90deg, var(--frame) 0 6px, transparent 6px 10px); opacity: .55; }
#recap .row { display: flex; justify-content: space-between; gap: 14px; padding: 1px 0; }
#recap .row dt { color: var(--dim); font-weight: 400; }
#recap .row dd { margin: 0; text-align: right; }
#recap .row.accent dd { color: var(--accent); }
#recap dl { margin: 0; }
#recap .tools { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 2px; }
#recap .tools span { padding: 0 6px; background: rgba(255,255,255,.1); font-weight: 400; }
#recap .tools b { color: var(--accent); }
#recap .levels { margin-top: 8px; color: var(--accent); text-align: center; animation: recap-blink 1s steps(2, jump-none) infinite; }
@media (prefers-reduced-motion: reduce) { #recap .levels { animation: none; } }
@keyframes recap-blink { 50% { opacity: .55; } }
#recap .hint { margin-top: 8px; text-align: center; color: var(--dim); font-weight: 400; font-size: 11px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The quest-complete window on the page. Text goes in with textContent only; click or Esc dismisses it. */
export class RecapCard {
  readonly controller = new RecapController();
  private host: HTMLElement;
  private shown: RecapModel | undefined;
  /** Whether cards are allowed at all (`?recap=0`, the thin desktop strip). */
  enabled = true;

  constructor(
    private theme: Theme,
    private faces: FaceProvider,
  ) {
    const style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.host = el('div');
    this.host.id = 'recap';
    this.host.setAttribute('role', 'dialog');
    this.host.setAttribute('aria-label', 'Quest complete');
    this.host.addEventListener('click', () => this.dismiss());
    document.body.appendChild(this.host);
    // Capture, so Esc closes the card before it also backs out of the camp or the map.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.shown) {
          this.dismiss();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }

  show(model: RecapModel, now: number): void {
    if (this.enabled) this.controller.show(model, now);
  }

  dismiss(): void {
    this.controller.dismiss();
    this.render(undefined);
  }

  /** Call every frame with a monotonic clock in ms. */
  frame(now: number): void {
    this.render(this.enabled ? this.controller.visible(now) : undefined);
  }

  private render(model: RecapModel | undefined): void {
    if (model === this.shown) return;
    this.shown = model;
    this.host.classList.toggle('on', !!model);
    this.host.replaceChildren();
    if (!model) return;
    this.host.style.setProperty('--frame', this.theme.palette.done);
    this.host.style.setProperty('--accent', this.theme.palette.done);
    this.host.style.setProperty('--bg', this.theme.outline);
    this.host.append(el('div', 'title', model.title));
    if (model.party) this.host.append(el('div', 'party', model.party));
    const faces = el('div', 'faces');
    for (const role of model.roles) {
      const url = this.faces(role as Role);
      if (!url) continue;
      const img = el('img');
      img.alt = '';
      img.src = url;
      faces.append(img);
    }
    this.host.append(faces, el('div', 'rule'));
    const dl = el('dl');
    for (const r of model.rows) {
      const row = el('div', r.accent ? 'row accent' : 'row');
      row.append(el('dt', undefined, r.label), el('dd', undefined, r.value));
      dl.append(row);
    }
    this.host.append(dl);
    if (model.tools.length) {
      const tools = el('div', 'tools');
      for (const t of model.tools) {
        const chip = el('span', undefined, `${t.label} `);
        chip.append(el('b', undefined, String(t.count)));
        tools.append(chip);
      }
      this.host.append(el('div', 'rule'), tools);
    }
    if (model.levelUps.length) this.host.append(el('div', 'levels', model.levelUps.map((l) => `▲ ${l}`).join('   ')));
    this.host.append(el('div', 'hint', 'click or Esc to close'));
  }
}
