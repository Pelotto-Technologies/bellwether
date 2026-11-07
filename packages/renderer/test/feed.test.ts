import { MockGenerator } from '@bellwether/adapter/core';
import { describe, expect, it } from 'vitest';
import { FeedState } from '../src/feed.js';

describe('FeedState', () => {
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
