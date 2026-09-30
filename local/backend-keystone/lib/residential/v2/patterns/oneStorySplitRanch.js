'use strict';

const { placeRoom } = require('../fitRoomsToRealms');

/* A single-storey split-bedroom ranch with an attached garage: the most asked-
 * for house in the Studio (two to four bedrooms, a garage, 1,500-2,600 sq ft).
 *
 * Three columns, the garden at y = 0 and the street at y = height:
 *
 *   garage column    public core             bedroom wing
 *   +------+------+ +---------+---------+ +---+----------+
 *   | ens. |      | | kitchen | dining  | |   | bedroom 2|
 *   +------+ prim.| +---------+---------+ | h +----------+
 *   | WIC  |      | |   great room      | | a | bath     |
 *   +------+------+ |                   | | l +----------+
 *   |    garage   | +------+-----+------+ | l | bedroom 3|
 *   |             | | mud  | lndy| entry| |   |          |
 *   +-------------+ +------+-----+------+ +---+----------+
 *
 * The primary suite sits behind the garage, away from the other bedrooms,
 * and opens off the public core; its walk-in closet slot is a storage room
 * the closet pass turns into the requested closet. The garage opens into a
 * mudroom at the front of the core, beside the entry. Variants move the
 * primary suite's bath to the garden or the garage side, put dining or the
 * kitchen at the corner, and flip the bedroom wing, so options differ in
 * adjacency rather than only in size.
 */
