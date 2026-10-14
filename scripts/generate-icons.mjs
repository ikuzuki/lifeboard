// Renders the PNG icon set from public/icon.svg. Run with `npm run icons`; the
// output is committed, so this does not run on every build.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public/icon.svg');
const outDir = resolve(root, 'public/icons');

// Matches --accent oklch(0.47 0.08 180) from src/index.css.
const BRAND = '#12695c';

// A maskable icon may be cropped to a circle of 80% width, so the glyph is scaled
// to sit inside that safe zone and the backing square is drawn full bleed.
const SAFE_ZONE_SCALE = 0.8;

/** The tick and underline without the rounded backing square. */
async function readGlyph() {
  const svg = await readFile(source, 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const glyph = body.replace(/<rect\b[^>]*\/>/g, '').trim();
  if (!glyph.includes('<path')) throw new Error('no glyph paths found in public/icon.svg');
  return glyph;
}

function fullBleed(glyph, scale) {
  const offset = 256 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BRAND}" />
  <g transform="translate(${offset} ${offset}) scale(${scale})">${glyph}</g>
</svg>`;
}

async function render(svg, size, name, opaque = false) {
  let pipeline = sharp(Buffer.from(svg)).resize(size, size);
  // iOS renders a transparent Apple touch icon against black, so drop the channel.
  if (opaque) pipeline = pipeline.flatten({ background: BRAND });
  const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  await writeFile(resolve(outDir, name), png);
  console.log(`${name} ${size}x${size} ${png.length} bytes`);
}

const glyph = await readGlyph();
const plain = await readFile(source, 'utf8');
const maskable = fullBleed(glyph, SAFE_ZONE_SCALE);
// iOS applies its own corner radius, so the Apple icon uses the glyph at full size.
const apple = fullBleed(glyph, 1);

await mkdir(outDir, { recursive: true });
await render(plain, 192, 'icon-192.png');
await render(plain, 512, 'icon-512.png');
await render(maskable, 192, 'maskable-192.png');
await render(maskable, 512, 'maskable-512.png');
await render(apple, 180, 'apple-touch-icon-180.png', true);
