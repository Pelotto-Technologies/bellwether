export interface ReadyOpts {
  tries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll `probe` until it reports true. Loading the renderer before the adapter is
 * listening leaves a transparent window with a blank (white) page, so the shell
 * waits for the server first. Resolves false if it never comes up.
 */
export async function waitForReady(probe: () => Promise<boolean>, opts: ReadyOpts = {}): Promise<boolean> {
  const tries = opts.tries ?? 40;
  const delayMs = opts.delayMs ?? 250;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < tries; i++) {
    if (await probe()) return true;
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}

/** Inline error page shown instead of a blank window when the overlay cannot load. */
export function errorPage(url: string): string {
  const safe = url.replace(/[<>&"]/g, '');
  const html = `<body style="margin:0;background:#1b1b24;color:#f0a82e;font:14px monospace;padding:12px">Bellwether: cannot reach ${safe}. Retrying... (tray: Quit, then relaunch)</body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
