// World model and deltas (docs/PLAN.md §2, generic vocabulary).
export type Status = 'working' | 'done' | 'blocked' | 'idle' | 'unknown';

export interface World {
  machine: string;
  parties: Record<string, Party>;
}

/** One Herdr workspace. */
export interface Party {
  id: string;
  label: string;
  session?: string;
  repo?: string;
  branch?: string;
  isWorktree: boolean;
  status: Status;
  members: Record<string, Member>;
  tokens: Record<string, string>;
}

/** One pane with an agent. */
export interface Member {
  paneId: string;
  agent: string;
  role?: string;
  status: Status;
  title?: string;
  say?: string;
  lastChange: number;
}

export type Delta =
  | { t: number; kind: 'snapshot'; world: World }
  | { t: number; kind: 'member'; partyId: string; member: Member }
  | { t: number; kind: 'party'; party: Party }
  | { t: number; kind: 'removed'; partyId: string; paneId?: string }
  | { t: number; kind: 'say'; partyId: string; paneId: string; text: string };
