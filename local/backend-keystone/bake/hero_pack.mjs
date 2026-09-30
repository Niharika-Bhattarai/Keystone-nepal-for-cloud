// Pack a cutaway bake for the landing page: one self-contained GLB.
//
// The studio's photoreal viewer loads lightmaps as separate files named in each
// material's extras. The landing page wants a single small file, so each lightmap is
// embedded as the material's occlusion texture on the second UV set (texCoord 1),
// resized to WebP; the page's viewer reads it back as a lightmap. The lawn and the
// film trees are dropped: the landing model is the house alone, floating.
//
//   node bake/hero_pack.mjs <bake-out-dir> <out.glb> [maxLightmapPx=1024] [lift=0]
//
// lift: metres the upper floor was raised in the bake; stored as the scene's
// extras.keystoneLift so the page knows where the floors meet.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, meshopt, weld, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [dir, output, maxPx = '1024', lift = '0'] = process.argv.slice(2);
if (!dir || !output) {
  console.error('usage: node bake/hero_pack.mjs <bake-out-dir> <out.glb> [maxLightmapPx]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(path.join(dir, 'house.web.glb'));
const root = doc.getRoot();

// The house alone: no lawn, trees or site dressing (their lightmaps go with them).
const DROP = /^Lawn$|tree|LOD\d/i;
let dropped = 0;
for (const node of root.listNodes()) {
  if (DROP.test(node.getName())) { node.dispose(); dropped++; }
}

const size = Number(maxPx);
const cache = new Map();
let embedded = 0;
for (const mat of root.listMaterials()) {
  const file = mat.getExtras()?.lightmap;
  if (!file) continue;
  let tex = cache.get(file);
  if (!tex) {
    const src = readFileSync(path.join(dir, file));
    const webp = await sharp(src).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
    tex = doc.createTexture(file.replace(/\.jpg$/, '')).setImage(webp).setMimeType('image/webp');
    cache.set(file, tex);
  }
  mat.setOcclusionTexture(tex);
  mat.getOcclusionTextureInfo().setTexCoord(1);
  embedded++;
}
// The page shows the bake alone (colour times baked light), a few hundred pixels wide:
// surface detail maps are never read and colour maps need no more than 512 px. (The
// furniture is lightened in the bake itself, before its light is baked per corner.)
for (const mat of root.listMaterials()) {
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
}
// Normals only serve live lights, which the page does not use; without them, corners
// that differed only by their normal weld into one vertex.
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
await doc.transform(weld());
for (const scene of root.listScenes()) scene.setExtras({ ...scene.getExtras(), keystoneLift: Number(lift) });
doc.createExtension(EXTTextureWebP).setRequired(true);
await doc.transform(
  prune({ keepAttributes: true, keepExtras: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80, slots: /^baseColor/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true);
await io.write(output, doc);
console.log(`${output}: ${(statSync(output).size / 1e6).toFixed(2)} MB; ${cache.size} lightmaps embedded on ${embedded} materials; ${dropped} nodes dropped`);
