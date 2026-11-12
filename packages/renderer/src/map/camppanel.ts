import type { Member, Party } from '@bellwether/adapter/core';
import type { VitalsLook } from '../theme.js';
import { barFill, isLow, modelLine } from '../vitals.js';
import { activityLabel, activityOf, isTired, type Activity } from './activity.js';
import { ago } from './detail.js';

/** The party breakdown window beside the camp scene: a pure HTML builder, so it can be tested. */

export interface CampRow {
  paneId: string;
  role: string;
  agent: string;
  status: Member['status'];
  activity: Activity;
  /** `Hammering · Edit`. */
  doing: string;
  tired: boolean;
  /** `Opus 5.5 · high`. */
  model?: string;
  context?: number;
  quota?: number;
  /** The latest line: speech, then pane title, then how long it has been in this state. */
  line: string;
}

export interface CampPanel {
  title: string;
  branch?: string;
  status: Party['status'];
  subtitle: string;
  quest?: string;
  /** Git state in words; empty when the party has no git state. */
  git: string[];
  rows: CampRow[];
}

/** `3 uncommitted`, `2 unpushed`, `no remote`: what the party's git state says. Nothing when unknown. */
function gitWords(g: Party['git']): string[] {
  if (!g) return [];
  const out = [g.dirty > 0 ? `${g.dirty} uncommitted` : 'clean'];
  if (g.ahead > 0) out.push(`${g.ahead} unpushed`);
  if (g.noRemote) out.push('no remote');
  return out;
}

export function campPanel(p: Party, settlement: string, beaconRole: string, now: number, vitals = true): CampPanel {
  const members = Object.values(p.members).sort((a, b) => (a.role === beaconRole ? -1 : 0) - (b.role === beaconRole ? -1 : 0) || a.paneId.localeCompare(b.paneId));
  const quests = new Set(members.map((m) => m.quest).filter((q): q is string => !!q));
  return {
    title: p.label,
    ...(p.branch ? { branch: p.branch } : {}),
    status: p.status,
    subtitle: [settlement, p.isWorktree ? 'worktree' : undefined].filter(Boolean).join(' · '),
    ...(vitals && quests.size === 1 ? { quest: [...quests][0]! } : {}),
    git: gitWords(p.git),
    rows: members.map((m) => {
      const model = vitals ? modelLine(m) : undefined;
      return {
        paneId: m.paneId,
        role: m.role,
        agent: m.agent,
        status: m.status,
        activity: activityOf(m),
        doing: activityLabel(m),
        tired: vitals && isTired(m),
        ...(model ? { model } : {}),
        ...(vitals && m.vitals?.context !== undefined ? { context: m.vitals.context } : {}),
        ...(vitals && m.vitals?.quota !== undefined ? { quota: m.vitals.quota } : {}),
        line: m.say ?? m.title ?? `${m.status} for ${ago(now - m.lastChange)}`,
      };
    }),
  };
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const CELLS = 16;

/** A pixel bar: `CELLS` blocks, filled by `barFill`, in the vitals colours (the context bar turns red when low). */
function bar(label: string, pct: number | undefined, color: string, low: string): string {
  if (pct === undefined) return '';
  const fill = barFill(pct, CELLS);
  const c = label === 'HP' && isLow(pct) ? low : color;
  const cells = Array.from({ length: CELLS }, (_, i) => `<i${i < fill ? ` class="on" style="background:${c}"` : ''}></i>`).join('');
  return `<div class="vit"><span class="lbl">${label}</span><span class="cells">${cells}</span><span class="pct">${pct}%</span></div>`;
}

export function campPanelHtml(m: CampPanel, look: VitalsLook, faces: Record<string, string> = {}): string {
  const head = `<header><h2>${esc(m.title)}${m.branch ? ` <span class="br">· ${esc(m.branch)}</span>` : ''}</h2><span class="pill st ${m.status}">${m.status}</span>${
    m.subtitle ? `<div class="sub">${esc(m.subtitle)}</div>` : ''
  }${m.quest ? `<div class="quest">Quest: ${esc(m.quest)}</div>` : ''}${m.git.length ? `<div class="gitline">${m.git.map(esc).join(' · ')}</div>` : ''}</header>`;
  const rows = m.rows
    .map((r) => {
      const face = faces[r.role];
      return `<li class="mem ${r.status}${r.tired ? ' tired' : ''}" data-pane="${esc(r.paneId)}"><span class="face">${face ? `<img src="${face}" alt="">` : ''}</span><div class="body"><div class="top"><b>${esc(r.role)}</b> <i>${esc(r.agent)}</i><button class="kill" data-close="${esc(
        r.paneId,
      )}" title="Close this pane in Herdr (ends the agent)">close</button></div>${r.model ? `<div class="model">${esc(r.model)}</div>` : ''}${bar('HP', r.context, look.context, look.low)}${bar('SP', r.quota, look.quota, look.low)}<div class="act"><span class="st ${r.status}">&#9632;</span> ${esc(r.doing)}${
        r.tired ? ' <em>tired</em>' : ''
      }</div><div class="line">${esc(r.line)}</div></div></li>`;
    })
    .join('');
  return `${head}<ul class="party">${rows}</ul>`;
}
