// The Bellwether mark: a sheep wearing the bell, on a 16x16 grid.
// W wool, F face, E ear, K eye, N nose, B bell rim, Y bell brass, L leg.
export const SPRITE = `
................
................
...WWWWWWW......
..WWWWWWWWW.EE..
.WWWWWWWWWWEEFF.
.WWWWWWWWWWFFKF.
.WWWWWWWWWWFFFF.
.WWWWWWWWWWWFFN.
.WWWWWWWWWWBBFF.
..WWWWWWWWBYYB..
..WWWWWWWWBYYB..
...WWWWWWWW.BB..
...L.L....L.L...
...L.L....L.L...
................
................`.trim().split('\n');

// Single-colour silhouette for the macOS menu bar (drawn with `X`). The head is split
// from the fleece by a one pixel gap and the bell is a hollow ring so it still reads at 16px.
export const TRAY = `
................
................
...XXXXXXX......
..XXXXXXXXX..XX.
.XXXXXXXXXX.XXXX
.XXXXXXXXXX.X.XX
.XXXXXXXXXX.XXXX
.XXXXXXXXXXXXXXX
.XXXXXXXXX.XXXX.
..XXXXXXXX.X..X.
..XXXXXXXX.XXXX.
...XXXXXXX......
...X.X.X.X......
...X.X.X.X......
................
................`.trim().split('\n');

export const PALETTE = {
  W: [250, 242, 222], F: [104, 88, 112], E: [104, 88, 112], K: [250, 242, 222],
  N: [240, 140, 150], B: [120, 72, 16], Y: [255, 208, 74], L: [104, 88, 112],
};
export const BG = [34, 40, 74];
export const BG2 = [48, 56, 104];
