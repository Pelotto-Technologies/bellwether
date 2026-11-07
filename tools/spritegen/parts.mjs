// Pixel templates for 24x32 characters. Characters face right (3/4 view);
// the renderer mirrors them to walk left.
//
// Palette keys used by templates:
//   s S skin        h H hair       f F beard      e eye        k mouth/dark detail
//   n blush         x X hat        t T top        u U sleeve   p P trousers
//   b B boots       c C cloak slot (tintable)     a A accent   m M metal
//   w W wood        y Y extra      l L leather    g G status light (tintable)
//   q   eyewear/patch   z   status sparkle (tintable, never outlined)               o outline
// Templates use '.' for transparent and '_' to erase.

export const HEAD = { x: 7, y: 6 };
export const TORSO = { x: 8, y: 15 };
export const SHOULDER_BACK = { x: 6, y: 15 };
export const SHOULDER_FRONT = { x: 16, y: 15 };

export const HEAD_ROWS = [
  '..ssssss..',
  '.ssssssss.',
  'ssssssssss',
  'ssssssssss',
  'sssSssssss',
  'sssSssssss',
  'ssssssssss',
  '.ssssssss.',
  '..SSSSSS..',
];

// Hair: { dx, dy, rows } relative to HEAD.
export const HAIR = {
  short: { dx: 0, dy: -2, rows: [
    '..hhhhhh..',
    '.hhhhhhhhh',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hHhhhhhhhh',
    'hHhhh.hhh.',
    'hHh.......',
    'hH........',
    '.H........',
  ] },
  neat: { dx: 0, dy: -2, rows: [
    '..hhhhhh..',
    '.hhhhhhhh.',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hHhhhhhhhh',
    'hHh.......',
    'hH........',
    '.H........',
  ] },
  spiky: { dx: 0, dy: -3, rows: [
    '..h..h.h..',
    '.hhhhhhhhh',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hHhhhhhhhh',
    'hHhhhhhhhh',
    'hHh.hh.h..',
    'hH........',
    '.H........',
  ] },
  long: { dx: 0, dy: -2, rows: [
    '..hhhhhh..',
    '.hhhhhhhhh',
    'hhhhhhhhhh',
    'hhhhhhhhhh',
    'hHhhhhhhhh',
    'hHhhh.hhh.',
    'hHh.......',
    'hHh.......',
    'hHh.......',
    'hHh.......',
    'hHH.......',
    'HHH.......',
    '.HH.......',
  ] },
  braid: { dx: -1, dy: -2, rows: [
    '...hhhhhh..',
    '..hhhhhhhhh',
    '.hhhhhhhhhh',
    '.hhhhhhhhhh',
    '.hHhhhhhhhh',
    '.hHhhh.hhh.',
    '.hHh.......',
    '.hH........',
    'hH.........',
    'hH.........',
    'Hh.........',
    'aa.........',
    'H..........',
  ] },
  ponytail: { dx: -2, dy: -2, rows: [
    '....hhhhhh..',
    '...hhhhhhhhh',
    '..hhhhhhhhhh',
    'haahhhhhhhhh',
    'hHhHhhhhhhhh',
    'HH.Hhhh.hhh.',
    'HH.Hh.......',
    '.H..H.......',
    '.H..........',
    '.H..........',
  ] },
  curly: { dx: 0, dy: -2, rows: [
    '.h.hh.h...',
    'hhhhhhhhh.',
    'hHhhhhhhhh',
    'hhhHhhhhhh',
    'hHhhhhHhhh',
    'hHhh.h.hh.',
    'hHh.......',
    'Hh........',
    '.H........',
  ] },
  bald: { dx: 0, dy: 0, rows: [
    '..........',
    '..........',
    '..........',
    'hh........',
    'hH........',
    '.H........',
  ] },
  none: { dx: 0, dy: 0, rows: [] },
};

