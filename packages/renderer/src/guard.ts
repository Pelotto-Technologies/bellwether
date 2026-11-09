/**
 * Pixi's ticker stops rescheduling itself when a listener throws, so one bad frame (a live delta
 * that leaves the scene in a state `update` cannot handle) froze the whole page until a reload.
 * Wrap the per-frame callback so an error is logged (once per distinct message) and the next
 * frame still runs.
 */
export function guardFrame<A extends unknown[]>(fn: (...args: A) => void, log: (msg: string, err: unknown) => void = console.error): (...args: A) => void {
  const seen = new Set<string>();
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      const key = err instanceof Error ? err.message : String(err);
      if (seen.has(key)) return;
      seen.add(key);
      log('bellwether: frame update failed, continuing', err);
    }
  };
}
