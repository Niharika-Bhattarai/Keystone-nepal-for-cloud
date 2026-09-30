'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Deliberately restricted CSV: no embedded commas or quoted fields. Fail closed
// on malformed prices rather than silently producing a zero-dollar estimate.
function parsePrices(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const keys = header.split(',');
  const seen = new Set();
  return lines.map(line => {
    const cells = line.split(',');
    if (cells.length !== keys.length) throw new Error('Invalid unit-price CSV columns');
    const row = Object.fromEntries(keys.map((key, i) => [key, cells[i]]));
    const id = `${row.key}:${row.scope}:${row.region}`;
    if (seen.has(id)) throw new Error(`Duplicate unit price ${id}`);
    seen.add(id);
    if (!['national', 'state', 'zip'].includes(row.scope) || !row.source || !row.status
      || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid price provenance ${id}`);
    for (const key of ['material', 'labor']) {
      if (!row[key] || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0) throw new Error(`Invalid price ${id}`);
      row[key] = Number(row[key]);
    }
    return row;
  });
}
const prices = parsePrices(fs.readFileSync(path.join(__dirname, 'data/unit-prices.csv'), 'utf8'));
function findPrice(key, location = {}, rows = prices) {
  location = location || {};
  const zip = String(location.zipCode || '').slice(0, 5);
  const state = String(location.state || '').toUpperCase();
  return rows.find(r => r.key === key && r.scope === 'zip' && r.region === zip)
    || rows.find(r => r.key === key && r.scope === 'state' && r.region === state)
    || rows.find(r => r.key === key && r.scope === 'national');
}
function estimateLocation(input) {
  const zipCode = String(input?.zipCode || '').trim();
  const city = String(input?.city || '').trim();
  const state = String(input?.state || '').trim().toUpperCase();
  const states = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  if (!/^\d{5}(-\d{4})?$/.test(zipCode) || city.length < 2 || city.length > 100 || !states.includes(state)) {
    throw Object.assign(new Error('A US ZIP code, city and two-letter state are required.'), { status: 400 });
  }
  return { zipCode, city, state, country: 'US' };
}
module.exports = { parsePrices, findPrice, estimateLocation };