export const HATS = {
  tophat: { dx: 0, dy: -5, rows: [
    '..xxxxxx..',
    '..Xxxxxx..',
    '..Xxxxxx..',
    '..aaaaaa..',
    '..Xxxxxx..',
    'xxxxxxxxxxx',
  ] },
  brim: { dx: -1, dy: -3, rows: [
    '....xxxxx...',
    '...Xxxxxxx..',
    '...aaaaaaa..',
    'xxxxxxxxxxxx',
    '.XXXXXXXXXX.',
  ] },
  cap: { dx: 0, dy: -2, rows: [
    '..xxxxxx....',
    '.Xxxxxaxx...',
    'XXxxxxxxxx..',
    'XXXXXXXXxxxx',
  ] },
  hardhat: { dx: 0, dy: -3, rows: [
    '...xxxx....',
    '..xxxxxx...',
    '.XxxxxxgG..',
    'XXXXXXXXXXX',
  ] },
  beret: { dx: 0, dy: -3, rows: [
    '.....x....',
    '.xxxxxxx..',
    'xxxxxxxxxx.',
    '.XXXXXXXXX.',
  ] },
  helm: { dx: 0, dy: -3, rows: [
    '...mmmm...',
    '..mmmmmm..',
    '.Mmmmmmmm.',
    'MMmmmmmmmm',
    'aaaaaaaaaa',
    '..........',
    '.......m..',
    '.......m..',
  ] },
  hood: { dx: 0, dy: -2, rows: [
    '...cccc...',
    '.cccccccc.',
    'cccccccccc',
    'cccccccccc',
    'Ccccccccc.',
    'Cccc......',
    'Cccc......',
    'Cccc......',
    'CCcc......',
    'CCcc......',
    'CCccc.....',
    '.CCcccc...',
  ] },
  circlet: { dx: 0, dy: 2, rows: ['.aaaaaaya.'] },
  point: { dx: -1, dy: -6, rows: [
    '......xx....',
    '.....xxX....',
    '....xxxX....',
    '....xxxxX...',
    '...xxxxxX...',
    '...aaaaaaa..',
    'xxxxxxxxxxxx',
    '.XXXXXXXXXX.',
  ] },
  none: { dx: 0, dy: 0, rows: [] },
};

export const BEARDS = {
  full: { dx: 0, dy: 5, rows: [
    '...F......',
    '...Ff...ff',
    '...Fffffff',
    '...FFfffff',
    '....Fffff.',
    '.....fff..',
  ] },
  long: { dx: 0, dy: 5, rows: [
    '...F......',
    '...Ff...ff',
    '...Fffffff',
    '...FFfffff',
    '....Fffff.',
    '....Fffff.',
    '....FFfff.',
    '.....Fff..',
    '.....Ff...',
    '......f...',
  ] },
  short: { dx: 0, dy: 6, rows: [
    '...F.....f',
    '...Ff...ff',
    '...FFffff.',
    '.....fff..',
  ] },
  mustache: { dx: 0, dy: 6, rows: ['.......fff'] },
  none: { dx: 0, dy: 0, rows: [] },
};

// Face pieces, relative to HEAD.
export const EYES = [[6, 4], [6, 5], [8, 4], [8, 5]];
export const FACE_EXTRAS = {
  glasses: { dx: 5, dy: 3, rows: ['qqqqq', 'q...q'] },
  eyepatch: { dx: 3, dy: 2, rows: ['q....', '.qq..', '.qq..', '.qq..'] },
  none: { dx: 0, dy: 0, rows: [] },
};

// Torsos: { dx, rows } at TORSO. Rows beyond 8 cover the legs (robes).
export const TORSOS = {
  tunic: { dx: 0, rows: [
    'tttttttt',
    'Tttttttt',
    'Tttttttt',
    'Tttttttt',
    'Tttttttt',
    'llllllml',
    'Tttttttt',
    'TTtttttt',
  ] },
  coat: { dx: 0, rows: [
    'cccyyycc',
    'Cccyyacc',
    'Cccyyacc',
    'Cccyyycc',
    'Cccyyycc',
    'Cccccccc',
    'Cccccccc',
    'CCcccccc',
  ] },
  vest: { dx: 0, rows: [
    'cctttccc',
    'Cctttccc',
    'Caaaaaac',
    'Cctttccc',
    'Cctttccc',
    'llllllml',
    'Tttttttt',
    'TTtttttt',
  ] },
  builder: { dx: 0, rows: [
    'tttttttt',
    'Tttttttt',
    'Ttttyttt',
    'Tttttttt',
    'Tttttttt',
    'llmllmll',
    'TlwTttMt',
    'TTtttttt',
  ] },
  sweater: { dx: 0, rows: [
    'ttyyyytt',
    'Tttyyttt',
    'Tttttttt',
    'TTtTtTtt',
    'Tttttttt',
    'Tttttttt',
    'TTTTTTTT',
    'pppppppp',
  ] },
  armor: { dx: 0, rows: [
    'mmmmmmmm',
    'MmMmmmmm',
    'mMmMmMmM',
    'MmMmMmMm',
    'mMmMmMmM',
    'llllllal',
    'tttttttt',
    'TTtttttt',
  ] },
  robe: { dx: -1, rows: [
    '.tttttttt.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.llllllal.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.TTtttttt.',
    'TTTttttttt',
    'TTTttttttt',
    'aaaaaaaaaa',
  ] },
  dress: { dx: -1, rows: [
    '.tttttttt.',
    '.Tttyyttt.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.Tttttttt.',
    '.llllllll.',
    '.Tttttttt.',
    '.TTttttttt',
    'TTTttttttt',
    'TTTttttttt',
    'aaaaaaaaaa',
  ] },
  bare: { dx: 0, rows: [
    'ssssssss',
    'SsssSsss',
    'SssssSss',
    'Ssssssss',
    'SsSsssss',
    'llllllal',
    'tttttttt',
    'TTtttttt',
  ] },
};

