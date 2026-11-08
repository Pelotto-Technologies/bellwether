import { ROLES } from './roles.js';

/** Marker that identifies files and entries Bellwether wrote, so uninstall removes only its own. */
export const MARKER = 'bellwether';
export const HOOK_BASENAME = 'bellwether-role';

/** Theme-neutral skill pack. Identical for every agent target. */
export function skillMarkdown(): string {
  return `---
name: bellwether
description: Tag your Herdr pane with a Bellwether role so the overlay can show you. Use when running inside Herdr (HERDR_ENV=1) as a coordinator spawning members or as a member starting work.
---

# Bellwether role tagging

Bellwether draws each Herdr pane that runs an agent as a character. It needs to know
which role the pane plays. Roles: ${ROLES.map((r) => `\`${r}\``).join(', ')}.

Only do any of this when \`HERDR_ENV=1\`. Outside Herdr, do nothing.

## If you are a member

On start, tag your own pane once:

\`\`\`sh
"\${HERDR_BIN_PATH:-herdr}" pane report-metadata "$HERDR_PANE_ID" --source bellwether --token role=<role>
\`\`\`

## If you orchestrate a project

Tag your own pane \`orchestrator\`. Nothing else is needed: Bellwether groups every
worktree and agent in the same repo under you and gives each worktree its own colour
automatically. Run from the project's own workspace, and create worktrees with Herdr's
worktree commands so they share your repo.

## If you coordinate other agents

When you start a member in a pane, tag that pane with its role, or split the pane with
\`HERDR_ROLE=<role>\` in its environment and the installed hook tags it for you.

Messages you send another agent with \`herdr agent prompt\`, \`herdr pane run\` or
\`herdr pane send-text\` show up as speech bubbles on their own: the installed hook
tags your pane before the command runs. Keep the first line of a message short and
free of secrets; it is what the bubble shows.

For anything else, you may set a short speech line yourself (under 60 characters,
never secrets, paths or customer data):

\`\`\`sh
"\${HERDR_BIN_PATH:-herdr}" pane report-metadata <pane> --source bellwether --token say="<one short line>" --ttl-ms 15000
\`\`\`
`;
}

/** POSIX hook: reports HERDR_ROLE as the pane's role token. Silent and non-fatal. */
export function hookSh(): string {
  return `#!/bin/sh
# ${MARKER}: report HERDR_ROLE as this pane's role token. Written by \`bellwether install\`.
[ "$HERDR_ENV" = "1" ] || exit 0
[ -n "$HERDR_PANE_ID" ] || exit 0
case "$HERDR_ROLE" in
  ${ROLES.join('|')}) ;;
  *) exit 0 ;;
esac
"\${HERDR_BIN_PATH:-herdr}" pane report-metadata "$HERDR_PANE_ID" --source ${MARKER} --token "role=$HERDR_ROLE" >/dev/null 2>&1
exit 0
`;
}

/** PowerShell variant for agents that run hooks natively on Windows. */
export function hookPs1(): string {
  const list = ROLES.map((r) => `'${r}'`).join(',');
  return `# ${MARKER}: report HERDR_ROLE as this pane's role token. Written by \`bellwether install\`.
if ($env:HERDR_ENV -ne '1' -or -not $env:HERDR_PANE_ID) { exit 0 }
if (@(${list}) -notcontains $env:HERDR_ROLE) { exit 0 }
$herdr = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
try { & $herdr pane report-metadata $env:HERDR_PANE_ID --source ${MARKER} --token "role=$($env:HERDR_ROLE)" *> $null } catch {}
exit 0
`;
}