function oneStorySplitRanch({ brief, footprint, program }) {
  const width = Number(footprint.widthFt), height = Number(footprint.heightFt);
  const specs = [...program.levels.find(l => l.level === 1).rooms];
  const take = type => { const i = specs.findIndex(r => r.type === type); return i < 0 ? null : specs.splice(i, 1)[0]; };
  const garage = take('garage'), entry = take('entry'), laundry = take('laundry'), mudroom = take('mudroom');
  const primary = take('primary_bedroom'), ensuite = take('primary_bathroom');
  const kitchen = take('kitchen'), dining = take('dining_room'), living = take('living_room');
  const bedrooms = specs.filter(r => r.type === 'bedroom');
  const baths = specs.filter(r => r.type === 'bathroom');
  const privateBaths = baths.filter(r => r.attachedTo);
  const sharedBaths = baths.filter(r => !r.attachedTo);
  if (specs.some(r => !['bedroom', 'bathroom'].includes(r.type) && r.zone !== 'outdoor') || privateBaths.length) {
    throw new Error('Split ranch has no position for feature rooms or secondary ensuites');
  }
  if (!garage || !primary || !kitchen || !dining || !living || !entry || !laundry) throw new Error('Split ranch program is incomplete');
  if (bedrooms.length < 1 || bedrooms.length > 3) throw new Error('Split ranch holds two to four bedrooms');
  // The kitchen is on the garden; a street-side kitchen is the compact
  // garage core's arrangement.
  if (brief.raw?.kitchenPlacement && !brief.kitchenRear) throw new Error('Split ranch keeps the kitchen on the garden side');

  const profile = String(footprint.variationId || '');
  const variant = profile.includes('deep_garden') ? 'e' : profile.includes('central_hub') ? 'f' : 'd';
  const twoCar = brief.garageType === 'TWO_CAR';
  const wide = Boolean(brief.accessibility?.wideDoors || brief.accessibility?.wheelchair);
  const hallW = wide ? 5 : 4;

  // Garage column: the primary suite behind the garage.
  const garageW = twoCar ? 20 : 13;
  const garageD = height >= 42 ? 22 : 20;
  // A deep house would stretch the suite; past 24 ft the mudroom and laundry
  // take a band behind the garage and the suite keeps 17 ft.
  const serviceBand = height - garageD >= 24;
  const suiteD = serviceBand ? 17 : height - garageD;
  const serviceD = height - garageD - suiteD;
  const suiteSideW = 8;
  const bedW = 12;
  const colA = Math.max(garageW, bedW + suiteSideW);
  // Bedroom wing: a hall along the core, bedrooms on the exterior side.
  // A wide core would make a very large great room beside small bedrooms:
  // past 24 ft, up to 3 ft of it goes to the bedroom wing.
  const wingBedW = 11 + Math.max(0, Math.min(3, Math.floor((width - colA - hallW - 11 - 24) / 2)));
  const colC = hallW + wingBedW;
  const colB = width - colA - colC;
  // A wide core puts kitchen and dining side by side along the garden; a
  // narrow one stacks kitchen, dining and great room front to back.
  const sideBySide = colB >= 22;
  const kitchenD = 12, diningD = sideBySide ? 0 : 10, frontD = serviceBand ? 6 : 8;
  const greatD = height - kitchenD - diningD - frontD;
  if (suiteD < 14 || colB < 16 || greatD < 11) throw new Error('Split ranch needs a 14 ft suite, a 16 ft core and an 11 ft great room');

  const rooms = [];
  const put = (spec, x, y, w, h, extras) => { if (spec) rooms.push(placeRoom(spec, { x, y, w, h }, extras)); };
  const open = { openConcept: Boolean(brief.openConcept) };

  // Primary suite. Variant e puts the bath on the garden side of the side
  // strip; the others keep the closet to the garden and the bath by the garage.
  const bedX = colA - bedW;
  put(primary, bedX, 0, bedW, suiteD);
  const ensD = ensuite ? 9 : 0;
  const closetD = suiteD - ensD;
  const bathFirst = variant === 'e';
  const closet = { id: 'architect_v2_primary_closet_slot', type: 'storage', level: 1, label: 'Closet', zone: 'private' };
  const sideW = colA - bedW;
  if (ensuite) put(ensuite, 0, bathFirst ? 0 : closetD, sideW, ensD);
  put(closet, 0, bathFirst ? ensD : 0, sideW, closetD);
  // The garage by the core; a one-car garage leaves a storage bay outside it.
  const bayW = twoCar ? colA : garageW;
  put(garage, colA - bayW, height - garageD, bayW, garageD);
  if (!twoCar && colA > garageW) {
    put({ id: 'architect_v2_garage_store', type: 'storage', level: 1, label: 'Garage storage', zone: 'service' },
      0, height - garageD, colA - garageW, garageD);
  }
  if (serviceBand) {
    // Laundry on the exterior side, the mudroom between the garage and the core.
    const mudW = mudroom ? 7 : 0;
    put(laundry, 0, suiteD, colA - mudW, serviceD);
    put(mudroom, colA - mudW, suiteD, mudW, serviceD);
  }

  // Public core. Kitchen and dining along the garden; variant f puts dining
  // in the corner by the suite and the kitchen by the bedroom wing.
  const bX = colA;
  if (sideBySide) {
    const kitchenW = Math.max(12, Math.min(14, Math.floor(colB / 2)));
    const kitchenLeft = variant !== 'f';
    put(kitchen, kitchenLeft ? bX : bX + colB - kitchenW, 0, kitchenW, kitchenD, open);
    put(dining, kitchenLeft ? bX + kitchenW : bX, 0, colB - kitchenW, kitchenD, open);
  } else {
    // Stacked: the kitchen keeps the garden wall (light, venting, and the
    // survey's rear-kitchen choice); dining links it to the great room.
    put(kitchen, bX, 0, colB, kitchenD, open);
    put(dining, bX, kitchenD, colB, diningD, open);
  }
  put(living, bX, kitchenD + diningD, colB, greatD, open);
  // Front band: the garage opens into the mudroom; laundry beside it; the
  // entry on the street, into the great room. (In a deep house the service
  // rooms are behind the garage and the entry has the band to itself.)
  if (serviceBand) {
    put(entry, bX, height - frontD, colB, frontD);
  } else {
    const mudW = mudroom ? 6 : 0;
    const laundryW = 7;
    const entryW = colB - mudW - laundryW;
    if (entryW < 6) throw new Error('Split ranch entry needs six feet of frontage');
    put(mudroom, bX, height - frontD, mudW, frontD);
    put(laundry, bX + mudW, height - frontD, laundryW, frontD);
    put(entry, bX + mudW + laundryW, height - frontD, entryW, frontD);
  }

  // Bedroom wing. Bedrooms share the depth; one shared bath per slot between
  // them. The hall runs beside the core from the dining band to the front.
  const cX = colA + colB;
  const wingItems = [];
  const order = variant === 'e' ? [...bedrooms].reverse() : bedrooms;
  const bathSlots = [...sharedBaths];
  order.forEach((bedroom, i) => {
    wingItems.push({ room: bedroom, depth: null });
    if (i < order.length - 1 && bathSlots.length) wingItems.push({ room: bathSlots.shift(), depth: 8 });
  });
  if (bathSlots.length) wingItems.push(...bathSlots.map(room => ({ room, depth: 8 })));
  const fixedD = wingItems.reduce((sum, item) => sum + (item.depth || 0), 0);
  // Whole feet; the last bedroom takes the remainder.
  const bedroomD = Math.floor((height - fixedD) / order.length);
  if (bedroomD < 11) throw new Error('Split ranch bedrooms need eleven feet of depth');
  const flipWing = variant === 'f';
  const items = flipWing ? [...wingItems].reverse() : wingItems;
  const lastBedroom = items.map(item => !item.depth).lastIndexOf(true);
  let y = 0;
  items.forEach((item, i) => {
    const d = item.depth || (i === lastBedroom ? height - y - items.slice(i + 1).reduce((sum, x) => sum + (x.depth || bedroomD), 0) : bedroomD);
    put(item.room, cX + hallW, y, wingBedW, d);
    y += d;
  });
  put({ id: 'architect_v2_bedroom_hall', type: 'hallway', level: 1, label: 'Bedroom hall' }, cX, 0, hallW, height);
  return { levels: [{ level: 1, width, height, rooms }] };
}

module.exports = { oneStorySplitRanch };
