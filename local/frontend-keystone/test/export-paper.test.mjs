import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// C7: a canvas cannot read CSS variables. fillStyle = 'var(--surface-1)' is ignored,
// so the elevation sheet exported black under near-black text. Exported images are
// painted with a literal colour; this keeps CSS variables out of canvas code.
const CANVAS_FILES = ['src/lib/raster.js', 'src/studio/Render3DPanel.jsx'];

test('canvas fills and export backgrounds never use CSS variables', () => {
  for (const file of CANVAS_FILES) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const offenders = src.split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith('//'))
      .filter(({ line }) => /(fillStyle|strokeStyle|background)\s*[=:]\s*['"`]var\(/.test(line) || /svgToPngDataUrl\([^)]*var\(--/.test(line));
    assert.deepEqual(offenders, [], `${file} paints with a CSS variable`);
  }
});

test('the export paper is an opaque hex colour', async () => {
  const src = fs.readFileSync(new URL('../src/lib/raster.js', import.meta.url), 'utf8');
  const paper = src.match(/export const EXPORT_PAPER = '([^']+)'/)?.[1];
  assert.match(paper || '', /^#[0-9A-Fa-f]{6}$/);
});
