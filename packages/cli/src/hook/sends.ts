// Agent-to-agent messages, recognised in the shell commands an agent runs.
//
// Herdr has no "message" concept and emits no event when one agent prompts another
// (`herdr agent prompt`, `herdr pane run`, `herdr pane send-text`). The installed
// pre-tool hook hands each shell command to `parseSends`; when it is a herdr send,
// the hook tags the sender's pane with `say` and `say_to` tokens, which the adapter
// already turns into a speech bubble. Pure functions only.

export type SendCommand = 'agent prompt' | 'pane run' | 'pane send-text' | 'pane send-input';

export interface SentMessage {
  /** Target as written: a pane id (`w1:p2`), an agent name, or a terminal id. */
  target: string;
  text: string;
  command: SendCommand;
}

/**
 * A herdr executable: `herdr`, `herdr.exe`, a quoted path ending in herdr, or
 * `${HERDR_BIN_PATH:-herdr}` / `$env:HERDR_BIN_PATH`. The subcommand is matched on
 * tokens afterwards, never with a nested regex quantifier (no backtracking blow-up).
 */
const EXE = /(?:herdr(?:\.exe)?|HERDR_BIN_PATH)\S*/gi;

/** Global flags that take a value, as in `herdr --machine lab agent prompt ...`. */
const GLOBAL_VALUED = new Set(['--machine', '--session', '--socket']);

/** Flags that take a value, so the value is not mistaken for the target or text. */
const VALUED = new Set(['--timeout', '--until', '--keys', '--source', '--lines', '--format', '--session', '--pane']);

/** Box-drawing borders and gutters agent TUIs draw around tool calls. */
const LEAD = new Set([...' \t│┃║|╎┆>❯⎿└├─●⏺•·*$#']);
const TRAIL = new Set([...' \t│┃║|╎┆']);

/** Strip TUI borders from both ends. A plain scan, so it stays linear on any input. */
function clean(line: string): string {
  const chars = [...line];
  let a = 0;
  let b = chars.length;
  while (a < b && LEAD.has(chars[a]!)) a++;
  while (b > a && TRAIL.has(chars[b - 1]!)) b--;
  return chars.slice(a, b).join('');
}

interface Tok {
  value: string;
  quoted: boolean;
}

/** Shell-ish split. Returns the tokens and whether a quote was still open at the end. */
function tokenize(s: string): { tokens: Tok[]; open: boolean } {
  const tokens: Tok[] = [];
  let cur = '';
  let has = false;
  let quoted = false;
  let q: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === q) q = undefined;
      else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      has = quoted = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has) tokens.push({ value: cur, quoted });
      cur = '';
      has = quoted = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (has) tokens.push({ value: cur, quoted });
  return { tokens, open: q !== undefined };
}

function parseArgs(command: SendCommand, tokens: Tok[]): SentMessage | undefined {
  const plain: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.quoted && t.value.startsWith('--')) {
      const [flag] = t.value.split('=');
      if (VALUED.has(flag!) && !t.value.includes('=')) i++;
      continue;
    }
    // Shell plumbing after the command ends it: `; herdr agent wait ...`, `&& ...`, `| jq`, `2>&1`, `)`.
    if (!t.quoted && /^(?:;|&&|\|\||\||\)|[0-9]?>.*)$/.test(t.value)) break;
    plain.push(t);
  }
  const target = plain[0];
  if (!target || target.quoted || /^\$|^%/.test(target.value)) return undefined;
  const text = plain
    .slice(1)
    .map((t) => t.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return { target: target.value.replace(/[),;]+$/, ''), text, command };
}

/** The send subcommand at the start of `tokens` (after global flags), and where its arguments begin. */
function subcommand(tokens: Tok[]): { command: SendCommand; at: number } | undefined {
  let i = 0;
  while (i < tokens.length && !tokens[i]!.quoted && tokens[i]!.value.startsWith('-')) {
    const flag = tokens[i]!.value;
    i += GLOBAL_VALUED.has(flag) ? 2 : 1;
  }
  const a = tokens[i]?.value.toLowerCase();
  const b = tokens[i + 1]?.value.toLowerCase();
  if (a === 'agent' && b === 'prompt') return { command: 'agent prompt', at: i + 2 };
  if (a === 'pane' && (b === 'run' || b === 'send-text' || b === 'send-input')) return { command: `pane ${b}` as SendCommand, at: i + 2 };
  return undefined;
}

/**
 * Every herdr send command in `text` (a shell command, or screen rows), oldest first.
 * A quoted message that wraps onto following lines is joined back up (at most a few).
 */
export function parseSends(text: string): SentMessage[] {
  const lines = text.split(/\r?\n/);
  const out: SentMessage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]!);
    for (const m of line.matchAll(EXE)) {
      let rest = line.slice(m.index! + m[0].length);
      for (let j = 1; j <= 4 && tokenize(rest).open && i + j < lines.length; j++) rest += ' ' + clean(lines[i + j]!);
      const { tokens } = tokenize(rest);
      const sub = subcommand(tokens);
      if (!sub) continue;
      const msg = parseArgs(sub.command, tokens.slice(sub.at));
      if (msg) out.push(msg);
    }
  }
  return out;
}

export interface PaneRef {
  paneId: string;
  name?: string | undefined;
  terminalId?: string | undefined;
}

/** Which pane a written target names, among the session's panes. */
export function resolveSendTarget(target: string, panes: PaneRef[]): string | undefined {
  const t = target.trim();
  const lower = t.toLowerCase();
  return (
    panes.find((p) => p.paneId === t)?.paneId ??
    panes.find((p) => p.name && p.name.toLowerCase() === lower)?.paneId ??
    panes.find((p) => p.terminalId && p.terminalId === t)?.paneId
  );
}

/** One bubble's worth of a message: first line, whitespace collapsed, capped. */
export function bubbleText(text: string, max = 56): string {
  const one = text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

/** The most recent message on `screen` addressed to `paneId`. */
export function findMessageTo(screen: string, paneId: string, panes: PaneRef[]): SentMessage | undefined {
  const sends = parseSends(screen);
  for (let i = sends.length - 1; i >= 0; i--) {
    const s = sends[i]!;
    if (resolveSendTarget(s.target, panes) === paneId) return s;
  }
  return undefined;
}
