// Web-optimise the baked GLB: drop duplicates and unused data, weld, quantise
// vertex attributes (KHR_mesh_quantization) and compress geometry with
// meshoptimizer (EXT_meshopt_compression), textures to WebP. Materials, their extras (the
// lightmap file names) and both UV sets are kept.
//
//   node bake/optimize_glb.mjs <in.glb> <out.glb>

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, meshopt, simplifyPrimitive, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node bake/optimize_glb.mjs <in.glb> <out.glb>');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const t = Date.now();
const doc = await io.read(input);
// Film-quality plants and trees are far denser than a walkthrough needs.
// Baked surfaces (lightmapped or vertex-lit) are left exactly as baked.
const PLANT = /tree|shrub|plant|LOD\d/i;
let simplified = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh || !PLANT.test(node.getName())) continue;
  for (const prim of mesh.listPrimitives()) {
    const n = prim.getAttribute('POSITION')?.getCount() || 0;
    if (n < 8000 || prim.getAttribute('COLOR_0')) continue;
    if (prim.getMaterial()?.getAlphaMode() !== 'OPAQUE') continue; // leaf cards collapse to nothing
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.max(0.05, 8000 / n), error: 0.02, lockBorder: false });
    simplified++;
  }
}
await doc.transform(
  dedup(),
  prune({ keepAttributes: true, keepExtras: true }),
  weld(),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  // colour and data maps to WebP, at most 1024 px (EXT_texture_webp)
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true);
await io.write(output, doc);
const before = statSync(input).size, after = statSync(output).size;
console.log(`${output}: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB in ${Date.now() - t} ms`);
