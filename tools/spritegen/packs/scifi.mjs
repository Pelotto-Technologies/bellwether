// Deep Space pack: an original sci-fi survey crew working an outpost on an alien world.
// Generic spacefarer archetypes with their own names and designs; no characters,
// uniforms, ships or insignia from any film, show or game.
export default {
  name: 'scifi',
  displayName: 'Deep Space',
  description: 'An original sci-fi survey crew working a glass-domed outpost on a violet-mossed alien world.',
  // Camp scene: `tone` is 'camp' (wood and canvas) or 'outpost' (plating and holograms).
  camp: { tone: 'outpost', sky: ['#0e1636', '#3c2a70'], glow: '#5ae8ff' },
  fallback: 'generic',
  palette: {
    q: '#1a2438', o: '#0c1020', e: '#0c1020', k: '#5a2638', n: '#f08a9a',
    s: '#f0c4a0', S: '#cc9672',
    g: '#bff6ff', G: '#ffffff', z: '#d8fbff',
    m: '#c4ccdc', M: '#7e889e', w: '#8e98ae', W: '#5e6880',
    l: '#3a4258', L: '#262c40', b: '#2e3448', B: '#1c2132',
    p: '#3a4666', P: '#283250', a: '#3ad0e8', A: '#1a90b0', y: '#8af0ff', Y: '#2a90a8', x: '#3a4a7a', X: '#28345a',
    t: '#6a7a9a', T: '#4a5878', c: '#6a7a9a', C: '#4a5878', u: '#6a7a9a', U: '#4a5878', h: '#3a3a4a', H: '#26262e', f: '#3a3a4a', F: '#26262e',
  },
  status: {
    working: '#4af0a0', done: '#ffd24a', blocked: '#ff5470', idle: '#dfe8f0', unknown: '#8a94aa',
  },
  characters: [
    { id: 'orchestrator', role: 'orchestrator', displayName: 'Commander', hair: 'short', hat: 'circlet', torso: 'coat', item: 'beaconPole',
      accessories: ['cape'], blush: true,
      colors: { h: '#d8dce8', H: '#a8aec0', t: '#2a4a9a', T: '#1c3270', c: '#2a4a9a', C: '#1c3270', a: '#5ae8ff', y: '#e8eef8', p: '#1c2848', P: '#121b34', g: '#bff6ff', G: '#ffffff' } },
    { id: 'coordinator', role: 'coordinator', displayName: 'Quartermaster', hair: 'ponytail', torso: 'vest', item: 'clipboard', accessories: ['backpack'],
      colors: { s: '#7ad0c4', S: '#52a89c', h: '#3a2a6a', H: '#261a4a', t: '#e8f0f4', T: '#bccad4', c: '#e07a2a', C: '#b05a18', a: '#ffb23a', y: '#8af0ff', p: '#3a4666', P: '#283250' } },
    { id: 'architect', role: 'architect', displayName: 'Cartographer', hair: 'long', hat: 'beret', torso: 'coat', item: 'scroll', accessories: ['collar'],
      colors: { h: '#1e1a2e', H: '#100e1c', x: '#6a3ab0', X: '#4a2680', a: '#5ae8ff', t: '#4a3a8a', T: '#342868', c: '#6a3ab0', C: '#4a2680', y: '#8af0ff', p: '#262040', P: '#181430' } },
    { id: 'implementer', role: 'implementer', displayName: 'Mechanic', hair: 'short', beard: 'short', hat: 'hardhat', torso: 'builder', item: 'wrench',
      colors: { s: '#a8704a', S: '#865436', h: '#2a2420', H: '#1a1614', f: '#2a2420', F: '#1a1614', x: '#ff9a2a', X: '#c47018', t: '#e8742a', T: '#b45018', a: '#ffe08a', y: '#e8742a', Y: '#b45018', p: '#3e4660', P: '#2a3248' } },
    { id: 'reviewer', role: 'reviewer', displayName: 'Inspector', hair: 'neat', face: 'glasses', torso: 'coat', item: 'magnifier', accessories: ['badge'],
      colors: { h: '#c8ccd8', H: '#989cac', t: '#d8dce6', T: '#a8aebe', c: '#c43a54', C: '#942a40', a: '#ff5470', y: '#bff6ff', p: '#2e3650', P: '#1e2538', q: '#5ae8ff' } },
    { id: 'researcher', role: 'researcher', displayName: 'Xenologist', hair: 'spiky', hat: 'helm', torso: 'tunic', item: 'baton', accessories: ['backpack'],
      colors: { s: '#b8a0e0', S: '#8e78bc', h: '#4af0a0', H: '#28b878', m: '#dfe8f0', M: '#9aa6bc', a: '#4af0a0', t: '#2e7a68', T: '#1e5648', c: '#2e7a68', C: '#1e5648', y: '#4af0a0', p: '#2a3a52', P: '#1c283c' } },
    { id: 'writer', role: 'writer', displayName: 'Archivist', hair: 'bald', face: 'glasses', torso: 'sweater', item: 'book', accessories: ['scarf'], blush: true,
      colors: { s: '#8a5a3e', S: '#6a4228', t: '#6a8ac8', T: '#4a68a0', c: '#e8b84a', C: '#b88a2a', y: '#e8f0f8', a: '#e8b84a', p: '#2e3650', P: '#1e2538', q: '#5ae8ff' } },
    { id: 'ops', role: 'ops', displayName: 'Pilot', hair: 'curly', hat: 'cap', torso: 'armor', item: 'lantern', accessories: ['cape'],
      colors: { s: '#d09a6e', S: '#a87650', h: '#e84a8a', H: '#b0286a', x: '#2ac4a8', X: '#1a8a78', a: '#ffe08a', t: '#2ac4a8', T: '#1a8a78', c: '#2ac4a8', C: '#1a8a78', y: '#bff6ff', p: '#2e3650', P: '#1e2538' } },
    { id: 'generic', role: 'generic', displayName: 'Crewmate', hair: 'short', torso: 'tunic', accessories: ['badge'], blush: true,
      colors: { h: '#8a6a4a', H: '#6a4e34', t: '#8a98b4', T: '#68789a', c: '#8a98b4', C: '#68789a', a: '#5ae8ff', p: '#3a4666', P: '#283250' } },
  ],
};
