'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sizeBand(totalAreaSqFt) {
  const area = num(totalAreaSqFt, 1800);
  if (area < 1500) return 'compact';
  if (area < 2000) return 'mid';
  return 'large';
}

function templateFrom(type, band, extras = {}) {
  const compact = {
    garage: { w: 12, h: 20 },
    entry: { w: 10, h: 8 },
    stairs: { w: 6, h: 12 },
    hallway: { w: 6, h: 6 },
    kitchen: { w: 12, h: 10 },
    dining_room: { w: 12, h: 10 },
    living_room: { w: 12, h: 20 },
    primary_bedroom: { w: 14, h: 16 },
    bedroom: { w: 12, h: 12 },
    guest_bedroom: { w: 12, h: 12 },
    primary_bathroom: { w: 10, h: 10 },
    bathroom: { w: 8, h: 8 },
    laundry: { w: 6, h: 8 },
    mudroom: { w: 6, h: 8 },
    storage: { w: 6, h: 8 },
  };

  const mid = {
    ...compact,
    kitchen: { w: 12, h: 12 },
    living_room: { w: 14, h: 20 },
    primary_bedroom: { w: 14, h: 18 },
    bedroom: { w: 12, h: 14 },
    primary_bathroom: { w: 10, h: 10 },
  };

  const large = {
    ...mid,
    garage: { w: 14, h: 20 },
    entry: { w: 12, h: 8 },
    kitchen: { w: 14, h: 12 },
    dining_room: { w: 12, h: 12 },
    living_room: { w: 16, h: 20 },
    primary_bedroom: { w: 16, h: 18 },
    bedroom: { w: 12, h: 14 },
    primary_bathroom: { w: 12, h: 10 },
  };

  const library = band === 'large' ? large : band === 'mid' ? mid : compact;
  return {
    ...library[type],
    ...extras,
  };
}

function getRoomTemplate(type, context = {}) {
  const band = sizeBand(context?.brief?.totalAreaSqFt || context?.totalAreaSqFt);
  return templateFrom(String(type || '').trim(), band, context?.overrides || {});
}

module.exports = {
  getRoomTemplate,
  sizeBand,
};
