/** Detects a double tap/click: two taps on the same target within `windowMs`. Pure, so it is testable. */
export class DoubleTap {
  private last = new Map<string, number>();
  constructor(private windowMs = 350) {}

  /** Returns true when this tap completes a double tap for `key`. */
  tap(key: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev <= this.windowMs) {
      this.last.delete(key);
      return true;
    }
    this.last.set(key, now);
    return false;
  }
}
