'use strict';

/* Rough openings and clear apertures (execution plan P04, item 2).
 *
 * An opening is stored as a nominal width on a boundary line. Three different
 * numbers hide inside that one figure, and they are not interchangeable:
 *
 *   nominal        what the plan asks for and what the drawing labels
 *   rough opening  what has to be framed, nominal plus jamb stock and shims
 *   clear aperture what a person actually passes through, nominal minus the
 *                  stop and the leaf standing open
 *
 * A "36 inch door" frames at about 38 in and passes about 34 in. Accessibility
 * and egress minimums are written against the third number, so a check that
 * reads the first one is not a check. This module derives all three from the
 * wall the opening sits in.
 *
 * Like wallModel, this is a measurement layer: it reports, and nothing
 * enforces it yet.
 */

const { inches, toInches, nearlyEqual, roundFt, EPSILON_FT } = require('./units');
const {ruleFeet}=require('../stairs/codeProfiles');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* Conventional residential allowances, stated as conventional. A real project
 * replaces them from its door and hardware schedule. */
const OPENING_ALLOWANCES = Object.freeze({
  // Jamb stock plus shim space each side, so the framed opening is larger.
  jambPerSideFt: inches(0.75),
  // Stop bead plus the leaf standing at 90 degrees, so the passage is smaller.
  doorStopAndLeafFt: inches(1.75),
  // A cased opening has trim but no leaf, so it loses much less.
  casingPerSideFt: inches(0.5),
});

/* Reference minimums, for reporting. Quoted so the numbers in a report can be
 * traced to an intent rather than appearing as bare constants.
 *
 * These are common residential expectations, NOT a code citation for any
 * jurisdiction, and nothing here establishes accessibility compliance. */
const CLEAR_WIDTH_REFERENCES = Object.freeze({
  // A door a wheelchair is expected to pass.
  accessiblePassageFt: inches(32),
  // Habitable-room doors in ordinary residential practice.
  habitableDoorFt: inches(30),
});

const openingKind = (opening, declaredKind) => {
  if (declaredKind === 'window') return 'window';
  if (opening?.garageDoor) return 'garage_door';
  if (opening?.openThreshold) return 'open_threshold';
  if (opening?.sliding || opening?.slidingDoor) return 'sliding_door';
  // Openings between two interior rooms with no leaf recorded are cased.
  if (opening?.cased === true) return 'cased_opening';
  return 'door';
};

/* Which wall an opening sits in. Openings are placed on boundary lines, so the
 * host is the wall whose axis matches the opening's fixed coordinate and whose
 * run covers it. */
function hostWallFor(opening, walls) {
  const isVertical = String(opening?.dir || '').toLowerCase() === 'vertical';
  const axis = isVertical ? num(opening?.x) : num(opening?.y);
  const along = isVertical ? num(opening?.y) : num(opening?.x);
  const width = num(opening?.width ?? opening?.w);
  const orientation = isVertical ? 'vertical' : 'horizontal';

  if (!(width > 0)) return null;
  const start = along - width / 2, end = along + width / 2;
  const ids = [opening.a || opening.roomId, opening.b].filter(id => id && id !== '__exterior__').map(String);
  const candidates = walls.filter(w => w.orientation === orientation && nearlyEqual(w.axisFt, axis)
    && ids.every(id => w.roomIds.map(String).includes(id))
    && (!opening.b || (opening.b === '__exterior__') === w.exterior)
    && w.endFt > start && w.startFt < end).sort((a, b) => a.startFt - b.startFt);
  // A host must cover the whole CENTRED opening on the right room pair. Mere
  // overlap allowed a door to extend through a junction or into open air.
  let cursor = start;
  const hosts = [];
  for (const wall of candidates) {
    if (wall.startFt > cursor + 1e-7) return null;
    cursor = Math.max(cursor, wall.endFt);
    hosts.push(wall);
    if (cursor >= end - 1e-7) break;
  }
  if (cursor < end - 1e-7 || !hosts.length) return null;
  const governing = hosts.reduce((a, b) => a.assembly.thicknessFt >= b.assembly.thicknessFt ? a : b);
  return { ...governing, id: hosts.map(w => w.id).join('+'), startFt: hosts[0].startFt,
    endFt: cursor, hostWallIds: hosts.map(w => w.id) };
}

