'use strict';

const { partListOf, boundingRectOf, roomArea, shareWall } = require('./planGeometry');
const { subtract, containsRect } = require('./geometry/rectBoolean');
const { validateOpeningGeometry, fitOpening, openingSpan } = require('./openingGeometry');
const { closetType, closetLayout, closetDoorSwing } = require('./closetGeometry');
const { getContractFitOptions } = require('./residential/contractGeometry');
const { doorClearances, intersects, placeFurnitureWithoutCollisions } = require('./furnitureGeometry');
const { furnitureForRoom } = require('./planFurniture');
const { physicalAccessState } = require('./validatePhysicalAccess');

function containsBedEnvelope(room, brief) {
  const parts = partListOf(room);
  const base = getContractFitOptions(room, brief)[0];
  if (!base) return false;
  return [base, { widthFt: base.heightFt, heightFt: base.widthFt }].some(({ widthFt: w, heightFt: h }) => {
    const xs = [...new Set(parts.flatMap(p => [p.x, p.x + p.w - w]))];
    const ys = [...new Set(parts.flatMap(p => [p.y, p.y + p.h - h]))];
    return xs.some(x => ys.some(y => containsRect(parts, { x, y, w, h })));
  });
}

function connected(parts) {
  const seen = new Set([0]);
  for (let size = -1; size !== seen.size;) {
    size = seen.size;
    parts.forEach((a, i) => {
      if (seen.has(i)) return;
      if ([...seen].some(j => {
        const b = parts[j], overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return (overlapX > 1e-6 && Math.min(Math.abs(a.y + a.h - b.y), Math.abs(b.y + b.h - a.y)) < 1e-6) ||
          (overlapY > 1e-6 && Math.min(Math.abs(a.x + a.w - b.x), Math.abs(b.x + b.w - a.x)) < 1e-6);
      })) seen.add(i);
    });
  }
  return seen.size === parts.length;
}

function reservations(room, type, level, doorWidth) {
  const along = Math.max(5.5, doorWidth + 1), depth = type === 'walk_in' ? 6 : 2.5;
  const result = [], keys = new Set();
  const offsets = max => [...new Set([0, max, max / 2, ...Array.from({ length: Math.min(60, Math.floor(max * 2)) }, (_, i) => (i + 1) / 2)])].filter(n => n >= 0 && n <= max);
  for (const p of partListOf(room)) {
    for (const front of ['bottom', 'top', 'right', 'left']) {
      const horizontal = ['top', 'bottom'].includes(front), w = horizontal ? along : depth, h = horizontal ? depth : along;
      if (w > p.w || h > p.h) continue;
      for (const offset of offsets(horizontal ? p.w - w : p.h - h)) {
        const x = horizontal ? p.x + offset : (front === 'right' ? p.x : p.x + p.w - w);
        const y = horizontal ? (front === 'bottom' ? p.y : p.y + p.h - h) : p.y + offset;
        const key = [x, y, w, h, front].join(':');
        if (keys.has(key)) continue;
        keys.add(key);
        result.push({ id: `${room.id}_closet`, type: 'closet', ownerBedroomId: room.id,
          programId: `${room.programId}_closet`, closetType: type, closetFront: front, closetDoorWidth: doorWidth,
          label: type === 'walk_in' ? 'Walk-in Closet' : 'Reach-in Closet', level: level.level, zone: 'private', x, y, w, h });
      }
    }
  }
  return result;
}

