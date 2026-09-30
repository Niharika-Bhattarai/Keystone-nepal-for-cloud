'use strict';

// Downloads the CC0 asset pack listed in assets.json from Poly Haven into
// ASSET_DIR (default: ./asset-pack next to this file), checking every file's
// md5. Safe to re-run: files already present with the right md5 are skipped.
//
//   node bake/fetch_assets.js [--dir <path>]
//
// Layout written:
//   textures/<id>/<id>_{diff,nor_gl,arm}_2k.jpg
//   hdris/<id>_4k.hdr
//   models/<id>/<id>_2k.gltf (+ .bin and textures/)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'KeystoneAI-bake/1.0 (+https://keystone-api-97830102261.us-central1.run.app)';
const manifest = require('./assets.json');
const argDir = process.argv.indexOf('--dir');
const ROOT = path.resolve(argDir > 0 ? process.argv[argDir + 1] : process.env.ASSET_DIR || path.join(__dirname, 'asset-pack'));

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

async function download(url, dest, sum) {
  if (fs.existsSync(dest) && (!sum || md5(fs.readFileSync(dest)) === sum)) return 'kept';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) { if (attempt === 3) throw new Error(`${url}: ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (sum && md5(buf) !== sum) { if (attempt === 3) throw new Error(`${url}: md5 mismatch`); continue; }
    fs.writeFileSync(dest, buf);
    return 'fetched';
  }
  return 'failed';
}

async function main() {
  const res = manifest.resolution || '2k';
  const tally = { fetched: 0, kept: 0 };
  const note = (r) => { tally[r] = (tally[r] || 0) + 1; };

  for (const id of Object.keys(manifest.textures)) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    for (const [map, key] of [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['arm', 'arm']]) {
      const f = files[map]?.[res]?.jpg;
      if (!f) { console.warn(`  ${id}: no ${map} ${res} jpg`); continue; }
      note(await download(f.url, path.join(ROOT, 'textures', id, `${id}_${key}_${res}.jpg`), f.md5));
    }
    const info = await json(`https://api.polyhaven.com/info/${id}`);
    fs.writeFileSync(path.join(ROOT, 'textures', id, 'info.json'), JSON.stringify({ id, dimensionsMm: info.dimensions || null, name: info.name }));
    console.log(`texture ${id}`);
  }

  for (const [id, opt] of Object.entries(manifest.hdris)) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const r = opt.res || '4k';
    const f = files.hdri?.[r]?.hdr;
    if (!f) throw new Error(`${id}: no ${r} hdr`);
    note(await download(f.url, path.join(ROOT, 'hdris', `${id}_${r}.hdr`), f.md5));
    console.log(`hdri ${id}`);
  }

  for (const id of Object.keys(manifest.models)) {
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const g = files.gltf?.[res]?.gltf;
    if (!g) { console.warn(`  ${id}: no ${res} gltf`); continue; }
    const dir = path.join(ROOT, 'models', id);
    note(await download(g.url, path.join(dir, path.basename(new URL(g.url).pathname)), g.md5));
    for (const [rel, inc] of Object.entries(g.include || {})) {
      if (rel.includes('..')) throw new Error(`${id}: unsafe path ${rel}`);
      note(await download(inc.url, path.join(dir, rel), inc.md5));
    }
    console.log(`model ${id}`);
  }
  console.log(`done: ${tally.fetched} fetched, ${tally.kept} already present -> ${ROOT}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