function deriveOpeningClearance(opening, wall, declaredKind) {
  const kind = openingKind(opening, declaredKind);
  const nominalWidthFt = num(opening?.width ?? opening?.w);
  const scheduledFrameRequired = ['window','sliding_door','garage_door','open_threshold'].includes(kind);
  const roughOpeningWidthFt = scheduledFrameRequired ? null : nominalWidthFt + OPENING_ALLOWANCES.jambPerSideFt * 2;

  let clearWidthFt = nominalWidthFt;
  if (kind === 'door') clearWidthFt = nominalWidthFt - OPENING_ALLOWANCES.doorStopAndLeafFt;
  else if (kind === 'cased_opening') clearWidthFt = nominalWidthFt - OPENING_ALLOWANCES.casingPerSideFt * 2;
  else if (['window', 'sliding_door', 'garage_door'].includes(kind)) clearWidthFt = null;
  // Sash travel, sliding panels and garage hardware need a product schedule.
  // Their nominal span is not a measured usable passage.

  return {
    kind,
    hostWallId: wall ? wall.id : null,
    hostAssemblyId: wall ? wall.assembly.id : null,
    wallThicknessFt: wall ? roundFt(wall.assembly.thicknessFt, 4) : null,
    nominalWidthFt: roundFt(nominalWidthFt, 4),
    nominalWidthIn: Math.round(toInches(nominalWidthFt) * 10) / 10,
    roughOpeningWidthFt: roughOpeningWidthFt === null ? null : roundFt(roughOpeningWidthFt, 4),
    roughOpeningWidthIn: roughOpeningWidthFt === null ? null : Math.round(toInches(roughOpeningWidthFt) * 10) / 10,
    roughOpeningBasis: scheduledFrameRequired ? 'frame_details_required' : 'assumed_jamb_allowance',
    roughOpeningFitsHost: roughOpeningWidthFt !== null && wall && Number.isFinite(wall.startFt) && Number.isFinite(wall.endFt)
      ? (num(opening?.dir === 'vertical' ? opening?.y : opening?.x) - roughOpeningWidthFt / 2 >= wall.startFt - 1e-7
        && num(opening?.dir === 'vertical' ? opening?.y : opening?.x) + roughOpeningWidthFt / 2 <= wall.endFt + 1e-7)
      : null,
    clearWidthFt: clearWidthFt === null ? null : roundFt(clearWidthFt, 4),
    clearWidthIn: clearWidthFt === null ? null : Math.round(toInches(clearWidthFt) * 10) / 10,
    measurementStatus: clearWidthFt === null ? 'product_schedule_required' : 'assumed_allowances',
    // The reveal a person walks through is as deep as the wall.
    revealDepthFt: wall ? roundFt(wall.assembly.thicknessFt, 4) : null,
    rooms: [opening?.a, opening?.b, opening?.roomId].filter(Boolean),
  };
}

/* All openings on one level, measured against that level's wall graph. */
function deriveLevelClearances(level, wallModel) {
  const walls = wallModel?.walls || [];
  const doors = (level?.doors || []).map((opening) => ({
    opening,
    ...deriveOpeningClearance(opening, hostWallFor(opening, walls), 'door'),
  }));
  const windows = (level?.windows || []).map((opening) => ({
    opening,
    ...deriveOpeningClearance(opening, hostWallFor(opening, walls), 'window'),
  }));

  const unhosted = [...doors, ...windows].filter((entry) => !entry.hostWallId);

  return {
    level: num(level?.level, 1),
    doors,
    windows,
    unhostedCount: unhosted.length,
  };
}

/* Openings whose clear aperture falls below a required width.
 *
 * Returns findings rather than throwing: the caller decides whether a narrow
 * passage is a candidate failure or a reported limitation. Windows are
 * excluded because their sash opening is not modelled. */
function findNarrowPassages(clearances, minClearWidthFt = CLEAR_WIDTH_REFERENCES.habitableDoorFt) {
  const findings = [];
  for (const entry of clearances?.doors || []) {
    if (entry.kind === 'garage_door' || entry.clearWidthFt === null) continue;
    if (entry.clearWidthFt >= minClearWidthFt - EPSILON_FT) continue;
    findings.push({
      code: 'OPENING_CLEAR_WIDTH_BELOW_MINIMUM',
      level: clearances.level,
      hostWallId: entry.hostWallId,
      rooms: entry.rooms,
      nominalWidthIn: entry.nominalWidthIn,
      clearWidthIn: entry.clearWidthIn,
      requiredWidthIn: Math.round(toInches(minClearWidthFt) * 10) / 10,
      message: `Opening between ${entry.rooms.join(' and ') || 'unknown rooms'} is `
        + `${entry.nominalWidthIn} in nominal but ${entry.clearWidthIn} in clear, `
        + `below the ${Math.round(toInches(minClearWidthFt))} in required here`,
    });
  }
  return findings;
}

