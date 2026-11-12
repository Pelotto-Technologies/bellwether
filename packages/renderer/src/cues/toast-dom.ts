import type { Theme } from '../theme.js';
import type { FaceProvider } from './face.js';
import type { AlertPosition } from './options.js';
import { ToastQueue, type Toast, type ToastFrame } from './toasts.js';

const CSS = `
#toasts { position: fixed; z-index: 50; pointer-events: none; display: none; max-width: calc(100vw - 24px); }
#toasts.on { display: block; }
#toasts.top-left { left: 12px; top: 12px; }
#toasts.top-right { right: 12px; top: 12px; }
#toasts.top-center { left: 50%; top: 12px; margin-left: calc(min(420px, 100vw - 24px) / -2); }
body.map #toasts { top: 34px; }
body.map #toasts.top-right.detail-open { right: 304px; }
body:not(.transparent) #toasts.top-left { top: 40px; }
#toasts .toast {
  --frame: #ffd23f; --bg: #1b1b24;
  box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(420px, calc(100vw - 24px));
  min-height: 46px; padding: 7px 14px 7px 9px; margin: 3px;
  font: 700 13px/1.3 ui-monospace, "Cascadia Mono", Menlo, monospace; color: #f3efe6; background: var(--bg);
  /* Square pixel frame with notched corners: four offset shadows leave the corners empty. */
  box-shadow: 0 -3px 0 0 var(--frame), 0 3px 0 0 var(--frame), -3px 0 0 0 var(--frame), 3px 0 0 0 var(--frame), 0 7px 0 0 rgba(0,0,0,.35);
  opacity: 0; will-change: transform, opacity;
}
#toasts .toast .face { width: 36px; height: 30px; flex: none; image-rendering: pixelated; object-fit: contain; }
#toasts .toast .face[hidden] { display: none; }
#toasts .toast .pip { width: 8px; height: 8px; flex: none; background: var(--frame); }
#toasts .toast .text { overflow: hidden; text-overflow: ellipsis; }
`;

const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The alert banner on the page, driven by a `ToastQueue`. Text is set with textContent only. */
export class ToastView {
  readonly queue = new ToastQueue();
  private host: HTMLElement;
  private el: HTMLElement;
  private face: HTMLImageElement;
  private text: HTMLElement;
  private shownToast: Toast | undefined;
  private position: AlertPosition = 'off';

  constructor(
    private theme: Theme,
    private faces: FaceProvider,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.host = document.createElement('div');
    this.host.id = 'toasts';
    this.host.setAttribute('role', 'status');
    this.host.setAttribute('aria-live', 'polite');
    this.el = document.createElement('div');
    this.el.className = 'toast';
    this.face = document.createElement('img');
    this.face.className = 'face';
    this.face.alt = '';
    const pip = document.createElement('span');
    pip.className = 'pip';
    this.text = document.createElement('span');
    this.text.className = 'text';
    this.el.append(this.face, pip, this.text);
    this.host.appendChild(this.el);
    document.body.appendChild(this.host);
  }

  setPosition(p: AlertPosition): void {
    this.position = p;
    this.host.className = p === 'off' ? '' : `on ${p}`;
    if (p === 'off') this.queue.clear();
  }

  push(t: Toast): void {
    if (this.position !== 'off') this.queue.push(t);
  }

  private show(t: Toast): void {
    this.shownToast = t;
    this.el.style.setProperty('--frame', this.theme.palette[t.status]);
    this.el.style.setProperty('--bg', this.theme.outline);
    this.text.textContent = t.text;
    const url = t.role ? this.faces(t.role) : undefined;
    if (url) this.face.src = url;
    this.face.hidden = !url;
  }

  /** Call every frame with a monotonic clock in ms. */
  frame(now: number): void {
    const panel = document.getElementById('detail');
    this.host.classList.toggle('detail-open', !!panel && !panel.hidden);
    const f: ToastFrame | null = this.position === 'off' ? null : this.queue.frame(now);
    if (!f) {
      this.el.style.opacity = '0';
      return;
    }
    if (this.shownToast !== f.toast) this.show(f.toast);
    const eased = 1 - (1 - f.shown) ** 3;
    this.el.style.opacity = prefersReducedMotion() ? String(f.shown) : String(Math.min(1, f.shown * 2));
    if (prefersReducedMotion()) {
      this.el.style.transform = 'none';
      return;
    }
    const off = (1 - eased) * 100;
    this.el.style.transform = this.position === 'top-left' ? `translateX(${-off - 8}%)` : this.position === 'top-right' ? `translateX(${off + 8}%)` : `translateY(${-off - 20}px)`;
  }
}
