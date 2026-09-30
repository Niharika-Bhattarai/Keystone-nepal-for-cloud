'use strict';

const STATE_MULTIPLIERS = {
  AL: 0.9, AK: 1.25, AZ: 0.97, AR: 0.88, CA: 1.28, CO: 1.08, CT: 1.22, DE: 1.08,
  FL: 1.02, GA: 0.95, HI: 1.6, IA: 0.9, ID: 0.96, IL: 1.0, IN: 0.9, KS: 0.9, KY: 0.9,
  LA: 0.92, MA: 1.24, MD: 1.12, ME: 1.12, MI: 0.94, MN: 0.96, MO: 0.92, MS: 0.88,
  MT: 0.95, NC: 0.96, ND: 0.92, NE: 0.9, NH: 1.15, NJ: 1.2, NM: 0.93, NV: 1.02,
  NY: 1.22, OH: 0.93, OK: 0.89, OR: 1.12, PA: 1.08, RI: 1.18, SC: 0.93, SD: 0.9,
  TN: 0.92, TX: 0.95, UT: 0.99, VA: 1.05, VT: 1.1, WA: 1.15, WI: 0.95, WV: 0.9,
  WY: 0.92, DC: 1.25,
};

const STATE_NAME_TO_CODE = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
};

function clampMultiplier(value) {
  if (!Number.isFinite(value)) return 1.0;
  if (value < 0.85) return 0.85;
  if (value > 1.6) return 1.6;
  return Number(value.toFixed(2));
}

function zipMultiplier(location) {
  const zip = String(location || '').match(/\b(\d{5})(?:-\d{4})?\b/)?.[1];
  if (!zip) return null;
  const prefix = Number(zip.slice(0, 3));

  if ((prefix >= 941 && prefix <= 949) || (prefix >= 100 && prefix <= 104)) return 1.5;
  if (prefix >= 900 && prefix <= 935) return 1.32;
  if (prefix >= 980 && prefix <= 986) return 1.18;
  if (prefix >= 200 && prefix <= 208) return 1.2;
  if (prefix >= 330 && prefix <= 349) return 1.02;
  if (prefix >= 730 && prefix <= 749) return 0.9;
  return null;
}

function keywordOverride(location) {
  const s = String(location || '').toLowerCase();
  if (!s) return null;
  if (s.includes('manhattan') || s.includes('new york city') || s.includes('nyc')) return 1.5;
  if (s.includes('san francisco') || s.includes('bay area')) return 1.5;
  if (s.includes('honolulu')) return 1.6;
  return null;
}

function resolveStateCode(location) {
  const input = String(location || '');
  if (!input.trim()) return null;

  const byName = Object.entries(STATE_NAME_TO_CODE).find(([name]) =>
    input.toLowerCase().includes(name)
  );
  if (byName) return byName[1];

  const maybeStateAbbrev = input.match(/\b([A-Z]{2})\b/g);
  if (Array.isArray(maybeStateAbbrev)) {
    for (const token of maybeStateAbbrev) {
      if (STATE_MULTIPLIERS[token]) return token;
    }
  }
  return null;
}

function getRegionalMultiplier(location) {
  if (!location || !String(location).trim()) return 1.0;

  const keyword = keywordOverride(location);
  if (keyword) return clampMultiplier(keyword);

  const fromZip = zipMultiplier(location);
  if (fromZip) return clampMultiplier(fromZip);

  const stateCode = resolveStateCode(location);
  if (stateCode && Number.isFinite(STATE_MULTIPLIERS[stateCode])) {
    return clampMultiplier(STATE_MULTIPLIERS[stateCode]);
  }
  return 1.0;
}

module.exports = {
  getRegionalMultiplier,
};