/* Stair reservations (execution plan P04, item 3).
 *
 * A stair core is allocated as a room rectangle, and its width has been
 * checked against that rectangle - a dimension between boundary lines with no
 * thickness. Two things consume it before anyone can climb: the walls either
 * side, and the handrail projecting into the flight.
 *
 * IRC R311.7 shapes are used as the reference: 36 in clear above the handrail,
 * handrails projecting no more than 4.5 in each side, and not less than 31.5 in
 * below the handrail with one rail or 27 in with two. Stated as a reference,
 * not as approval for any jurisdiction.
 */
const STAIR_RESERVATIONS = Object.freeze({
  handrailProjectionFt: ruleFeet('maxRailProjection'),
  minClearAboveHandrailFt: ruleFeet('minWidthAboveRails'),
  minClearBelowOneHandrailFt: ruleFeet('minWidthOneRail'),
  minClearBelowTwoHandrailsFt: ruleFeet('minWidthTwoRails'),
});

/* Clear width of a stair flight, from the wall graph.
 *
 * `handrailCount` is an explicit scenario, not inferred from the core width.
 * No fitted flights or missing room geometry returns an unevaluated result.
 * Reference: Boulder County B32 residential stair guide (accessed 2026-09-25).
 * https://bouldercounty.gov/property-and-land/land-use/building/building-publications/residential-stairways-handrails-ramps-and-guards-b32/
 */
function deriveStairClearance(stairRoom, wallModel, handrailCount = 1, layout = null) {
  const entry = wallModel?.roomClear?.find(r => String(r.roomId) === String(stairRoom?.id));
  const unevaluated = reason => ({ evaluated: false, roomId: stairRoom?.id || null, reason, flights: [] });
  if (!entry?.parts.length || wallModel.errors?.length) return unevaluated('Valid finished room geometry is required.');
  if (!layout?.valid || !layout.flights?.length) return unevaluated('Individual fitted flight geometry is required; core width is not flight width.');
  if (![0, 1, 2].includes(handrailCount)) return unevaluated('Handrail count must be 0, 1 or 2.');
  const { intersection, containsRect, subtract, union } = require('./rectBoolean');
  const rails = handrailCount;
  const requiredBelowFt = rails === 0 ? STAIR_RESERVATIONS.minClearAboveHandrailFt
    : rails === 1 ? STAIR_RESERVATIONS.minClearBelowOneHandrailFt : STAIR_RESERVATIONS.minClearBelowTwoHandrailsFt;
  const flights = [];
  for (const [index, flight] of layout.flights.entries()) {
    const r = flight.rect;
    if (!r || ![r.x,r.y,r.w,r.h,flight.from?.x,flight.from?.y,flight.to?.x,flight.to?.y].every(Number.isFinite) || r.w <= 0 || r.h <= 0) {
      return unevaluated('Flight geometry is malformed.');
    }
    const dx = Math.abs(flight.to.x - flight.from.x), dy = Math.abs(flight.to.y - flight.from.y);
    if ((dx < 1e-7 && dy < 1e-7) || (dx > 1e-7 && dy > 1e-7)) return unevaluated('Flights must have an axis-aligned travel direction.');
    const vertical = dy > dx;
    // Width is lateral to travel. A perpendicular wall at the top of a flight
    // may stop below that flight's elevation; a 2D wall footprint cannot say.
    // Keep full-footprint intersections as a separate coordination finding.
    const lateralWalls = wallModel.walls?.filter(w => w.orientation === (vertical ? 'vertical' : 'horizontal'));
    const widthParts = lateralWalls ? subtract(union(stairRoom.parts?.length ? stairRoom.parts : [stairRoom]), lateralWalls.map(w => {
      const t=w.assembly.thicknessFt;
      return w.orientation==='vertical'?{x:w.axisFt-t/2,y:w.startFt,w:t,h:w.lengthFt}
        :{x:w.startFt,y:w.axisFt-t/2,w:w.lengthFt,h:t};
    })) : entry.parts;
    const clipped = widthParts.map(p => intersection(p, r)).filter(Boolean);
    const lo = vertical ? r.y : r.x, hi = lo + (vertical ? r.h : r.w);
    const cuts = [...new Set([lo,hi,...clipped.flatMap(p => vertical ? [p.y,p.y+p.h] : [p.x,p.x+p.w])])].sort((a,b)=>a-b);
    const centre = vertical ? r.x+r.w/2 : r.y+r.h/2;
    let minWidth = Infinity;
    for (let i=1; i<cuts.length; i++) {
      if (cuts[i]-cuts[i-1] < 1e-7) continue;
      const mid=(cuts[i]+cuts[i-1])/2;
      const intervals=clipped.filter(p=>vertical ? p.y<=mid && p.y+p.h>=mid : p.x<=mid && p.x+p.w>=mid)
        .map(p=>vertical?[p.x,p.x+p.w]:[p.y,p.y+p.h]).sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for(const interval of intervals) {
        const last=merged.at(-1);
        if(last && interval[0]<=last[1]+1e-7) last[1]=Math.max(last[1],interval[1]);
        else merged.push([...interval]);
      }
      const usable=merged.find(([start,end])=>start<=centre && end>=centre);
      minWidth=Math.min(minWidth,usable?usable[1]-usable[0]:0);
    }
    if (!Number.isFinite(minWidth)) minWidth=0;
    const below=Math.max(0,minWidth-STAIR_RESERVATIONS.handrailProjectionFt*rails);
    flights.push({ index, nominalWidthFt: vertical?r.w:r.h, clearAboveHandrailFt:minWidth,
      clearBelowHandrailFt:below, fitsFinishedFaces:containsRect(entry.parts,r),
      meetsAboveHandrail:minWidth>=STAIR_RESERVATIONS.minClearAboveHandrailFt-1e-7,
      meetsBelowHandrail:below>=requiredBelowFt-1e-7 });
  }
  const above=Math.min(...flights.map(f=>f.clearAboveHandrailFt));
  const below=Math.min(...flights.map(f=>f.clearBelowHandrailFt));
  const nominal=Math.min(...flights.map(f=>f.nominalWidthFt));
  return { evaluated:true, roomId:stairRoom.id, flights, handrailCount:rails,
    nominalWidthFt:nominal, nominalWidthIn:Math.round(toInches(nominal)*10)/10,
    clearAboveHandrailFt:above, clearAboveHandrailIn:Math.round(toInches(above)*10)/10,
    clearBelowHandrailFt:below, clearBelowHandrailIn:Math.round(toInches(below)*10)/10,
    meetsAboveHandrail:flights.every(f=>f.meetsAboveHandrail), meetsBelowHandrail:flights.every(f=>f.meetsBelowHandrail),
    requiredAboveIn:toInches(STAIR_RESERVATIONS.minClearAboveHandrailFt), requiredBelowIn:toInches(requiredBelowFt),
    basis:'Individual flights and finished wall faces; assumed rail projection. Guard, headroom and structure checks remain separate.' };
}

