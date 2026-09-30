'use strict';

const { placeRoom } = require('../fitRoomsToRealms');

// Three continuous columns: a connected public spine and two sleeping/service
// wings. Every shared room reaches the public spine without crossing a bedroom.
// Consume the room program instead of silently dropping the second shared bath.
function oneStoryPublicSpine({ brief, footprint, program }) {
  const width = Number(footprint.widthFt), height = Number(footprint.heightFt);
  const specs = [...program.levels.find(l => l.level === 1).rooms];
  const take = type => { const index = specs.findIndex(r => r.type === type); return index < 0 ? null : specs.splice(index, 1)[0]; };
  const primary = take('primary_bedroom'), ensuite = take('primary_bathroom') || take('bathroom');
  const kitchen = take('kitchen'), dining = take('dining_room'), living = take('living_room');
  const entry = take('entry'), laundry = take('laundry');
  const bedrooms = specs.filter(r => r.type === 'bedroom');
  // In a compact four-bedroom house, put one secondary bedroom beside the
  // primary/service stack. This avoids an oversized primary and a cramped
  // three-bedroom stack while keeping every bedroom on an exterior wall.
  const primaryWingBedrooms = bedrooms.splice(Math.max(2, bedrooms.length - Math.max(0, Number(brief.bedrooms) - 3)));
  const baths = specs.filter(r => r.type === 'bathroom');
  const extras = specs.filter(r => !['bedroom','bathroom'].includes(r.type) && !r.outdoor && r.zone !== 'outdoor');
  if (extras.length || baths.some(r => r.attachedTo)) throw new Error('Public spine needs a dedicated feature/private-bath wing');
  const wing = Math.min(16, Math.max(12, Math.floor((width - 14) / 2)));
  const core = width - wing * 2;
  const diningDepth = Number(brief.totalAreaSqFt) >= 2800 ? 12 : 10;
  const compact = Number(brief.totalAreaSqFt) <= 1400;
  const kitchenDepth = compact ? 10 : 12;
  const entryDepth = compact ? 4 : 6;
  const livingDepth = height - kitchenDepth - diningDepth - entryDepth;
  if (core < 12 || livingDepth < 10 || core * livingDepth < 120) throw new Error('Public spine needs more living/dining depth');
  const bedroomDepth = (height - baths.length * 6) / Math.max(1, bedrooms.length);
  const primaryDepth = height - 14 - primaryWingBedrooms.length * 12;
  if (bedroomDepth < 10 || primaryDepth < 12) throw new Error('Sleeping wing needs more depth');
  const profile = String(footprint.variationId || '');
  const garden = profile.includes('deep_garden'), hub = profile.includes('central_hub');
  const rooms = [];
  const put = (spec, x, y, w, h) => { if (spec) rooms.push(placeRoom(spec, { x, y, w, h }, { openConcept: Boolean(brief.openConcept) })); };
  const stack = (items, x, w) => {
    let y = 0;
    items.forEach(([spec, h], index) => { const depth = index === items.length - 1 ? height - y : h; put(spec, x, y, w, depth); y += depth; });
  };
  // A two-bedroom secondary wing has only one bedroom, so reordering that
  // wing cannot distinguish the hub profile. Move its complete primary
  // suite to the other end of the same wing, preserving private bath access.
  const primaryItems = garden || (hub && Number(brief.bedrooms) === 2)
    ? [...primaryWingBedrooms.map(r=>[r,12]), [laundry, 6], [ensuite, 8], [primary, primaryDepth]]
    : [[primary, primaryDepth], [ensuite, 8], [laundry, 6], ...primaryWingBedrooms.map(r=>[r,12])];
  const secondaryItems = [];
  if (hub && Number(brief.bedrooms) === 2) {
    baths.forEach(r => secondaryItems.push([r, 6]));
    bedrooms.forEach(r => secondaryItems.push([r, Math.floor(bedroomDepth)]));
  } else if (hub) {
    bedrooms.forEach(r => secondaryItems.push([r, Math.floor(bedroomDepth)]));
    baths.forEach(r => secondaryItems.push([r, 6]));
  } else {
    secondaryItems.push([bedrooms[0], Math.floor(bedroomDepth)]);
    baths.forEach(r => secondaryItems.push([r, 6]));
    bedrooms.slice(1).forEach(r => secondaryItems.push([r, Math.floor(bedroomDepth)]));
  }
  stack(primaryItems, garden ? wing + core : 0, wing);
  stack(secondaryItems, garden ? 0 : wing + core, wing);
  // Shared baths use a short vestibule, never another bathroom as passage.
  const placedBaths = rooms.filter(r => baths.some(spec => spec.id === r.id));
  if (placedBaths.length) {
    const start = Math.min(...placedBaths.map(r => r.y));
    const end = Math.max(...placedBaths.map(r => r.y + r.h));
    const hallX = garden ? wing - 4 : wing + core;
    for (const bath of placedBaths) { if (!garden) bath.x += 4; bath.w -= 4; }
    rooms.push(placeRoom({ id: 'architect_v2_bath_vestibule', type: 'hallway', level: 1, label: 'Bath vestibule' },
      { x: hallX, y: start, w: 4, h: end - start }));
  }
  put(kitchen, wing, 0, core, kitchenDepth);
  put(dining, wing, kitchenDepth, core, diningDepth);
  put(living, wing, kitchenDepth + diningDepth, core, livingDepth);
  put(entry, wing, height - entryDepth, core, entryDepth);
  return { levels: [{ level: 1, width, height, rooms }] };
}
module.exports = { oneStoryPublicSpine };