// Accessories drawn at various depths, positioned relative to TORSO.
export const ACCESSORIES = {
  cape: { depth: 'back', dx: -4, dy: 0, rows: [
    '..cccc',
    '.ccccc',
    'Cccccc',
    'Ccccc.',
    'Ccccc.',
    'CCccc.',
    'CCccc.',
    'CCCcc.',
    'CCCcc.',
    'CCCCc.',
    'CCCC..',
    '.CCC..',
  ], flutter: [
    '..cccc',
    '.ccccc',
    'Cccccc',
    'Ccccc.',
    'Ccccc.',
    'CCccc.',
    'CCccc.',
    'CCCcc.',
    'CCCcc.',
    'CCCC..',
    'CCC...',
  ] },
  tails: { depth: 'back', dx: -1, dy: 7, rows: ['CCc...', 'CCc...', 'CC....', 'C.....'] },
  backpack: { depth: 'back', dx: -4, dy: 0, rows: [
    '.yy.',
    'yYyy',
    'yYaa',
    'yYyy',
    'yYyy',
    'yYyy',
    '.YY.',
  ] },
  shield: { depth: 'arm', dx: -6, dy: 0, rows: [
    '..yyy..',
    '.yYaYy.',
    'yYyayYy',
    'yaamaay',
    'yYyayYy',
    '.yYaYy.',
    '..yyy..',
  ] },
  mantle: { depth: 'front', dx: -1, dy: -1, rows: [
    '.cccccccc.',
    'cccccccccc',
    'CcCccCcCcC',
    '.C..C..C..',
  ] },
  scarf: { depth: 'front', dx: -1, dy: -1, rows: [
    '.cccccccc.',
    'cCcccccccc',
    'Cc........',
    'Cc........',
    '.C........',
  ] },
  collar: { depth: 'front', dx: 0, dy: -1, rows: ['.aaaaaa.'] },
  badge: { depth: 'front', dx: 5, dy: 2, rows: ['gG'] },
  none: { depth: 'front', dx: 0, dy: 0, rows: [] },
};

// Arms: { dx, dy, rows, grip:[x,y] } relative to the shoulder. 'u' is the sleeve.
export const ARMS = {
  down: { dx: 0, dy: 0, grip: [1, 6], rows: ['uu', 'Uu', 'Uu', 'Uu', 'Uu', 'Uu', 'ss'] },
  swingF: { dx: 0, dy: 0, grip: [2, 6], rows: ['uu.', 'Uu.', 'Uu.', '.Uu', '.Uu', '.Uu', '.ss'] },
  swingB: { dx: -1, dy: 0, grip: [1, 6], rows: ['.uu', '.Uu', '.Uu', 'Uu.', 'Uu.', 'Uu.', 'ss.'] },
  wave0: { dx: -4, dy: -6, grip: [2, 1], rows: [
    '.ss...',
    '.ss...',
    '.uu...',
    '..uu..',
    '..Uuu.',
    '...Uuu',
    '....uu',
  ] },
  wave1: { dx: -2, dy: -7, grip: [1, 1], rows: [
    'ss..',
    'ss..',
    'uu..',
    'uu..',
    'Uu..',
    '.uu.',
    '.Uuu',
    '..uu',
  ] },
  gesture: { dx: -2, dy: 0, grip: [1, 5], rows: ['..uu', '..Uu', '..Uu', '.UUu', 'uU..', 'ss..'] },
  raise: { dx: 0, dy: -7, grip: [2, 1], rows: ['.ss', '.ss', '.uu', '.uU', '.uU', 'uU.', 'uU.', 'uu.'] },
};

// Held items: { hold, raise } each { rows, grip:[x,y] } where grip is the cell under the hand.
function pole(top, shaft, length = 27) {
  const w = top[0].length;
  const pad = (s) => s.padStart(Math.ceil((w + s.length) / 2), '.').padEnd(w, '.');
  const rows = [...top];
  let i = 0;
  while (rows.length < length) rows.push(pad(shaft[i++ % shaft.length]));
  const c = Math.floor(w / 2);
  return { hold: { rows, grip: [c, 17] }, raise: { rows, grip: [c, 8] } };
}

