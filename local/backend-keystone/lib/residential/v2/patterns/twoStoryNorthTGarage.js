'use strict';

const { placeRoom } = require('../fitRoomsToRealms');
const { subtract } = require('../../../geometry/rectBoolean');

// A T consists of a narrow rear stem and a full-width crossbar. Allocate
// whole rooms in those two regions before fitting openings, never cut rooms
// or stairs out of a rectangular house to manufacture the selected shape.
function twoStoryNorthTGarage({ brief, footprint, program }) {
  const cuts = footprint.envelopeVoidRects || [];
  const features = brief.requestedFeatureItems || [];
  if (footprint.envelopeShape !== 'T_SHAPE' || cuts.length !== 2 || cuts.some(r => r.y !== 0) ||
      brief.garageType !== 'ONE_CAR' || brief.bedrooms !== 3 || brief.bathrooms !== 3 ||
      brief.primaryEnsuiteRequested === false || (brief.privateBathCount ?? 1) !== 1 ||
      (features.length && !(features.length === 1 && features[0].canonicalType === 'study'))) return null;
  const [left, right] = [...cuts].sort((a, b) => a.x - b.x);
  const width = footprint.widthFt, height = footprint.heightFt;
  const rearDepth = left.h, stemX = left.w, stemWidth = right.x - stemX;
  if (right.h !== rearDepth || stemWidth < 12 || rearDepth < 8 || height - rearDepth < 24) return null;
  const garageWidth = 14;
  const hallX = garageWidth, hallWidth = Math.max(8, stemX + 4 - hallX - 6);
  const stairX = hallX + hallWidth, stairWidth = 6, publicX = stairX + stairWidth;
  const publicWidth = width - publicX, stairY = rearDepth + 10;
  if (publicWidth < 24 || height - stairY < 14) return null;
  const levels = [];
  for (const level of [1, 2]) {
    const specs = [...program.levels.find(l => l.level === level).rooms];
    const take = type => { const i = specs.findIndex(r => r.type === type); return i < 0 ? null : specs.splice(i, 1)[0]; };
    const rooms = [];
    const put = (room, x, y, w, h, zone = 'body') => {
      if (!room) throw new Error('T-shaped program is missing a required room');
      rooms.push(placeRoom(room, { x, y, w, h }, level === 2 ? {
        zonePlacementSource: 'upper_zone_native', zonePlacement: zone, zoneGeometryMode: 'zone_native',
      } : {}));
    };
    const stairs = take('stairs'), hall = take('hallway');
    put(stairs, stairX, stairY, stairWidth, height - stairY);
    if (level === 1) {
      put(take('garage'), 0, rearDepth, garageWidth, height - rearDepth);
      put(take('kitchen'), stemX, 0, stemWidth, rearDepth, 'wing');
      put(take('dining_room'), hallX, rearDepth, hallWidth + stairWidth, 10);
      put(take('living_room'), publicX, rearDepth, publicWidth, height - rearDepth - 8);
      put(hall, hallX, stairY, hallWidth, height - stairY - 4);
      put(take('entry'), hallX, height - 4, hallWidth, 4);
      put(take('bathroom'), publicX, height - 8, 8, 8);
      put(take('mudroom'), publicX + 8, height - 8, 8, 8);
      put(take('laundry'), publicX + 16, height - 8, publicWidth - 16, 8);
    } else {
      const study = take('study');
      const bedroomDepth = (height - rearDepth) / 2;
      put(take('bedroom'), 0, rearDepth, garageWidth, bedroomDepth);
      put(take('bedroom'), 0, rearDepth + bedroomDepth, garageWidth, bedroomDepth);
      put(hall, hallX, rearDepth, hallWidth + stairWidth, 10);
      put({ id: 't_bedroom_hall', type: 'hallway', level, label: 'Bedroom hall' }, hallX, stairY, hallWidth, height - stairY);
      put(take('bathroom'), study ? stemX + stemWidth - 12 : stemX, 0, 12, rearDepth, 'wing');
      if (study) put(study, stemX, 0, stemWidth - 12, rearDepth, 'wing');
      else if (stemWidth > 12) put({ id: 't_rear_storage', type: 'storage', level, zone: 'service', label: 'Storage' }, stemX + 12, 0, stemWidth - 12, rearDepth, 'wing');
      put(take('primary_bedroom'), publicX, rearDepth, publicWidth - 8, height - rearDepth);
      put(take('primary_bathroom'), width - 8, rearDepth, 8, 10);
      put({ id: 't_primary_storage', type: 'storage', level, zone: 'service', label: 'Suite storage' }, width - 8, rearDepth + 10, 8, height - rearDepth - 10);
      if (study) {
        // Both rear-stem rooms need doors from the landing. Reserve a short
        // branch beneath the shared bath, and give the excess width of the
        // bedroom corridor to the bedrooms, keeping a four-foot route.
        const branch = { x: publicX, y: rearDepth, w: stemX + stemWidth - publicX, h: 4 };
        const landing = rooms.find(r => r.id === hall.id);
        const primary = rooms.find(r => r.type === 'primary_bedroom');
        if (branch.w > 0) {
          landing.parts = [{ x: landing.x, y: landing.y, w: landing.w, h: landing.h }, branch];
          landing.w += branch.w;
          primary.parts = subtract([primary], [branch]);
        }
        const bedroomHall = rooms.find(r => r.id === 't_bedroom_hall');
        const transferWidth = hallWidth - 4;
        for (const room of rooms.filter(r => r.type === 'bedroom')) {
          const extensionY = Math.max(stairY, room.y);
          const extensionHeight = room.y + room.h - extensionY;
          if (extensionHeight > 0) {
            room.parts = [{ x: room.x, y: room.y, w: room.w, h: room.h },
              { x: hallX, y: extensionY, w: transferWidth, h: extensionHeight }];
            room.w += transferWidth;
          }
        }
        bedroomHall.x += transferWidth;
        bedroomHall.w = 4;
      }
    }
    if (specs.length) throw new Error(`T-shaped program has unplaced rooms: ${specs.map(r => r.type).join(', ')}`);
    levels.push({ level, width, height, rooms, stairCore: {
      x: stairX, y: stairY, w: stairWidth, h: height - stairY,
      roomId: stairs.id, hallRoomId: hall.id, landingRoomId: hall.id, landingOpen: true,
    } });
  }
  return { levels };
}

module.exports = { twoStoryNorthTGarage };
