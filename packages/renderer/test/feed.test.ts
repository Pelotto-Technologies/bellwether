import { MockGenerator } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { FeedState } from '../src/feed.js';

describe('FeedState', () => {
  function setup() {
    const gen = new MockGenerator({ seed: 5 });
    const feed = new FeedState(10_000);
    feed.apply(gen.initial(0), 0);
    const [a, b] = Object.values(feed.world.parties).flatMap((p) => Object.values(p.members).map((m) => ({ partyId: p.id, member: m })));
    return { feed, a: a!, b: b! };
  }

  it('names the listener of a message and remembers who it is for', () => {
    const { feed, a, b } = setup();
    feed.apply({ t: 1, kind: 'say', partyId: a.partyId, paneId: a.member.paneId, text: 'fix it', to: { partyId: b.partyId, paneId: b.member.paneId } }, 0);
    expect(feed.say(a.partyId, a.member.paneId, 5)).toBe(`@${b.member.role} fix it`);
    expect(feed.sayTo(a.partyId, a.member.paneId, 5)).toEqual({ partyId: b.partyId, paneId: b.member.paneId });
  });

  it('hides bubbles when turned off but keeps the conversation going', () => {
    const { feed, a } = setup();
    feed.bubblesOn = false;
    feed.apply({ t: 1, kind: 'say', partyId: a.partyId, paneId: a.member.paneId, text: 'hi' }, 0);
    expect(feed.say(a.partyId, a.member.paneId, 5)).toBeUndefined();
    expect(feed.talking(a.partyId, a.member.paneId, 5)).toBe(true);
  });

  it('keeps an inferred line when the member changes status', () => {
    const { feed, a } = setup();
    feed.apply({ t: 1, kind: 'say', partyId: a.partyId, paneId: a.member.paneId, text: 'Over to you' }, 0, true);
    feed.apply({ t: 2, kind: 'member', partyId: a.partyId, member: { ...a.member, status: 'done', say: undefined } }, 10);
    expect(feed.say(a.partyId, a.member.paneId, 20)).toBe('Over to you');
  });

  it('shows speech until its TTL expires, then hides it', () => {
    const gen = new MockGenerator({ seed: 5 });
    const feed = new FeedState(1000);
    feed.apply(gen.initial(0), 0);
    const party = Object.values(feed.world.parties)[0]!;
    const member = Object.values(party.members)[0]!;
    feed.apply({ t: 1, kind: 'say', partyId: party.id, paneId: member.paneId, text: 'hello' }, 100);
    expect(feed.say(party.id, member.paneId, 500)).toBe('hello');
    expect(feed.say(party.id, member.paneId, 1200)).toBeUndefined();
  });

  it('clears speech when the member changes status', () => {
    const gen = new MockGenerator({ seed: 5 });
    const feed = new FeedState(10_000);
    feed.apply(gen.initial(0), 0);
    const party = Object.values(feed.world.parties)[0]!;
    const member = Object.values(party.members)[0]!;
    feed.apply({ t: 1, kind: 'say', partyId: party.id, paneId: member.paneId, text: 'hi' }, 0);
    feed.apply({ t: 2, kind: 'member', partyId: party.id, member: { ...member, status: 'done', say: undefined } }, 10);
    expect(feed.say(party.id, member.paneId, 20)).toBeUndefined();
  });
});

import { vi } from 'vitest';
import { parseDeltas, playDeltas } from '../src/feed.js';

describe('replay', () => {
  const lines = [
    { t: 0, kind: 'snapshot', world: { machine: 'm', parties: {} } },
    { t: 100, kind: 'removed', partyId: 'a' },
  ];
  it('parses jsonl and skips torn lines', () => {
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"t":';
    expect(parseDeltas(text)).toHaveLength(2);
  });
  it('plays with timing scaled by speed and loops', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const stop = playDeltas(lines as never, (d) => seen.push(d.t), { speed: 2 });
    expect(seen).toEqual([0]);
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([0, 100]);
    vi.advanceTimersByTime(600);
    expect(seen.length).toBeGreaterThan(2);
    stop();
    const n = seen.length;
    vi.advanceTimersByTime(5000);
    expect(seen.length).toBe(n);
    vi.useRealTimers();
  });
});
