/** Pure tileset slicing, kept apart from Pixi so tests can import it in plain Node. */

export interface TilesetJson {
  tileSize: number;
  columns: number;
  tiles: Record<string, number>;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sliceTileset(set: TilesetJson): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const [name, i] of Object.entries(set.tiles)) {
    out[name] = { x: (i % set.columns) * set.tileSize, y: Math.floor(i / set.columns) * set.tileSize, width: set.tileSize, height: set.tileSize };
  }
  return out;
}
