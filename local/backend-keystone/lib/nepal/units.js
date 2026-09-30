'use strict';
// 1 ropani = 5476 ft² = 16 aana; Nepal government construction handbook,
// conversion table (source recorded in MILESTONE-B-EXECUTION.md).
const FT_MM = 304.8;
const AREA_SQFT = Object.freeze({ sq_ft: 1, sq_m: 1 / 0.09290304,
  ropani: 5476, aana: 342.25, paisa: 342.25 / 4, daam: 342.25 / 16 });
const LENGTH_MM = Object.freeze({ mm: 1, cm: 10, m: 1000, ft: FT_MM });
function measured(value, units, table, label) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n) || n <= 0 || !Object.hasOwn(table, units))
    throw new RangeError(`${label} needs a positive number and a supported unit (${Object.keys(table).join(', ')}).`);
  const converted = n * table[units];
  if (!Number.isFinite(converted)) throw new RangeError(`${label} is outside the measurable range.`);
  return converted;
}
function lengthMm(input, label = 'Length') { return measured(input?.value, input?.unit, LENGTH_MM, label); }
function areaSqM(input, label = 'Area') { return measured(input?.value, input?.unit, AREA_SQFT, label) * 0.09290304; }
module.exports = { FT_MM, LENGTH_MM, AREA_SQFT, lengthMm, areaSqM };
