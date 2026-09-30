// Write the Keystone AI mark's static files from its one geometry
// (src/data/keystoneMark.js): the favicon and the brand/ drafts.
//   node scripts/build-brand.mjs
import fs from 'node:fs';
import { markSvg } from '../src/data/keystoneMark.js';

const files = {
    'public/images/keystone-mark.svg': markSvg({ size: 64 }),
    'brand/keystone-mark.svg': markSvg({ size: 512 }),
    'brand/keystone-mark-light.svg': markSvg({ size: 512, tile: '#E8EEF4', ink: '#0F1420', key: '#B0843A' }),
    'brand/keystone-mark-plain.svg': markSvg({ size: 512, tile: null, ink: '#0F1420', key: '#B0843A' }),
};
for (const [file, svg] of Object.entries(files)) {
    fs.writeFileSync(new URL(`../${file}`, import.meta.url), `${svg}\n`);
    console.log(`wrote ${file}`);
}
