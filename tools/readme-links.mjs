// The npm page renders the README without the repo around it, so relative links break.
// When the README is copied into the CLI package, point them at GitHub instead.
const REPO = 'https://github.com/Pelotto-Technologies/bellwether';
const RAW = 'https://raw.githubusercontent.com/Pelotto-Technologies/bellwether/main';

const IMAGE = /\.(png|gif|jpe?g|svg|webp)$/i;

/** Rewrites relative Markdown and HTML links: images to raw files, everything else to the blob view. */
export function absolutizeLinks(markdown) {
  const fix = (target) => {
    if (/^([a-z]+:|#|\/\/)/i.test(target)) return target;
    const path = target.replace(/^\.\//, '');
    return IMAGE.test(path.split('#')[0]) ? `${RAW}/${path}` : `${REPO}/blob/main/${path}`;
  };
  return markdown
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_, a, target, b) => a + fix(target) + b)
    .replace(/((?:src|href)=")([^"]+)(")/g, (_, a, target, b) => a + fix(target) + b);
}
