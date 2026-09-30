'use strict';

const { buildFloorPassageModel } = require('./floorPassageModel');
const { checkLevelClearRoute } = require('./clearRoute');
const { containsRect, intersection } = require('./rectBoolean');
const rectValid = r => r && ['x','y','w','h'].every(k => Number.isFinite(r[k])) && r.w > 0 && r.h > 0;

// Local hallway doorway -> bed SIDE approach. All dimensions are explicit
// geometric requests, not inferred accessibility/code requirements. The square
// must sit wholly alongside the bed, not diagonally at its head/foot corner.
function bedSideTargets(bed, width) {
  const r = width / 2;
  if (bed.rotation === 90 || bed.rotation === 270) {
    if (bed.w < width) return [];
    return [
      { id: 'north', x: bed.x+r, y: bed.y-r, w: bed.w-width, h: 0 },
      { id: 'south', x: bed.x+r, y: bed.y+bed.h+r, w: bed.w-width, h: 0 },
    ];
  }
  if (bed.h < width) return [];
  return [
    { id: 'west', x: bed.x-r, y: bed.y+r, w: 0, h: bed.h-width },
    { id: 'east', x: bed.x+bed.w+r, y: bed.y+r, w: 0, h: bed.h-width },
  ];
}

function doorwaySources(opening, door, fromParts, width) {
  const c = opening.clear, r = width/2;
  // A shallow strip identifies which finished face belongs to this host. Room
  // bounding-box centres are unreliable for L-shaped/composite circulation.
  const probe = 1e-4;
  const candidates = door.dir === 'vertical' ? [
    { strip: { x: c.x-probe, y: c.y, w: probe, h: c.h }, region: { id: 'west_approach', x: c.x-r, y: c.y+r, w: 0, h: c.h-width } },
    { strip: { x: c.x+c.w, y: c.y, w: probe, h: c.h }, region: { id: 'east_approach', x: c.x+c.w+r, y: c.y+r, w: 0, h: c.h-width } },
  ] : [
    { strip: { x: c.x, y: c.y-probe, w: c.w, h: probe }, region: { id: 'north_approach', x: c.x+r, y: c.y-r, w: c.w-width, h: 0 } },
    { strip: { x: c.x, y: c.y+c.h, w: c.w, h: probe }, region: { id: 'south_approach', x: c.x+r, y: c.y+c.h+r, w: c.w-width, h: 0 } },
  ];
  return candidates.filter(c => fromParts.some(p => intersection(p,c.strip))).map(c => c.region);
}