function storageReservations(bedroom, type, level, doorWidth) {
  return level.rooms.filter(r => ['storage', 'loft'].includes(r.type) && !r.requestedFeature && !r.programId && !r.protected && !r.parts?.length &&
    shareWall(r, bedroom, doorWidth + 1) &&
    !(level.doors || []).some(d => [d.a, d.b].includes(r.id) && [d.a, d.b].includes('__exterior__')))
    .flatMap(donor => [
      ...(type === 'walk_in' ? ['top', 'bottom', 'left', 'right'].map(front => ({
      donorId: donor.id, donorWhole: true, id: `${bedroom.id}_closet`, type: 'closet', ownerBedroomId: bedroom.id,
      programId: `${bedroom.programId}_closet`, closetType: type, closetFront: front, closetDoorWidth: doorWidth,
      label: 'Walk-in Closet', level: level.level, zone: 'private', x: donor.x, y: donor.y, w: donor.w, h: donor.h,
      })).filter(r => { const layout = closetLayout(r); return layout.along >= 5 && layout.aisleDepth >= 3; }) : []),
      ...((level.windows || []).some(w => w.roomId === donor.id) ? [] : reservations(donor, type, level, doorWidth)).map(r => ({ ...r, donorId: donor.id, donorWhole: false,
        id: `${bedroom.id}_closet`, ownerBedroomId: bedroom.id, programId: `${bedroom.programId}_closet`,
        closetFront: { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[r.closetFront] })),
    ]);
}

// Reserve within the bedroom or adjacent unrequested storage/loft. Existing halls,
// wet rooms, stairs, bedroom doors and windows are preserved. Failure is a bounded
// search gap, never permission to omit a selected closet or shrink a bed.
function placeBedroomClosets(plan, brief) {
  const rooms = plan.levels.flatMap(l => l.rooms);
  // Allocate the least flexible bedroom first so a generous primary suite
  // cannot consume the small bedroom's only adjacent storage opportunity.
  const areaFor = request => roomArea(rooms.find(r => r.programId === request.programId) || { w: 0, h: 0 });
  const requests = [...(brief.bedroomProgram || [])].sort((a, b) => areaFor(a) - areaFor(b));
  const diagnostics = [];
  for (const request of requests) {
    const type = closetType(request.closet);
    if (!type) continue;
    const level = plan.levels.find(l => l.rooms.some(r => r.programId === request.programId && ['bedroom', 'primary_bedroom'].includes(r.type)));
    const bedroom = level?.rooms.find(r => r.programId === request.programId && ['bedroom', 'primary_bedroom'].includes(r.type));
    if (!bedroom) continue; // Independent survey validation reports identity loss.
    if (level.rooms.some(r => r.type === 'closet' && r.ownerBedroomId === bedroom.id)) continue;
    const originalParts = partListOf(bedroom), zones = doorClearances(bedroom, level);
    let fitted = false, attempts = 0;
    const doorWidth = brief.accessibility?.wideDoors || brief.accessibility?.wheelchair ? 4 : 3;
    for (const closet of [...storageReservations(bedroom, type, level, doorWidth), ...reservations(bedroom, type, level, doorWidth)]) {
      if (attempts === 256) break;
      attempts++;
      const donorId = closet.donorId;
      if (!donorId && zones.some(zone => intersects(closet, zone))) continue;
      const parts = donorId ? originalParts : subtract(originalParts, [closet]);
      if (!parts.length || !connected(parts)) continue;
      const changed = { ...bedroom, parts };
      Object.assign(changed, boundingRectOf(changed));
      if (parts.length === 1) delete changed.parts;
      if (!containsBedEnvelope(changed, brief)) continue;
      const layout = closetLayout(closet);
      if (!containsRect(partListOf(changed), closetDoorSwing(closet))) continue;
      if (type === 'reach_in' && !containsRect(partListOf(changed), layout.access)) continue;
      let remainingDonor = null;
      if (donorId && !closet.donorWhole) {
        const donor = level.rooms.find(r => r.id === donorId);
        if (doorClearances(donor, level).some(zone => intersects(closet, zone))) continue;
        const donorParts = subtract(partListOf(donor), [closet]);
        if (!donorParts.length || !connected(donorParts)) continue;
        remainingDonor = { ...donor, parts: donorParts };
        Object.assign(remainingDonor, boundingRectOf(remainingDonor));
        if (donorParts.length === 1) delete remainingDonor.parts;
      }
      const trial = { ...level, rooms: level.rooms.filter(r => r.id !== donorId).map(r => r.id === bedroom.id ? changed : r)
        .concat(remainingDonor ? [remainingDonor, closet] : [closet]),
        doors: level.doors.filter(d => !donorId || !closet.donorWhole || ![d.a, d.b].includes(donorId)),
        // A whole incidental room can become the requested closet without
        // losing its facade opening. Partial donations still avoid windows.
        windows: level.windows.map(w => donorId && closet.donorWhole && w.roomId === donorId ? { ...w, roomId: closet.id } : w) };
      const door = fitOpening(trial, layout.door, 'door', [...trial.doors.map(d => openingSpan(d)), ...trial.windows.map(w => openingSpan(w, 'window'))]);
      if (!door || door.x !== layout.door.x || door.y !== layout.door.y) continue;
      trial.doors.push(door);
      if (validateOpeningGeometry(trial).length) continue;
      if (physicalAccessState(trial, Boolean(brief.openConcept)).seen.size < trial.rooms.length) continue;
      const furniture = placeFurnitureWithoutCollisions(changed, trial, furnitureForRoom(changed, trial));
      if (!furniture.items.some(f => f.kind.startsWith('bed_'))) continue;
      level.rooms = trial.rooms;
      level.doors = trial.doors;
      level.windows = trial.windows;
      fitted = true;
      break;
    }
    diagnostics.push({ programId: request.programId, requested: type, status: fitted ? 'placed' : 'search_exhausted', attempts,
      reason: fitted ? 'Physical reservation preserves bedroom openings, clearance envelope, furnishings and room connectivity.' : 'No tested bedroom or unrequested-storage reservation preserved closet access and bedroom fit.' });
  }
  plan.closetPlacementDiagnostics = diagnostics;
  for (const level of plan.levels) require('./geometry/openingIdentity').assignOpeningIds(level);
  return plan;
}

module.exports = { placeBedroomClosets, containsBedEnvelope };
