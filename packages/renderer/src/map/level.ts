import type { Member } from '@bellwether/adapter/core';

/** The level badge and XP bar of a member, for the panels. Pure: HTML is built from this, and it is tested. */
export interface LevelBadge {
  /** `Lv 3`. */
  label: string;
  /** Bar fill, 0 to 100 (always full at the level cap). */
  pct: number;
  /** `12 / 60 XP`. */
  title: string;
}

export function levelBadge(m: Pick<Member, 'level' | 'xp'>): LevelBadge | undefined {
  if (m.level === undefined) return undefined;
  const xp = m.xp;
  if (!xp || xp.next <= 0) return { label: `Lv ${m.level}`, pct: 100, title: xp ? 'max level' : '' };
  const pct = Math.max(0, Math.min(100, Math.round((xp.have / xp.next) * 100)));
  return { label: `Lv ${m.level}`, pct, title: `${xp.have} / ${xp.next} XP` };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** `Lv 3` as a small badge span. Empty when the member has no level. */
export function levelBadgeHtml(b: LevelBadge | undefined): string {
  return b ? `<span class="lv" title="${esc(b.title)}">${esc(b.label)}</span>` : '';
}

/** A thin XP bar. Empty when the member has no level. */
export function xpBarHtml(b: LevelBadge | undefined): string {
  return b ? `<div class="xpbar" title="${esc(b.title)}"><i style="width:${b.pct}%"></i></div>` : '';
}
