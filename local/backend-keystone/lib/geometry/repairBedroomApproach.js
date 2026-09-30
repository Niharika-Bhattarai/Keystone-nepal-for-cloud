'use strict';

const { buildFloorPassageModel } = require('./floorPassageModel');
const { checkBedroomApproach } = require('./bedroomApproach');
const { containsRect } = require('./rectBoolean');
const { doorClearances, intersects, bedClearanceEnvelope, fitsRoom } = require('../furnitureGeometry');
const { validateEditedPlan } = require('../validateEditedPlan');
const { isDeepStrictEqual } = require('node:util');
const { createBedroomArchitecturalCheck } = require('./bedroomArchitecture');
const { selectBedroomArchitecturePolicy } = require('./bedroomMeasurements');

// Explicit opt-in proposal only. Default translates the existing bed/nightstands.
// Optional quarter turns preserve physical sizes; head-side placement is a
// separate explicit option, never an implicit change to furniture relationships.
// No production callers; no silent schedule creation or regeneration of furniture.
function proposeBedroomApproachRepair(plan, surveyData, options = {}) {
  const { enabled = false, levelNumber, request, maxCandidates = 2000, maxRouteChecks = 128,
    maxDisplacementFt = 8, gridStepFt = 0.25, allowQuarterTurns = false, nightstandPlacement = 'preserve', architecturePolicy: suppliedArchitecturePolicy,
    coordinateDresser = false, maxDresserSlots = 20000 } = options;
  const result = { status: 'not_checked', constructionVerified: false, doorSwingVerified: false,
    strategy: coordinateDresser ? 'bed_nightstands_and_dresser' : nightstandPlacement === 'head_sides' ? 'bed_with_head_side_nightstands' : allowQuarterTurns ? 'bed_and_nightstands_rigid_rotation' : 'bed_and_nightstands_translation', candidateCount: 0, routeCheckCount: 0,
    search: { maxCandidates, maxRouteChecks, maxDisplacementFt, gridStepFt, allowQuarterTurns, nightstandPlacement, maxDresserSlots }, dresserSlotCount: 0, rejections: {} };
  const fail = reason => ({ ...result, reason });
  if (!enabled) return { ...fail('Explicit opt-in is required.'), status: 'disabled' };
  if (enabled !== true || typeof coordinateDresser !== 'boolean' || typeof allowQuarterTurns !== 'boolean' || !['preserve','head_sides'].includes(nightstandPlacement) || !plan || !Array.isArray(plan.levels) || !surveyData || typeof surveyData !== 'object' ||
      !Object.keys(surveyData).length || !request || !Number.isFinite(levelNumber) ||
      !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 10000 ||
      !Number.isInteger(maxRouteChecks) || maxRouteChecks < 1 || maxRouteChecks > 1000 ||
      !Number.isInteger(maxDresserSlots) || maxDresserSlots < 1 || maxDresserSlots > 100000 ||
      !Number.isFinite(maxDisplacementFt) || maxDisplacementFt <= 0 || maxDisplacementFt > 12 ||
      !Number.isFinite(gridStepFt) || gridStepFt < 0.125 || gridStepFt > 1 ||
      (request.maxNodes !== undefined && (!Number.isInteger(request.maxNodes) || request.maxNodes < 1 || request.maxNodes > 40000)) ||
      !Number.isFinite(request.clearWidthFt) || request.clearWidthFt <= 0 || !['either','both'].includes(request.sidePolicy)) {
    return fail('Original survey, explicit approach policy, floor and bounded search settings are required.');
  }
  const levels = plan.levels.filter(l => l?.level === levelNumber);
  if (levels.length !== 1) return fail('A unique floor is required.');
  const level = levels[0];
  if (!Array.isArray(level.furniture) || !Array.isArray(level.rooms) || !Array.isArray(level.doors)) return fail('Floor geometry is missing.');
  const beds = level.furniture.filter(f => f?.id === request.bedId);
  if (beds.length !== 1) return fail('A unique bed identity is required.');
  const bed = beds[0], rooms = level.rooms.filter(r => r?.id === bed.roomId);
  if (rooms.length !== 1 || !['bedroom','primary_bedroom','guest_bedroom'].includes(rooms[0].type) ||
      !String(bed.kind).startsWith('bed_') || ![0,90,180,270].includes(bed.rotation) ||
      !['x','y','w','h'].every(k => Number.isFinite(bed[k])) || bed.w <= 0 || bed.h <= 0) return fail('Valid bed bounds, orientation and bedroom ownership are required.');
  const room = rooms[0];
  const selection = selectBedroomArchitecturePolicy(level,room.id,bed.id,suppliedArchitecturePolicy);
  if (selection.errors.length) return {...fail('Persisted bedroom measurements cannot be used.'),errors:selection.errors};
  const architecturePolicy = selection.policy;
  if (coordinateDresser && architecturePolicy === undefined) return fail('Coordinated dresser packing requires explicit or persisted architectural measurements.');
  result.measurementSource = selection.source;
  const furniture = level.furniture.filter(f => f?.roomId === room.id);
  if (furniture.filter(f => String(f.kind).startsWith('bed_')).length !== 1) return fail('Nightstand ownership is ambiguous in a multiple-bed room.');
  const moving = furniture.filter(f => f.id === bed.id || f.kind === 'nightstand');
  const dressers = coordinateDresser ? furniture.filter(f => f.kind === 'dresser') : [];
  if (coordinateDresser && (dressers.length !== 1 || ![0,90,180,270].includes(dressers[0].rotation ?? 0))) return fail('Coordinated packing requires one existing dresser with orthogonal orientation.');
  result.search.coordinateDresser = coordinateDresser;
  if (moving.some(f=>f.rotation!==undefined && ![0,90,180,270].includes(f.rotation))) return fail('Moving furniture requires known orthogonal orientation.');
  if (nightstandPlacement === 'head_sides' && moving.filter(f=>f.kind==='nightstand').length !== 2) return fail('Head-side placement currently requires exactly two existing nightstands; inventory is never invented.');
  if (new Set(level.furniture.map(f => f?.id)).size !== level.furniture.length) return fail('Furniture identities must be unique.');
  if (plan.furniture !== undefined && (!Array.isArray(plan.furniture) ||
      plan.levels.some(l => { const copies = plan.furniture.filter(f => f?.level === l.level);
        return copies.length !== 1 || !isDeepStrictEqual(copies[0].items,l.furniture); }))) return fail('Aggregate furniture is inconsistent with floor furniture; reconcile it before repair.');
  if (['sideClearanceFt','footClearanceFt'].some(k => room.roomContract?.[k] !== undefined &&
      (!Number.isFinite(room.roomContract[k]) || room.roomContract[k] <= 0))) return fail('Invalid bedroom clearance contract.');
  let model, originalErrors;
  try { model = buildFloorPassageModel(level); originalErrors = validateEditedPlan(plan, surveyData); }
  catch (error) { return fail(`Invalid source plan: ${error.message}`); }
  if (originalErrors.length) return { ...fail('Source plan fails original-survey validation; this bounded repair does not hide unrelated errors.'), errors: originalErrors };
  if (model.errors.length) return { ...fail('Physical opening geometry is invalid.'), errors: model.errors };
  const architecture = architecturePolicy === undefined ? null : createBedroomArchitecturalCheck(level, room.id, bed.id, architecturePolicy);
  if (architecture && architecture.status !== 'ready') return fail(architecture.reason);
  result.architecturalValidation = architecture ? architecture.check(furniture) : { status: 'not_requested' };
  const entry = model.openings.find(o => o.openingId === request.entryOpeningId);
  const from = level.rooms.find(r => r.id === request.fromRoomId);
  if (!entry || entry.status !== 'scheduled_geometry' || from?.type !== 'hallway' ||
      !entry.rooms.includes(room.id) || !entry.rooms.includes(from.id)) return fail('A scheduled doorway directly connecting the stated hallway and bedroom is required.');
  if (entry.clearWidthFt < request.clearWidthFt) return { ...fail('Furniture moves cannot widen the scheduled clear doorway.'), status: 'blocked' };
  const clear = model.roomClear.find(r => r.roomId === room.id)?.parts || [];
  if (!clear.length) return fail('Finished room geometry is missing.');
  const movingIds = new Set([...moving, ...dressers].map(f => f.id));
  const fixed = furniture.filter(f => !movingIds.has(f.id));
  const zones = doorClearances(room, level);
  if (fixed.some(item => !containsRect(clear, item))) return fail('A fixed furnishing lies outside finished room bounds; this bed/nightstand strategy cannot correct it.');
  if (fixed.some((item,i) => zones.some(z => intersects(item,z)) || fixed.slice(0,i).some(other => intersects(item,other)))) {
    return fail('Fixed furniture overlaps or blocks an existing door zone; this bed/nightstand strategy cannot correct it.');
  }
  const before = checkBedroomApproach(level, request);
  const reject = code => { result.rejections[code] = (result.rejections[code] || 0) + 1; };
  let candidateArchitecture = null;
  function physicalFit(group, complete = true) {
    const candidate = group.find(item => item.id === bed.id);
    const envelope = bedClearanceEnvelope(candidate, room);
    if (!containsRect(clear,candidate) || !containsRect(clear,envelope)) { reject('finished_room_or_bed_envelope'); return false; }
    // The full validator still uses nominal insets for unmigrated saved plans.
    // Reject these invariant failures before multiplying them by dresser slots.
    if (coordinateDresser && level.finishedFaceGeometryVersion !== 1 &&
        (group.some(item => !fitsRoom(item,room)) ||
          (level.rooms.some(r => r.ownerBedroomId === room.id && r.type === 'closet') && !fitsRoom(envelope,room)))) {
      reject('active_nominal_furniture_bounds'); return false;
    }
    if (group.some(item => !containsRect(clear,item))) { reject('finished_furniture_bounds'); return false; }
    if (group.some(item => zones.some(zone => intersects(item,zone)))) { reject('door_zone'); return false; }
    if (group.some(item => fixed.some(other => intersects(item,other,0.25)))) { reject('furniture_spacing'); return false; }
    if (fixed.some(item => item.kind !== 'nightstand' && intersects(envelope,item))) { reject('bed_envelope_obstruction'); return false; }
    if (coordinateDresser && (group.some((item,i) => group.slice(0,i).some(other => intersects(item,other,0.25))) ||
        group.some(item => item.kind === 'dresser' && intersects(envelope,item)))) { reject('group_spacing_or_bed_envelope'); return false; }
    if (architecture && complete) {
      const assessment = architecture.check([...fixed, ...group]);
      if (assessment.status !== 'clear') { for (const issue of assessment.issues) reject(issue.code); return false; }
      candidateArchitecture = assessment;
    }
    return true;
  }
  // Critical room/envelope/furniture coordinates plus a bounded local grid.
  // Sampling is deliberately finite: exhaustion is not proof of infeasibility.
  const center = {x:bed.x+bed.w/2,y:bed.y+bed.h/2};
  function rotateGroup(turns) {
    let group = structuredClone(moving);
    let rotations=turns;
    if (nightstandPlacement === 'head_sides') {
      const width=bed.rotation%180?bed.h:bed.w,length=bed.rotation%180?bed.w:bed.h;
      const base={...bed,x:center.x-width/2,y:center.y-length/2,w:width,h:length,rotation:0};
      const stands=group.filter(f=>f.kind==='nightstand').sort((a,b)=>a.id.localeCompare(b.id));
      group=[base,...stands.map((item,i)=>{
        const w=item.rotation%180?item.h:item.w,h=item.rotation%180?item.w:item.h;
        return {...item,w,h,x:i?base.x+base.w+0.35:base.x-w-0.35,y:base.y+0.5,rotation:0};
      })];
      rotations=(bed.rotation/90+turns)%4;
    }
    for (let n=0;n<rotations;n++) group = group.map(item => ({...item,
      x:center.x-(item.y+item.h-center.y), y:center.y+(item.x-center.x), w:item.h,h:item.w,
      rotation:((item.rotation || 0)+90)%360 }));
    return group;
  }
  const configured=rotateGroup(0);
  const configuredAlready=nightstandPlacement==='preserve'||configured.every(item=>{
    const original=moving.find(f=>f.id===item.id);
    return ['x','y','w','h'].every(k=>Math.abs(original[k]-item[k])<1e-8)&&((original.rotation||0)===(item.rotation||0));
  });
  if (configuredAlready && before.status === 'clear' && physicalFit([...moving,...dressers])) return { ...result, status: 'unchanged', before, after: before,
    architecturalValidation: candidateArchitecture || result.architecturalValidation,
    reason: 'Existing placement already satisfies the same physical and approach checks.' };
  function positionsFor(group,turns) {
  const anchor=group.find(item=>item.id===bed.id);
  const envelope = bedClearanceEnvelope(anchor,room), dx = anchor.x-envelope.x, dy = anchor.y-envelope.y;
  const xs = new Set([anchor.x]), ys = new Set([anchor.y]);
  for (const part of clear) {
    for (const x of [part.x+dx,part.x+part.w-envelope.w+dx,part.x+(part.w-envelope.w)/2+dx]) xs.add(x);
    for (const y of [part.y+dy,part.y+part.h-envelope.h+dy,part.y+(part.h-envelope.h)/2+dy]) ys.add(y);
  }
  for (const obstacle of [...fixed,...zones]) {
    for (const x of [obstacle.x-anchor.w-0.25,obstacle.x+obstacle.w+0.25,obstacle.x-envelope.w+dx,obstacle.x+obstacle.w+dx]) xs.add(x);
    for (const y of [obstacle.y-anchor.h-0.25,obstacle.y+obstacle.h+0.25,obstacle.y-envelope.h+dy,obstacle.y+obstacle.h+dy]) ys.add(y);
  }
  if (allowQuarterTurns) for (const member of group) {
    const ox=member.x-anchor.x,oy=member.y-anchor.y;
    for (const part of clear) {
      xs.add(part.x-ox);xs.add(part.x+part.w-member.w-ox);
      ys.add(part.y-oy);ys.add(part.y+part.h-member.h-oy);
    }
    for (const obstacle of [...fixed,...zones]) {
      xs.add(obstacle.x-member.w-ox-0.25);xs.add(obstacle.x+obstacle.w-ox+0.25);
      ys.add(obstacle.y-member.h-oy-0.25);ys.add(obstacle.y+obstacle.h-oy+0.25);
    }
  }
  if (architecture) {
    // Add exact finished head-wall alignments and window reservation boundaries;
    // a coarse grid alone can miss support beside glazing by fractions of an inch.
    for (const face of architecture.faces) {
      if (anchor.rotation === 0 && face.dir === 'horizontal' && face.side === 1) ys.add(face.axis);
      if (anchor.rotation === 180 && face.dir === 'horizontal' && face.side === -1) ys.add(face.axis - anchor.h);
      if (anchor.rotation === 90 && face.dir === 'vertical' && face.side === -1) xs.add(face.axis - anchor.w);
      if (anchor.rotation === 270 && face.dir === 'vertical' && face.side === 1) xs.add(face.axis);
    }
    for (const member of group) for (const zone of architecture.windowZones) {
      const ox = member.x - anchor.x, oy = member.y - anchor.y;
      xs.add(zone.x - member.w - ox); xs.add(zone.x + zone.w - ox);
      ys.add(zone.y - member.h - oy); ys.add(zone.y + zone.h - oy);
    }
  }
  const criticalX = new Set(xs), criticalY = new Set(ys);
  const steps = Math.floor(maxDisplacementFt/gridStepFt);
  for (let n=-steps;n<=steps;n++) { xs.add(anchor.x+n*gridStepFt); ys.add(anchor.y+n*gridStepFt); }
  const candidates = [];
  for (const x of xs) for (const y of ys) {
    const distance = Math.hypot(x-anchor.x,y-anchor.y);
    const nearHeadWall = architecture && architecture.faces.some(face => {
      const horizontal = anchor.rotation % 180 === 0;
      const side = anchor.rotation === 0 || anchor.rotation === 270 ? 1 : -1;
      const axis = anchor.rotation === 0 ? y : anchor.rotation === 180 ? y + anchor.h : anchor.rotation === 90 ? x + anchor.w : x;
      const gap = (axis - face.axis) * side;
      return face.dir === (horizontal ? 'horizontal' : 'vertical') && face.side === side &&
        gap >= -1e-7 && gap <= architecturePolicy.headboardMaxGapFt + 1e-7;
    });
    if ((turns || nightstandPlacement==='head_sides' || distance > 1e-9) && distance <= maxDisplacementFt) candidates.push({x,y,distance,
      priority:nearHeadWall?-1:criticalX.has(x)&&criticalY.has(y)?0:1});
  }
  candidates.sort((a,b) => a.priority-b.priority || a.distance-b.distance || a.x-b.x || a.y-b.y);
  return {group,anchor,candidates,turns};
  }
  const searches=(allowQuarterTurns?[0,1,2,3]:[0]).map(turns=>positionsFor(rotateGroup(turns),turns));
  // Round robin prevents one orientation consuming the entire finite budget.
  function* searchOrder() {
    const count=Math.max(...searches.map(s=>s.candidates.length));
    for(let i=0;i<count;i++) for(const search of searches) if(search.candidates[i])yield {...search,position:search.candidates[i]};
  }
  const proposal = structuredClone(plan), targetLevel = proposal.levels.find(l => l.level === levelNumber);
  let dresserSlotsLimited = false;
  function* dresserPlacements(group) {
    if (!coordinateDresser) { yield group; return; }
    // Reject unsupported beds before enumerating dresser moves. Only dresser
    // window conflicts may be deferred here; the complete inventory is checked.
    const partial = architecture.check([...fixed,...group,...dressers]);
    if (partial.status === 'not_checked' || partial.issues.some(i => i.furnitureId !== dressers[0].id)) {
      for (const issue of partial.issues.filter(i => i.furnitureId !== dressers[0].id)) reject(issue.code);
      return;
    }
    const original = dressers[0], envelope = bedClearanceEnvelope(group.find(f => f.id === bed.id),room);
    const choices = [];
    for (const turn of [0,1,2,3]) {
      const item = {...original,w:turn%2?original.h:original.w,h:turn%2?original.w:original.h,rotation:((original.rotation||0)+turn*90)%360};
      const xs = new Set([original.x]), ys = new Set([original.y]);
      for (const part of clear) {
        for (const offset of [0,0.0625,0.25]) {
          xs.add(part.x+offset); xs.add(part.x+part.w-item.w-offset);
          ys.add(part.y+offset); ys.add(part.y+part.h-item.h-offset);
        }
      }
      for (const obstacle of [...group,...fixed,...zones,envelope,...architecture.windowZones]) {
        xs.add(obstacle.x-item.w-0.25); xs.add(obstacle.x+obstacle.w+0.25);
        ys.add(obstacle.y-item.h-0.25); ys.add(obstacle.y+obstacle.h+0.25);
      }
      slots: for (const x of xs) for (const y of ys) {
        if (result.dresserSlotCount >= maxDresserSlots) { dresserSlotsLimited = true; break slots; }
        result.dresserSlotCount++;
        const distance = Math.hypot(x+item.w/2-original.x-original.w/2,y+item.h/2-original.y-original.h/2);
        if (distance > maxDisplacementFt) continue;
        const candidate = {...item,x,y};
        // Cheap individual constraints prune dresser slots before expensive full
        // survey and route checks. They never omit or resize the dresser.
        if (!containsRect(clear,candidate) || [...zones,...group,...fixed,envelope].some(o => intersects(candidate,o,0.25))) continue;
        choices.push({candidate,distance,turn});
      }
      if (dresserSlotsLimited) break;
    }
    choices.sort((a,b)=>a.distance-b.distance||a.turn-b.turn||a.candidate.x-b.candidate.x||a.candidate.y-b.candidate.y);
    for (const {candidate} of choices) yield [...group,candidate];
  }
  for (const {group,anchor,position,turns} of searchOrder()) {
    if (result.candidateCount >= maxCandidates) return { ...result, status: 'search_limit', before,
      reason: 'Candidate budget reached without a validated repair; no infeasibility conclusion.' };
    result.candidateCount++;
    const bedGroup=group.map(item=>({...item,x:item.x+position.x-anchor.x,y:item.y+position.y-anchor.y}));
    if (!physicalFit(bedGroup,!coordinateDresser)) continue;
    for (const placed of dresserPlacements(bedGroup)) {
    if (coordinateDresser) {
      if (result.candidateCount >= maxCandidates) return { ...result, status:'search_limit', before, reason:'Shared bed/dresser candidate budget reached; no infeasibility conclusion.' };
      result.candidateCount++;
      if (!physicalFit(placed)) continue;
    }
    for (const item of placed) targetLevel.furniture[targetLevel.furniture.findIndex(f=>f.id===item.id)] = item;
    if (proposal.furniture) proposal.furniture.find(f => f.level === levelNumber).items = structuredClone(targetLevel.furniture);
    const errors = validateEditedPlan(proposal,surveyData);
    if (errors.length) { reject('original_survey_validation'); continue; }
    if (result.routeCheckCount >= maxRouteChecks) return { ...result, status: 'search_limit', before,
      reason: 'Route-check budget reached without a validated repair; no infeasibility conclusion.' };
    result.routeCheckCount++;
    const after = checkBedroomApproach(targetLevel,request);
    if (after.status !== 'clear') { reject(after.status === 'not_checked' ? 'route_unverified' : 'route_blocked'); continue; }
    const coordinates=item=>({x:item.x,y:item.y,w:item.w,h:item.h,...(item.rotation!==undefined?{rotation:item.rotation}:{})});
    return { ...result, status: 'repaired', before, after, proposedPlan: proposal, quarterTurns:turns,
      architecturalValidation: candidateArchitecture || result.architecturalValidation,
      changes: [...moving,...dressers].map(original => { const item=targetLevel.furniture.find(f=>f.id===original.id);
        return { furnitureId: original.id, roomId: room.id, before:coordinates(original), after:coordinates(item),
          displacementFt:Math.hypot(item.x+item.w/2-original.x-original.w/2,item.y+item.h/2-original.y-original.h/2) }; }),
      validation: { originalSurveyErrors: [], finishedBedroomBounds: true, bedEnvelope: true, existingDoorZones: true,
        furnitureInventoryPreserved: true, openingSchedulesUnchanged: true },
      reason: coordinateDresser ? 'Coordinated bed, nightstands and dresser satisfy the original survey, architectural policy and unchanged approach request.' : 'Bed and nightstand placement satisfies the original survey, finished geometry and unchanged approach policy.' };
    }
    if (dresserSlotsLimited) return { ...result, status:'search_limit', before, reason:'Dresser slot budget reached; no infeasibility conclusion.' };
  }
  return { ...result, status: 'search_exhausted', before, reason: 'No validated placement in the selected finite strategy; larger or coordinated repair may be needed.' };
}

module.exports = { proposeBedroomApproachRepair };