function findNarrowStairs(stairClearance) {
  if (!stairClearance || !stairClearance.evaluated) return [{ code: 'STAIR_CLEARANCE_NOT_EVALUABLE', message: stairClearance?.reason || 'Stair clearance data is missing.' }];
  const findings = [];
  if (stairClearance.flights?.some(f => !f.fitsFinishedFaces)) findings.push({
    code:'STAIR_WALL_COORDINATION_REQUIRED', roomId:stairClearance.roomId,
    message:'A flight intersects a wall footprint. Coordinate wall height, opening and flight elevations before certifying clearance.',
  });
  if (!stairClearance.meetsAboveHandrail) {
    findings.push({
      code: 'STAIR_CLEAR_WIDTH_BELOW_MINIMUM',
      roomId: stairClearance.roomId,
      message: `Stair ${stairClearance.roomId} is ${stairClearance.nominalWidthIn} in nominal but `
        + `${stairClearance.clearAboveHandrailIn} in clear between finished faces, below the `
        + `${stairClearance.requiredAboveIn} in reference`,
    });
  }
  if (!stairClearance.meetsBelowHandrail) {
    findings.push({
      code: 'STAIR_CLEAR_WIDTH_AT_HANDRAIL_BELOW_MINIMUM',
      roomId: stairClearance.roomId,
      message: `Stair ${stairClearance.roomId} leaves ${stairClearance.clearBelowHandrailIn} in `
        + `past ${stairClearance.handrailCount} handrail(s), below the `
        + `${stairClearance.requiredBelowIn} in reference`,
    });
  }
  return findings;
}

module.exports = {
  STAIR_RESERVATIONS,
  deriveStairClearance,
  findNarrowStairs,
  OPENING_ALLOWANCES,
  CLEAR_WIDTH_REFERENCES,
  deriveOpeningClearance,
  deriveLevelClearances,
  findNarrowPassages,
  hostWallFor,
};
