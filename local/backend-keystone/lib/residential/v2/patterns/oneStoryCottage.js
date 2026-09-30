'use strict';

const { placeRoom } = require('../fitRoomsToRealms');

/* A small single-storey house without a garage: one bedroom, or two in under
 * about 1,200 sq ft. The public-spine and central-core families need three
 * 12 ft columns and 34 ft of depth, which a cottage does not have.
 *
 * Two columns, the garden at y = 0 and the street at y = height.
 *
 *   d (e: bedroom to the street)        f (kitchen across the garden)
 *   +----------------+ +-----------+    +----------------+-----------+
 *   | bedroom        | | kitchen   |    | kitchen        | dining    |
 *   +-----------+----+ +-----------+    +----------------+-----------+
 *   | bath      |hall| | dining    |    | bedroom        | living    |
 *   +------+----+----+ +-----------+    +-----------+----+           |
 *   |laundry| entry  | | living    |    | bath      |hall+-----+-----+
 *   +------+---------+ +-----------+    +-----------+----+ldry | entry
 *
 * A bathroom may only open to a hall, laundry or mudroom (placeOpenings), so
 * the bath band carries a short hall on the public side: the bedrooms and the
 * bath open onto it and it opens to the living spaces. An ensuite takes the
 * bath's place against the primary, and a second bathroom then opens off the
 * hall too. A second bedroom takes the street end of the private column, and
 * the entry and laundry move to the public column. Closets come out of the
 * bedrooms themselves (the closet pass).
 */
