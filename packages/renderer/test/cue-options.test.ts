import { describe, expect, it } from 'vitest';
import { parseAlerts, parseSwitch, parseVolume, resolveOptions, servedCues, toggleAlerts } from '../src/cues/options.js';

const resolve = (query: string, served: Parameters<typeof resolveOptions>[0]['served'] = {}, mode: 'strip' | 'map' | 'alerts' = 'strip', spanFollower = false) =>
  resolveOptions({ params: new URLSearchParams(query), served, mode, spanFollower });

describe('parsers', () => {
  it('reads switches', () => {
    expect(parseSwitch('0')).toBe(false);
    expect(parseSwitch('false')).toBe(false);
    expect(parseSwitch('1')).toBe(true);
    expect(parseSwitch('')).toBe(true);
    expect(parseSwitch('maybe')).toBeUndefined();
    expect(parseSwitch(null)).toBeUndefined();
  });

  it('clamps volume and rejects garbage', () => {
    expect(parseVolume('0.5')).toBe(0.5);
    expect(parseVolume(3)).toBe(1);
    expect(parseVolume('-1')).toBe(0);
    expect(parseVolume('loud')).toBeUndefined();
    expect(parseVolume('')).toBeUndefined();
    expect(parseVolume(null)).toBeUndefined();
  });

  it('reads alert positions', () => {
    expect(parseAlerts('top-right')).toBe('top-right');
    expect(parseAlerts('bottom')).toBeUndefined();
  });

  it('keeps only well-typed served values', () => {
    expect(servedCues({ sounds: false, volume: 0.6, alerts: 'top-left' })).toEqual({ sounds: false, volume: 0.6, alerts: 'top-left' });
    expect(servedCues({ sounds: 'yes', volume: 'x', alerts: 'nope' })).toEqual({});
    expect(servedCues(null)).toEqual({});
  });
});

describe('resolveOptions', () => {
  it('defaults: sounds off in a plain page, modest volume, alerts off', () => {
    expect(resolve('')).toEqual({ sounds: false, volume: 0.3, alerts: 'off', recap: true, card: true });
  });

  it('URL beats bellwether.toml beats the default', () => {
    expect(resolve('', { sounds: true, volume: 0.8 })).toMatchObject({ sounds: true, volume: 0.8 });
    expect(resolve('sounds=0&volume=0.1', { sounds: true, volume: 0.8 })).toMatchObject({ sounds: false, volume: 0.1 });
    expect(resolve('sounds=1')).toMatchObject({ sounds: true });
    expect(resolve('sounds=junk', { sounds: true })).toMatchObject({ sounds: true });
  });

  it('alerts: the map takes toml and URL; the strip only an explicit URL', () => {
    expect(resolve('', { alerts: 'top-left' }, 'map').alerts).toBe('top-left');
    expect(resolve('alerts=top-right', { alerts: 'top-left' }, 'map').alerts).toBe('top-right');
    expect(resolve('', { alerts: 'top-left' }, 'strip').alerts).toBe('off');
    expect(resolve('alerts=top-center', {}, 'strip').alerts).toBe('top-center');
    expect(resolve('alerts=off', { alerts: 'top-left' }, 'map').alerts).toBe('off');
  });

  it('the alerts-only page shows banners at the top right unless told otherwise', () => {
    expect(resolve('', {}, 'alerts').alerts).toBe('top-right');
    expect(resolve('', { alerts: 'off' }, 'alerts').alerts).toBe('top-right');
    expect(resolve('alerts=top-left', {}, 'alerts').alerts).toBe('top-left');
    expect(resolve('alerts=off', {}, 'alerts').alerts).toBe('off');
  });

  it('only the leftmost window of a spanning strip makes noise', () => {
    expect(resolve('sounds=1', {}, 'strip', true).sounds).toBe(false);
    expect(resolve('sounds=1', {}, 'strip', false).sounds).toBe(true);
  });

  it('the a key toggles, remembering the last position', () => {
    expect(toggleAlerts('top-left', 'top-left')).toBe('off');
    expect(toggleAlerts('off', 'top-left')).toBe('top-left');
    expect(toggleAlerts('off', undefined)).toBe('top-right');
  });
});