function checkBedroomApproach(level, { entryOpeningId, fromRoomId, bedId, clearWidthFt, sidePolicy = 'either', maxNodes = 40000 } = {}) {
  const base = { status: 'not_checked', scope: 'local_hallway_doorway_to_bed_side',
    entryOpeningId, fromRoomId, bedId, clearWidthFt, sidePolicy, sides: [],
    constructionVerified: false, doorSwingChecked: false, furnitureChecked: true,
    basis: 'Assumed finished wall faces and explicitly scheduled aperture; axis-aligned square approach.' };
  const unknown = reason => ({ ...base, reason });
  if (!level || !Array.isArray(level.rooms) || !Array.isArray(level.doors) || !Array.isArray(level.furniture) ||
      typeof entryOpeningId !== 'string' || typeof fromRoomId !== 'string' || typeof bedId !== 'string' ||
      !Number.isFinite(clearWidthFt) || clearWidthFt <= 0 || !Number.isInteger(maxNodes) || maxNodes < 1 ||
      !['either','both'].includes(sidePolicy)) return unknown('Explicit valid floor, opening, bed, width and side policy are required.');
  if (level.rooms.some(r => !r || typeof r.id !== 'string') || level.doors.some(d => !d)) return unknown('Room or opening records are malformed.');
  const from = level.rooms.filter(r => r.id === fromRoomId), beds = level.furniture.filter(f => f?.id === bedId);
  const doors = level.doors.filter(d => d.id === entryOpeningId);
  if (from.length !== 1 || from[0].type !== 'hallway' || beds.length !== 1 || doors.length !== 1) {
    return unknown('Unique hallway, bed and entry opening identities are required.');
  }
  const bed = beds[0], door = doors[0], bedrooms = level.rooms.filter(r => r.id === bed.roomId);
  if (bedrooms.length !== 1 || !['bedroom','primary_bedroom','guest_bedroom'].includes(bedrooms[0].type) ||
      !String(bed.kind).startsWith('bed_') || !rectValid(bed) || ![0,90,180,270].includes(bed.rotation)) {
    return unknown('The bed needs valid physical bounds, a bedroom owner and explicit orthogonal rotation.');
  }
  if (!((door.a === fromRoomId && door.b === bed.roomId) || (door.b === fromRoomId && door.a === bed.roomId))) {
    return unknown('The chosen doorway must connect the hallway directly to this bedroom.');
  }
  let model;
  try { model = buildFloorPassageModel(level); }
  catch (error) { return unknown(`Physical floor geometry is malformed: ${error.message}`); }
  if (model.errors.length) return { ...unknown('Physical opening model is invalid.'), errors: model.errors };
  const opening = model.openings.find(o => o.openingId === entryOpeningId);
  if (opening?.status !== 'scheduled_geometry') return unknown('The entry doorway requires a physical schedule.');
  const bedroomParts = model.roomClear.find(r => r.roomId === bed.roomId)?.parts || [];
  if (!containsRect(bedroomParts, bed)) return unknown('The bed lies outside its finished clear room; repair physical furniture placement first.');
  if (level.furniture.some(item => !rectValid(item) || !level.rooms.some(r => r.id === item.roomId))) return unknown('Furniture bounds or room ownership are invalid.');
  if (level.furniture.some(item => item !== bed && intersection(item, bed))) return unknown('Furniture overlaps the bed; repair physical furniture placement first.');
  if (opening.clearWidthFt < clearWidthFt) return { ...base, status: 'blocked', reason: 'Scheduled clear doorway is narrower than the requested approach footprint.' };
  const fromParts = model.roomClear.find(r => r.roomId === fromRoomId)?.parts || [];
  const fromRegions = doorwaySources(opening, door, fromParts, clearWidthFt);
  if (fromRegions.length !== 1) return unknown('A unique finished hallway face of the doorway could not be resolved.');
  const targets = bedSideTargets(bed, clearWidthFt);
  if (!targets.length) return { ...base, status: 'blocked', reason: 'The bed side is shorter than the requested full alongside footprint.' };
  const sides = targets.map(target => ({ side: target.id, targetRegion: target,
    ...checkLevelClearRoute(level, { allowedRoomIds: [fromRoomId, bed.roomId],
      fromRegions, targetRegions: [target], fromFloorParts: fromParts,
      targetFloorParts: bedroomParts, clearWidthFt, maxNodes }) }));
  const clear = sides.filter(s => s.status === 'clear'), unchecked = sides.some(s => s.status === 'not_checked');
  const status = sidePolicy === 'either'
    ? clear.length ? 'clear' : unchecked ? 'not_checked' : 'blocked'
    : clear.length === 2 ? 'clear' : sides.some(s => s.status === 'blocked') ? 'blocked' : 'not_checked';
  return { ...base, status, fromRegions, sides, bedroomId: bed.roomId, allowedRoomIds: [fromRoomId, bed.roomId],
    accessibleSides: clear.map(s => s.side),
    reason: status === 'clear' ? 'Requested bed-side approach found through the scheduled entry doorway.' :
      status === 'blocked' ? 'No route satisfies the requested bed-side policy under the supplied geometry.' :
        'At least one required bed-side route remains unverified.' };
}

module.exports = { checkBedroomApproach };
