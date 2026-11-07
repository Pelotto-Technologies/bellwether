// Builds a single self-contained HTML page that previews both packs.
//   node tools/spritegen/preview.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { PACKS, THEMES_DIR } from './build.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: preview.mjs <out.html>'); process.exit(2); }
const uri = (p) => 'data:image/png;base64,' + fs.readFileSync(path.join(THEMES_DIR, p)).toString('base64');
const js = (p) => JSON.parse(fs.readFileSync(path.join(THEMES_DIR, p), 'utf8'));

const data = {};
for (const pack of PACKS) {
  const dir = pack.name;
  const art = { ...js(`${dir}/art.json`), beacon: js(`${dir}/theme.json`).beacon };
  const roles = {};
  for (const [role, r] of Object.entries(art.roles)) roles[role] = { ...r, img: uri(`${dir}/${r.sheet.replace('.json', '.png')}`), frames: js(`${dir}/${r.sheet}`).frames };
  data[dir] = {
    art, roles,
    ground: { img: uri(`${dir}/sprites/ground.png`), frames: js(`${dir}/sprites/ground.json`).frames },
    tileset: { img: uri(`${dir}/map/tileset.png`), meta: js(`${dir}/map/tileset.json`) },
    props: { img: uri(`${dir}/map/props.png`), frames: js(`${dir}/map/props.json`).frames },
    ui: { img: uri(`${dir}/ui/ui.png`), frames: js(`${dir}/ui/ui.json`).frames },
  };
}
const tpl = fs.readFileSync(new URL('./preview.template.html', import.meta.url), 'utf8');
fs.writeFileSync(out, tpl.replace('/*__DATA__*/null', JSON.stringify(data)));
console.log(`wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
