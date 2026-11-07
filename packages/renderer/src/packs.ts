import { parseArt, type Art } from './art.js';
import { parseTheme, type Theme } from './theme.js';

/**
 * Bundles every pack under themes/ (public ones ship; private ones exist only on the
 * author's machine). Vite resolves these globs at build time.
 */
const themeFiles = import.meta.glob('../../../themes/*/theme.json', { eager: true, import: 'default' });
const artFiles = import.meta.glob('../../../themes/*/art.json', { eager: true, import: 'default' });
const sheetFiles = import.meta.glob('../../../themes/*/{sprites,ui}/*.json', { eager: true, import: 'default' });
const imageFiles = import.meta.glob('../../../themes/*/{sprites,ui}/*.png', { eager: true, query: '?url', import: 'default' });

const PREFIX = '../../../themes/';

function packOf(path: string): string {
  return path.slice(PREFIX.length).split('/')[0]!;
}

export function availablePacks(): string[] {
  return Object.keys(themeFiles).map(packOf).sort();
}

export interface PackData {
  name: string;
  theme: Theme;
  /** Present when the pack ships art; otherwise the procedural figures are used. */
  art: Art | null;
  sheetJson(rel: string): unknown;
  imageUrl(rel: string): string;
}

export function packData(name: string): PackData {
  const key = (rel: string) => `${PREFIX}${name}/${rel}`;
  const themeRaw = themeFiles[key('theme.json')];
  if (!themeRaw) throw new Error(`unknown pack "${name}"`);
  const artRaw = artFiles[key('art.json')];
  return {
    name,
    theme: parseTheme(themeRaw),
    art: artRaw ? parseArt(artRaw) : null,
    sheetJson: (rel) => {
      const j = sheetFiles[key(rel)];
      if (!j) throw new Error(`pack ${name}: missing ${rel}`);
      return j;
    },
    imageUrl: (rel) => {
      const u = imageFiles[key(rel.replace(/\.json$/, '.png'))];
      if (typeof u !== 'string') throw new Error(`pack ${name}: missing image for ${rel}`);
      return u;
    },
  };
}
