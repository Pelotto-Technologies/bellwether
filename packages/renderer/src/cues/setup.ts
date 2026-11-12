import type { Delta, World } from '@bellwether/adapter/core';
import type { Renderer } from 'pixi.js';
import type { LoadedArt } from '../pixi/pack.js';
import type { Theme } from '../theme.js';
import { EventCore } from './events.js';
import { makeFaceProvider } from './face.js';
import { type AlertPosition, type CueOptions, toggleAlerts } from './options.js';
import { SoundPlayer } from './player.js';
import { toastFor } from './toasts.js';
import { ToastView } from './toast-dom.js';

export interface Cues {
  /** Feed every delta with the world as it was before the delta was applied. */
  observe(prev: World, delta: Delta, now: number): void;
  /** Advance the banner; the page calls it every frame. */
  frame(now: number): void;
  readonly sounds: SoundPlayer;
  readonly alerts: ToastView;
}

/**
 * Wires the pure event core to the sound player and the alert banner, and installs the `s` and `a` keys.
 * Everything here is optional: no AudioContext and no alerts simply means no output.
 */
export function createCues(opts: CueOptions, theme: Theme, art: LoadedArt | null, renderer: Renderer | undefined): Cues {
  const core = new EventCore();
  const sounds = new SoundPlayer(theme.sounds, { volume: opts.volume, enabled: opts.sounds });
  sounds.unlockOnGesture();
  const alerts = new ToastView(theme, makeFaceProvider(theme, art, renderer));
  let position: AlertPosition = opts.alerts;
  let lastPosition: AlertPosition | undefined = position === 'off' ? undefined : position;
  alerts.setPosition(position);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 's' || e.key === 'S') {
      sounds.setEnabled(!sounds.isEnabled);
      // A blip on unmute confirms the sound works (and unlocks the context under the key press).
      if (sounds.isEnabled) sounds.play('message');
    } else if (e.key === 'a' || e.key === 'A') {
      if (position !== 'off') lastPosition = position;
      position = toggleAlerts(position, lastPosition);
      alerts.setPosition(position);
    }
  });

  return {
    sounds,
    alerts,
    observe(prev, delta, now) {
      const events = core.process(prev, delta, now);
      if (!events.length) return;
      sounds.handle(events, now);
      for (const e of events) {
        const t = toastFor(e);
        if (t) alerts.push(t);
      }
    },
    frame: (now) => alerts.frame(now),
  };
}