function oneStoryCottage({ brief, footprint, program }) {
  const width = Number(footprint.widthFt), height = Number(footprint.heightFt);
  const specs = [...program.levels.find(l => l.level === 1).rooms];
  const take = type => { const i = specs.findIndex(r => r.type === type); return i < 0 ? null : specs.splice(i, 1)[0]; };
  const primary = take('primary_bedroom'), ensuite = take('primary_bathroom');
  const kitchen = take('kitchen'), dining = take('dining_room'), living = take('living_room');
  const entry = take('entry'), laundry = take('laundry');
  const bedrooms = specs.filter(r => r.type === 'bedroom');
  const baths = specs.filter(r => r.type === 'bathroom');
  if (specs.some(r => !['bedroom', 'bathroom'].includes(r.type) && r.zone !== 'outdoor') || baths.some(r => r.attachedTo)) {
    throw new Error('Cottage has no position for feature rooms or secondary ensuites');
  }
  if (!primary || !kitchen || !dining || !living || !entry || !laundry) throw new Error('Cottage program is incomplete');
  if (bedrooms.length > 1 || baths.length > 1) throw new Error('Cottage holds one or two bedrooms and two bathrooms');
  if (brief.raw?.kitchenPlacement && !brief.kitchenRear) throw new Error('Cottage keeps the kitchen on the garden side');

  const profile = String(footprint.variationId || '');
  const variant = profile.includes('deep_garden') ? 'e' : profile.includes('central_hub') ? 'f' : 'd';
  const wide = Boolean(brief.accessibility?.wideDoors || brief.accessibility?.wheelchair);
  const hallW = wide ? 5 : 4;
  const privW = Math.min(16, Math.max(12, Math.floor(width * 0.45)));
  const pubW = width - privW;
  const second = bedrooms[0] || null;
  const bath = baths[0] || null;
  if (pubW < 12) throw new Error('Cottage needs a 12 ft public column');

  const rooms = [];
  const put = (spec, x, y, w, h, extras) => { if (spec) rooms.push(placeRoom(spec, { x, y, w, h }, extras)); };
  const open = { openConcept: Boolean(brief.openConcept) };
  const hall = { id: 'architect_v2_cottage_hall', type: 'hallway', level: 1, label: 'Hall' };
  // The bath band, `bandD` deep. With an ensuite and a shared bathroom both
  // sit in it: the ensuite against the primary (it opens only to its
  // bedroom), the shared one off the hall.
  const bandD = ensuite ? 9 : 8;
  // An ensuite and a guest bathroom (one bedroom, two bathrooms): the ensuite
  // takes the band, the guest bath the street end of the private column off
  // the hall, and the entry and laundry move to the public column.
  const guestBath = Boolean(ensuite && bath);
  if (guestBath && second) throw new Error('Cottage has no position for two bathrooms with two bedrooms');
  const band = (y) => {
    const bathsW = privW - hallW;
    if (guestBath) {
      if (bathsW < 8) throw new Error('Cottage ensuite needs eight feet');
      put(ensuite, 0, y, bathsW, bandD);
    } else {
      if (ensuite && bathsW < 8) throw new Error('Cottage ensuite needs eight feet');
      if (bathsW < 6) throw new Error('Cottage bath needs six feet');
      put(ensuite || bath, 0, y, bathsW, bandD);
    }
    put(hall, bathsW, y, hallW, bandD);
  };

  if (variant === 'f' && !second && !guestBath) {
    const kitchenD = 11, frontD = 7;
    const bedD = height - kitchenD - bandD;
    if (bedD < 11 || height - kitchenD - frontD < 10) throw new Error('Cottage needs an 11 ft bedroom and a 10 ft living room');
    put(kitchen, 0, 0, privW, kitchenD, open);
    put(dining, privW, 0, pubW, kitchenD, open);
    put(primary, 0, kitchenD, privW, bedD);
    band(kitchenD + bedD);
    put(living, privW, kitchenD, pubW, height - kitchenD - frontD, open);
    put(laundry, privW, height - frontD, 6, frontD);
    put(entry, privW + 6, height - frontD, pubW - 6, frontD);
    return { levels: [{ level: 1, width, height, rooms }] };
  }

  // Variant e: the bath band on the garden and the bedroom to the street.
  const streetBedroom = variant === 'e' && !second && !guestBath;
  const publicStreet = Boolean(second) || streetBedroom || guestBath;
  const frontD = publicStreet && !guestBath ? 0 : 7;
  const bedD = second ? Math.floor((height - bandD) / 2) : height - bandD - frontD;
  if (bedD < 11) throw new Error('Cottage bedrooms need eleven feet');
  // The street bedroom keeps at most 17 ft; the rest of the column's street
  // end is the laundry, and the public column's street band the entry alone.
  const streetBedD = Math.min(17, height - bandD);
  const streetLaundryD = height - bandD - streetBedD;
  if (streetBedroom && streetLaundryD > 0 && (streetLaundryD < 5 || streetLaundryD > 10)) throw new Error('Cottage street bedroom leaves no usable laundry');
  if (streetBedroom) {
    band(0);
    put(primary, 0, bandD, privW, streetBedD);
    if (streetLaundryD) put(laundry, 0, bandD + streetBedD, privW, streetLaundryD);
  } else {
    put(primary, 0, 0, privW, bedD);
    band(bedD);
    if (second) put(second, 0, bedD + bandD, privW, height - bedD - bandD);
    else if (guestBath) put(bath, 0, height - frontD, privW, frontD);
    else {
      // The laundry sits under the bath; the entry opens to the living room.
      const laundryW = Math.min(8, privW - 6);
      put(laundry, 0, height - frontD, laundryW, frontD);
      put(entry, laundryW, height - frontD, privW - laundryW, frontD);
    }
  }
  const kitchenD = 10, diningD = 10, streetD = publicStreet ? 7 : 0;
  const livingD = height - kitchenD - diningD - streetD;
  if (livingD < 10) throw new Error('Cottage living room needs ten feet');
  put(kitchen, privW, 0, pubW, kitchenD, open);
  put(dining, privW, kitchenD, pubW, diningD, open);
  put(living, privW, kitchenD + diningD, pubW, livingD, open);
  if (publicStreet) {
    const laundryHere = !(streetBedroom && streetLaundryD);
    put(laundryHere ? laundry : null, privW, height - streetD, 6, streetD);
    put(entry, privW + (laundryHere ? 6 : 0), height - streetD, pubW - (laundryHere ? 6 : 0), streetD);
  }
  return { levels: [{ level: 1, width, height, rooms }] };
}

module.exports = { oneStoryCottage };
