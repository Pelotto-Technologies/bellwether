// Wayfarers pack: an original fantasy quest party. Generic archetypes with
// their own names and designs; no characters or likenesses from any book or film.
export default {
  name: 'wayfarers',
  displayName: 'Wayfarers',
  description: 'An original fantasy quest party setting out from a hill country of burrow houses.',
  // Camp scene: `tone` is 'camp' (wood and canvas) or 'outpost' (plating and holograms).
  camp: { tone: 'camp', sky: ['#f2c27a', '#fdeccb'], glow: '#ffa040' },
  // The fleet hub on the map: guildhouse, greathall, waystation, tower or generic (see themes.md).
  hub: 'waystation',
  fallback: 'generic',
  palette: {
    q: '#2a2016', o: '#1a1410', e: '#1a1410', k: '#5a2620', n: '#ec8c7c',
    s: '#f2c49c', S: '#d49a74',
    g: '#ffe9a0', G: '#fffbe6', z: '#fff2c0',
    m: '#c4c8d0', M: '#868c98', w: '#8a5a33', W: '#5e3b20',
    l: '#5a3a24', L: '#3e281a', b: '#3e2c22', B: '#2a1e18',
    p: '#5a5040', P: '#423a2e', a: '#d9b04a', A: '#a8822e',
  },
  status: {
    working: '#62d670', done: '#ffd44f', blocked: '#ff5248', idle: '#ede8dc', unknown: '#958f9e',
  },
  characters: [
    { id: 'orchestrator', role: 'orchestrator', displayName: 'Warden', hair: 'long', hat: 'circlet', torso: 'robe', item: 'sunStaff',
      accessories: ['cape'],
      colors: { h: '#e8e4f0', H: '#b8b2c8', t: '#e8eef8', T: '#b8c4d8', c: '#3a5aa8', C: '#28407e', y: '#5ab0ff', a: '#d9b04a', p: '#b8c4d8', P: '#94a0b8', g: '#bfe4ff', G: '#ffffff' } },
    { id: 'coordinator', role: 'coordinator', displayName: 'Hearthkeeper', hair: 'curly', torso: 'vest', item: 'pan', accessories: ['backpack'],
      barefoot: true, blush: true,
      colors: { h: '#a8743e', H: '#7e5428', t: '#e8dcc0', T: '#c4b494', c: '#7a5a3a', C: '#5a4028', a: '#7a5a3a', y: '#6a7a3a', Y: '#4e5a2a', p: '#6a5a40', P: '#4e4230' } },
    { id: 'architect', role: 'architect', displayName: 'Wanderer', hair: 'long', beard: 'long', hat: 'point', torso: 'robe', item: 'runeStaff',
      accessories: ['cape'],
      colors: { h: '#f0ece4', H: '#c4beb4', f: '#f4f0ea', F: '#c8c2b8', x: '#6a3a7a', X: '#4a2858', a: '#d9b04a', t: '#2e4a6a', T: '#203650', c: '#5a3a6a', C: '#40284e' } },
    { id: 'implementer', role: 'implementer', displayName: 'Smith', hair: 'short', beard: 'long', hat: 'helm', torso: 'armor', item: 'axe',
      colors: { h: '#2a2420', H: '#1a1614', f: '#3a3430', F: '#24201c', t: '#7a3a2a', T: '#5a2a1e', a: '#d9b04a', c: '#7a3a2a', C: '#5a2a1e', p: '#4a3a30', P: '#342a22' } },
    { id: 'reviewer', role: 'reviewer', displayName: 'Archer', hair: 'long', torso: 'tunic', item: 'bow', accessories: ['cape'],
      colors: { s: '#a86e4a', S: '#865436', h: '#1e1a22', H: '#121016', t: '#b8582a', T: '#8e401c', c: '#c8902a', C: '#9a6c1c', y: '#e8e0d0', p: '#4a3a2a', P: '#342a1e' } },
    { id: 'researcher', role: 'researcher', displayName: 'Ranger', hair: 'ponytail', hat: 'hood', torso: 'tunic', item: 'sword', accessories: ['cape'],
      colors: { h: '#8a3a22', H: '#642a18', t: '#4a5a3a', T: '#36422a', c: '#3e4a3a', C: '#2a3428', a: '#a8a090', A: '#7a7466', p: '#3e3830', P: '#2c2822' } },
    { id: 'writer', role: 'writer', displayName: 'Chronicler', hair: 'neat', face: 'glasses', torso: 'coat', item: 'book', accessories: ['scarf'],
      colors: { h: '#d8d4cc', H: '#aaa49a', c: '#7a2e3a', C: '#5a202a', y: '#efe6d0', a: '#2e5a3a', t: '#7a2e3a', T: '#5a202a' } },
    { id: 'ops', role: 'ops', displayName: 'Scout', hair: 'curly', torso: 'tunic', item: 'torch', accessories: ['cape'], barefoot: true, blush: true,
      colors: { h: '#5a3a22', H: '#3e2816', t: '#c8a868', T: '#a08450', c: '#4a7a3a', C: '#36582a', p: '#5a5040', P: '#423a2e' } },
    { id: 'generic', role: 'generic', displayName: 'Hillfolk', hair: 'curly', torso: 'tunic', accessories: ['badge'], barefoot: true, blush: true,
      colors: { h: '#c48a4a', H: '#9a6a34', t: '#9ab06a', T: '#7a8e4e', c: '#9ab06a', C: '#7a8e4e', p: '#6a5a40', P: '#4e4230' } },
  ],
};
