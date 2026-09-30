'use strict';
const fs = require('node:fs');
const path = require('node:path');
const csv = fs.readFileSync(path.join(__dirname, 'data/product-price-observations.csv'), 'utf8').trim().split(/\r?\n/);
const keys = csv.shift().split(',');
const observations = csv.map(line => {
  const cells = line.split(',');
  if (cells.length !== keys.length) throw new Error('Invalid product price observation CSV');
  const row = Object.fromEntries(keys.map((key, index) => [key, cells[index]]));
  row.price = Number(row.price);
  if (!Number.isFinite(row.price) || row.price <= 0 || !/^https:\/\//.test(row.sourceUrl)) throw new Error('Invalid product price observation');
  return row;
});

function flooringObservation(material, location, today = new Date()) {
  return observations.find(row => row.material === material && row.unit === 'sqft'
    && row.status === 'published_retail_observation' && row.scope === 'zip'
    && row.region === String(location?.zipCode || '').slice(0, 5)
    && today.getTime() >= Date.parse(row.observed)
    && today.getTime() - Date.parse(row.observed) <= 30 * 86400000) || null;
}
module.exports = { observations, flooringObservation };