export const ITEMS = {
  none: null,
  beaconPole: pole(['mmm', 'gGg', 'ggg', 'mmm'], ['a', 'a', 'y', 'y']),
  runeStaff: pole(['.g.', 'gGg', 'mgm', '.m.'], ['w', 'w', 'w', 'W']),
  sunStaff: pole(['..g..', '.gGg.', 'gGGGg', '.gGg.', '..g..', '..a..'], ['w']),
  spear: pole(['..m..', '.mMm.', '.mMm.', '..m..', '.gGg.'], ['w', 'w', 'W']),
  oar: pole(['.ww.', 'wwww', 'wgGw', 'wggw', 'wwww', '.ww.'], ['w', 'w', 'W']),
  hammer: {
    hold: { grip: [1, 5], rows: ['.mmmmm', '.MmgGM', '.MMmMM', '...w..', '..w...', '.w....', 'W.....'] },
    raise: { grip: [2, 5], rows: ['mmmmm', 'MmGgM', 'MMmMM', '..w..', '..w..', '..w..', '..W..'] },
  },
  sword: {
    hold: { grip: [1, 1], rows: ['.w.', '.w.', 'gGg', '.m.', '.m.', '.m.', '.m.', '.M.'] },
    raise: { grip: [1, 6], rows: ['.z.', '.G.', '.g.', '.g.', '.g.', 'aAa', '.w.', '.G.'] },
  },
  baton: {
    hold: { grip: [0, 0], rows: ['W....', '.w...', '..w..', '...gg', '...gG'] },
    raise: { grip: [0, 4], rows: ['...gG', '...gg', '..w..', '.w...', 'W....'] },
  },
  clipboard: {
    hold: { grip: [0, 3], rows: ['.mgm.', 'yyyyy', 'yaaay', 'yakay', 'yaaay', 'yakay', 'yyyyy'] },
    raise: { grip: [0, 3], rows: ['.mGm.', 'yyyyy', 'yaaay', 'yakay', 'yaaay', 'yakay', 'yyyyy'] },
  },
  magnifier: {
    hold: { grip: [0, 5], rows: ['..mmm.', '.mgGgm', '.mgggm', '..mmm.', '.w....', 'w.....'] },
    raise: { grip: [1, 5], rows: ['..mmm.', '.mgGgm', '.mgggm', '..mmm.', '.w....', 'w.....'] },
  },
  lantern: {
    hold: { grip: [1, 0], rows: ['.mm.', '.MM.', 'mggm', 'mgGm', 'mggm', '.MM.'] },
    raise: { grip: [1, 0], rows: ['.mm.', '.MM.', 'mggm', 'mGGm', 'mggm', '.MM.'] },
  },
  book: {
    hold: { grip: [0, 3], rows: ['aaaaa', 'ayyya', 'agGya', 'aggya', 'ayyya', 'aaaaa'] },
    raise: { grip: [0, 3], rows: ['aaaaa', 'ayyya', 'aGGya', 'aGgya', 'ayyya', 'aaaaa'] },
  },
  wrench: {
    hold: { grip: [0, 4], rows: ['...m.m', '...mmm', '..m...', '.m....', 'M.....'] },
    raise: { grip: [1, 4], rows: ['...m.m', '...mmm', '..m...', '.m....', 'M.....'] },
  },
  torch: {
    hold: { grip: [0, 5], rows: ['....gg', '...gGg', '...gg.', '..w...', '.w...', 'W.....'] },
    raise: { grip: [1, 5], rows: ['...zgg', '...gGg', '...gg.', '..w...', '.w...', 'W.....'] },
  },
  horn: {
    hold: { grip: [1, 4], rows: ['....gG', '...aga', '..yyy.', '.yyy..', 'yy....', 'y.....'] },
    raise: { grip: [2, 4], rows: ['....GG', '...aga', '..yyy.', '.yyy..', 'yy....', 'y.....'] },
  },
  axe: {
    hold: { grip: [1, 1], rows: ['.w...', '.w...', '.w...', '.wmm.', '.wmMm', '.wgGm', '.wmm.', '.W...'] },
    raise: { grip: [1, 6], rows: ['.mm..', 'mMmw.', 'mGgw.', '.mmw.', '...w.', '...w.', '...w.', '...W.'].map((r) => r) },
  },
  bow: {
    hold: { grip: [0, 5], rows: ['.w...', '..w..', '..w.y', '...wy', '...wy', 'aaagy', '...wy', '...wy', '..w.y', '..w..', '.w...'] },
    raise: { grip: [0, 5], rows: ['.w...', '..w..', '..w.y', '...wy', '...wy', 'aaaGy', '...wy', '...wy', '..w.y', '..w..', '.w...'] },
  },
  pan: {
    hold: { grip: [0, 1], rows: ['W.....', 'ww.mm.', '..mMgm', '..mggm', '...mm.'] },
    raise: { grip: [0, 1], rows: ['W.....', 'ww.mm.', '..mMGm', '..mGgm', '...mm.'] },
  },
  scroll: {
    hold: { grip: [0, 1], rows: ['wyyyyw', '.yyyy.', '.ygGy.', 'wyyyyw'] },
    raise: { grip: [1, 1], rows: ['wyyyyw', '.yyyy.', '.yGGy.', 'wyyyyw'] },
  },
};
