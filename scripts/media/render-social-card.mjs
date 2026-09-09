/** Rebuild the static sharing card from local fonts, palette tokens and canonical SVGs. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const fontkit = require('fontkit');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = await readFile(path.join(root, 'src/app/globals.css'), 'utf8');
const token = (name) => {
  const value = css.match(new RegExp(`--${name}:\\s*(#[\\da-fA-F]{6})\\s*;`))?.[1];
  if (!value) throw new Error(`Missing literal palette token: ${name}`);
  return value;
};
const colors = Object.fromEntries(['canvas', 'surface', 'line', 'ink', 'muted', 'accent', 'forest']
  .map(name => [name, token(`workspace-${name}`)]));
const font = (family, style = 'normal', weight = 500) => {
  const filename = require.resolve(`@fontsource-variable/${family}/files/${family}-latin-wght-${style}.woff2`);
  // Fontkit's variable-font reader expects SFNT tables; unwrap local WOFF2 first.
  const sfnt = execFileSync(process.env.PYTHON || 'python3', ['-c',
    'import io,sys; from fontTools.ttLib import TTFont; f=TTFont(sys.argv[1]); f.flavor=None; b=io.BytesIO(); f.save(b); sys.stdout.buffer.write(b.getvalue())',
    filename]);
  return fontkit.create(sfnt).getVariation({ wght: weight });
};
const ui = font('manrope');
const uiBold = font('manrope', 'normal', 700);
const display = font('newsreader');
const italic = font('newsreader', 'italic');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

// Real font outlines make rendering independent of system fonts and network services.
function text(value, face, size, x, y, color, maxWidth) {
  const run = face.layout(value);
  const scale = size / face.unitsPerEm;
  const width = run.positions.reduce((sum, p) => sum + p.xAdvance, 0) * scale;
  if (width > maxWidth) throw new Error(`Text exceeds its ${maxWidth}px column: ${value}`);
  let cursor = 0;
  const glyphs = run.glyphs.map((glyph, i) => {
    const position = run.positions[i];
    const result = `<path transform="translate(${cursor + position.xOffset} ${position.yOffset})" d="${glyph.path.toSVG()}"/>`;
    cursor += position.xAdvance;
    return result;
  }).join('');
  return `<g aria-label="${escape(value)}" fill="${color}" transform="translate(${x} ${y}) scale(${scale} ${-scale})">${glyphs}</g>`;
}

async function canonicalSvg(filename, x, y, width, height) {
  const svg = await readFile(path.join(root, 'public/brand', filename), 'utf8');
  return svg.replace('<svg ', `<svg x="${x}" y="${y}" width="${width}" height="${height}" `);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="card-title card-description">
  <title id="card-title">QuotePlate: Every quote, accountable.</title>
  <desc id="card-description">Every supplier quote. One accountable decision. Ingredient requests, supplier responses, landed costs, and award decisions in one factual record.</desc>
  <rect width="1200" height="630" fill="${colors.canvas}"/>
  <rect x="960" width="240" height="630" fill="${colors.forest}"/>
  ${await canonicalSvg('wordmark-horizontal.svg', 72, 65, 220, 58)}
  ${text('RESTAURANT PROCUREMENT · INDIA', uiBold, 14, 72, 198, colors.muted, 816)}
  ${text('Every supplier quote.', display, 72, 72, 276, colors.ink, 816)}
  ${text('One accountable decision.', italic, 68, 72, 347, colors.accent, 816)}
  ${text('Ingredient requests, supplier responses, landed costs, and award', ui, 22, 72, 424, colors.muted, 816)}
  ${text('decisions in one factual record.', ui, 22, 72, 458, colors.muted, 816)}
  <path d="M72 534H920" stroke="${colors.line}"/>
  ${text('REQUEST / QUOTE / DECISION', uiBold, 12, 72, 570, colors.muted, 400)}
  ${text('EVERY QUOTE, ACCOUNTABLE.', uiBold, 12, 700, 570, colors.muted, 220)}
  <rect x="1003" y="238" width="154" height="154" rx="24" fill="${colors.surface}"/>
  ${await canonicalSvg('mark-duotone.svg', 1037, 259, 86, 101)}
</svg>\n`;
const image = await sharp(Buffer.from(svg)).png().toBuffer();
const metadata = await sharp(image).metadata();
if (metadata.width !== 1200 || metadata.height !== 630) throw new Error('Unexpected social-card dimensions');
await writeFile(path.join(root, 'docs/brand/social-card.svg'), svg);
await writeFile(path.join(root, 'public/brand/social-card.png'), image);
console.log(`Rendered social-card.png: ${metadata.width}×${metadata.height}, ${image.length} bytes; SVG source: docs/brand/social-card.svg`);
