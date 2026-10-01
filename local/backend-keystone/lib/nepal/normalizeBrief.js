'use strict';
const { lengthMm, areaSqM } = require('./units');
const allowedStoreys = new Set([1, 2, 2.5, 3, 3.5]);
const allowedMunicipalities = new Set(['Kathmandu Metropolitan City', 'Pokhara Metropolitan City']);
const issue = (code, field, message) => ({ code, field, message });
// Common spellings of the supported municipalities map to their profile name;
// anything else is kept as typed (and reported as not yet reviewed).
const MUNICIPALITY_ALIASES = [
  [/^(kathmandu|kmc|kathmandu metropolitan( city)?|kathmandu mahanagar ?palika)$/, 'Kathmandu Metropolitan City'],
  [/^(pokhara|pokhara lekhnath|pokhara metropolitan( city)?|pokhara (lekhnath )?mahanagar ?palika)$/, 'Pokhara Metropolitan City']];
function canonicalMunicipality(value) {
  const typed = String(value || '').trim().replace(/\s+/g, ' ');
  const key = typed.toLowerCase().replace(/[.,]/g, '');
  return MUNICIPALITY_ALIASES.find(([re]) => re.test(key))?.[1] || typed;
}
const finite = n => Number.isFinite(n);
const distance = (a, b) => Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
const cross = (a, b, c) => (b.xMm - a.xMm) * (c.yMm - a.yMm) - (b.yMm - a.yMm) * (c.xMm - a.xMm);
function intersect(a, b, c, d) {
  const p = cross(a, b, c), q = cross(a, b, d), r = cross(c, d, a), s = cross(c, d, b);
  const on = (v, x, y) => Math.min(x.xMm, y.xMm) <= v.xMm && v.xMm <= Math.max(x.xMm, y.xMm) &&
    Math.min(x.yMm, y.yMm) <= v.yMm && v.yMm <= Math.max(x.yMm, y.yMm);
  if (p === 0 && on(c, a, b) || q === 0 && on(d, a, b) || r === 0 && on(a, c, d) || s === 0 && on(b, c, d)) return true;
  return Math.sign(p) !== Math.sign(q) && Math.sign(r) !== Math.sign(s);
}
function polygonArea(vertices) {
  return Math.abs(vertices.reduce((sum, p, i) => {
    const q = vertices[(i + 1) % vertices.length];
    return sum + p.xMm * q.yMm - q.xMm * p.yMm;
  }, 0)) / 2e6;
}
function normalizeBrief(raw) {
  const missing = [], invalid = [], unsupported = [];
  const need = (condition, field, message) => { if (!condition) missing.push(issue('REQUIRED', field, message)); return condition; };
  const bad = (condition, field, message) => { if (condition) invalid.push(issue('INVALID', field, message)); };
  const readLength = (input, field, options) => { try { return lengthMm(input, field, options); } catch (e) { invalid.push(issue('INVALID_UNIT', field, e.message)); return null; } };
  const readArea = (input, field) => { try { return areaSqM(input, field); } catch (e) { invalid.push(issue('INVALID_UNIT', field, e.message)); return null; } };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { brief: null,
    missing: [issue('REQUIRED', 'surveyData', 'A Nepal survey is required.')], invalid, unsupported };
  const jurisdiction = raw.jurisdiction || {};
  need(jurisdiction.country === 'NP', 'jurisdiction.country', 'Choose Nepal as the country.');
  const municipality = canonicalMunicipality(jurisdiction.municipality);
  need(municipality, 'jurisdiction.municipality', 'Choose the municipality for the plot.');
  need(String(jurisdiction.ward ?? '').trim(), 'jurisdiction.ward', 'Enter the plot ward number.');
  if (municipality && !allowedMunicipalities.has(municipality)) unsupported.push(issue('MUNICIPALITY_NOT_REVIEWED',
    'jurisdiction.municipality', `This municipality needs a reviewed local rule profile before generation. Available now: ${[...allowedMunicipalities].join(', ')}.`));

  const site = raw.site || {};
  const shape = site.shape;
  let vertices = null;
  if (shape === 'rectangle') {
    const rect = site.rectangle || {};
    const hasWidth = need(rect.width, 'site.rectangle.width', 'Enter the rectangle width.');
    const hasDepth = need(rect.depth, 'site.rectangle.depth', 'Enter the rectangle depth.');
    if (hasWidth && hasDepth) {
      const w = readLength(rect.width, 'site.rectangle.width'), d = readLength(rect.depth, 'site.rectangle.depth');
      if (w && d) vertices = [{ xMm: 0, yMm: 0 }, { xMm: w, yMm: 0 }, { xMm: w, yMm: d }, { xMm: 0, yMm: d }];
    }
    if (Array.isArray(site.sideLengths) && site.sideLengths.length) {
      if (site.sideLengths.length !== 4) invalid.push(issue('SIDE_COUNT', 'site.sideLengths', 'A rectangle has four sides.'));
      else if (vertices) site.sideLengths.forEach((side, i) => {
        const n = readLength(side, `site.sideLengths.${i}`);
        if (n && Math.abs(n - distance(vertices[i], vertices[(i + 1) % 4])) > 20)
          invalid.push(issue('SIDE_MISMATCH', `site.sideLengths.${i}`, 'Side length disagrees with the rectangle dimensions by more than 20 mm.'));
      });
    }
  } else if (shape === 'surveyedPolygon') {
    if (!Array.isArray(site.vertices) || site.vertices.length < 3)
      missing.push(issue('POLYGON_COORDINATES_REQUIRED', 'site.vertices',
        'Side lengths alone cannot determine an irregular plot. Supply surveyed corner coordinates in boundary order.'));
    else if (site.vertices.length > 16) invalid.push(issue('TOO_MANY_VERTICES', 'site.vertices', 'At most 16 survey vertices are accepted.'));
    else {
      vertices = site.vertices.map((point, i) => {
        const unit = point?.unit;
        const x = Number(point?.x), y = Number(point?.y);
        if (!finite(x) || !finite(y) || !['mm', 'cm', 'm', 'ft'].includes(unit)) {
          invalid.push(issue('INVALID_COORDINATE', `site.vertices.${i}`, 'Each surveyed corner needs finite x/y coordinates and a length unit.'));
          return null;
        }
        const scale = { mm: 1, cm: 10, m: 1000, ft: 304.8 }[unit];
        const xMm = x * scale, yMm = y * scale;
        if (!finite(xMm) || !finite(yMm)) {
          invalid.push(issue('INVALID_COORDINATE', `site.vertices.${i}`, 'Survey coordinate is outside the measurable range.'));
          return null;
        }
        return { xMm, yMm };
      });
      if (vertices.some(v => !v)) vertices = null;
    }
    if (vertices) {
      for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        bad(distance(vertices[i], vertices[j]) < 100, `site.vertices.${i}`, 'Adjacent corners must differ by at least 100 mm.');
        for (let k = i + 2; k < vertices.length; k++) {
          const l = (k + 1) % vertices.length;
          if (i === l || j === k) continue;
          bad(intersect(vertices[i], vertices[j], vertices[k], vertices[l]), 'site.vertices', 'Survey boundary crosses itself.');
        }
      }
      bad(polygonArea(vertices) < 1, 'site.vertices', 'Surveyed plot has too little or no enclosed area.');
      if (!Array.isArray(site.sideLengths) || !site.sideLengths.length)
        missing.push(issue('SIDE_LENGTHS_REQUIRED', 'site.sideLengths', 'Enter the measured length of each surveyed plot edge.'));
      if (Array.isArray(site.sideLengths) && site.sideLengths.length) {
        bad(site.sideLengths.length !== vertices.length, 'site.sideLengths', 'A side length is needed for each polygon edge.');
        if (site.sideLengths.length === vertices.length) site.sideLengths.forEach((side, i) => {
          const n = readLength(side, `site.sideLengths.${i}`);
          if (n && Math.abs(n - distance(vertices[i], vertices[(i + 1) % vertices.length])) > 20)
            invalid.push(issue('SIDE_MISMATCH', `site.sideLengths.${i}`, 'Side length disagrees with surveyed corners by more than 20 mm.'));
        });
      }
    }
  } else if (!shape) missing.push(issue('REQUIRED', 'site.shape', 'Choose a plot shape.'));
  else unsupported.push(issue('SHAPE_NOT_SUPPORTED', 'site.shape', 'This plot shape needs surveyed corner coordinates.'));

  const north = site.north || {};
  const bearing = Number(north.bearingDegrees);
  if (need(north.bearingDegrees !== undefined && north.bearingDegrees !== '', 'site.north.bearingDegrees', 'Enter true-north bearing.'))
    bad(!finite(bearing) || bearing < 0 || bearing >= 360, 'site.north.bearingDegrees', 'True-north bearing must be 0 to less than 360 degrees.');
  need(String(north.evidence || '').trim(), 'site.north.evidence', 'Record the source of the north bearing.');
  const frontageEdges = site.frontageEdges;
  if (need(Array.isArray(frontageEdges) && frontageEdges.length > 0, 'site.frontageEdges', 'Mark at least one road frontage edge.')) {
    frontageEdges.forEach((frontage, i) => {
      bad(!Number.isInteger(frontage?.edgeIndex) || frontage.edgeIndex < 0 || (vertices && frontage.edgeIndex >= vertices.length),
        `site.frontageEdges.${i}.edgeIndex`, 'Frontage edge must refer to a valid plot edge.');
      if (!frontage?.roadWidth) missing.push(issue('REQUIRED', `site.frontageEdges.${i}.roadWidth`, 'Enter the road width with units.'));
      else readLength(frontage.roadWidth, `site.frontageEdges.${i}.roadWidth`);
    });
  }
  let declaredAreaSqM = null;
  if (site.declaredArea) declaredAreaSqM = readArea(site.declaredArea, 'site.declaredArea');
  const measuredAreaSqM = vertices && !invalid.length ? polygonArea(vertices) : null;
  bad(measuredAreaSqM != null && !finite(measuredAreaSqM), 'site', 'Plot area is outside the measurable range.');
  if (declaredAreaSqM && measuredAreaSqM && Math.abs(measuredAreaSqM - declaredAreaSqM) / declaredAreaSqM > 0.02)
    invalid.push(issue('AREA_DISAGREEMENT', 'site.declaredArea', 'Declared and measured plot areas differ by more than 2%; verify the survey.'));
  const boundaries = Array.isArray(site.boundaries) ? site.boundaries : [];
  if (vertices && boundaries.length && boundaries.length !== vertices.length)
    invalid.push(issue('BOUNDARY_COUNT', 'site.boundaries', 'Provide one boundary context record for each plot edge.'));
  const normalizedBoundaries = boundaries.map((boundary, i) => {
    const neighbor = boundary?.neighbor || 'unknown';
    if (!['unknown', 'open', 'building', 'road'].includes(neighbor))
      invalid.push(issue('BOUNDARY_CONTEXT', `site.boundaries.${i}.neighbor`, 'Boundary neighbor must be unknown, open, building or road.'));
    // 0 is a valid proposal on a shared-wall side; legality is checked at municipality review.
    const setbackMm = boundary?.proposedSetback ? readLength(boundary.proposedSetback,
      `site.boundaries.${i}.proposedSetback`, { allowZero: true }) : null;
    const neighborHeightMm = boundary?.neighborHeight ? readLength(boundary.neighborHeight,
      `site.boundaries.${i}.neighborHeight`) : null;
    return { edgeIndex: i, neighbor, neighborHeightMm, neighborHasWindows: boundary?.neighborHasWindows ?? null,
      proposedSetbackMm: setbackMm, note: String(boundary?.note || '').trim() };
  });
  if (Array.isArray(frontageEdges) && normalizedBoundaries.length)
    for (const frontage of frontageEdges) if (normalizedBoundaries[frontage.edgeIndex]?.neighbor === 'building')
      invalid.push(issue('ROAD_BOUNDARY_CONFLICT', `site.boundaries.${frontage.edgeIndex}`,
        'An edge marked as road frontage cannot also be marked as a neighboring building.'));
  const siteContext = {
    surveyRevision: String(site.surveyRevision || '').trim(),
    terrain: String(site.terrain || 'unknown').trim(),
    plinth: String(site.plinth || 'unknown').trim(),
    floodContext: String(site.floodContext || 'unknown').trim(),
    roadAccess: String(site.roadAccess || 'unknown').trim(),
  };

  const measuredPlotAreaSqM = vertices && !invalid.length ? polygonArea(vertices) : null;
  const program = raw.buildingProgram || {};
  const storeys = Number(program.storeys);
  if (need(program.storeys !== undefined && program.storeys !== '', 'buildingProgram.storeys', 'Choose the storey count.'))
    if (!allowedStoreys.has(storeys)) unsupported.push(issue('STOREYS_NOT_SUPPORTED', 'buildingProgram.storeys', 'This residential contract supports 1, 2, 2.5, 3 or 3.5 storeys.'));
  const expectedLevels = allowedStoreys.has(storeys) ? Math.ceil(storeys) : null;
  const programCounts = {};
  for (const [key, minimum, maximum] of [['households', 1, 4], ['bedrooms', 1, 16], ['bathrooms', 1, 16], ['kitchens', 1, 4], ['livingRooms', 1, 4]]) {
    if (need(program[key] !== undefined && program[key] !== '', `buildingProgram.${key}`, `Enter the number of ${key}.`)) {
      programCounts[key] = Number(program[key]);
      bad(!Number.isInteger(programCounts[key]) || programCounts[key] < minimum || programCounts[key] > maximum,
        `buildingProgram.${key}`, `Enter a whole number from ${minimum} to ${maximum}.`);
    }
  }
  need(typeof program.puja === 'boolean', 'buildingProgram.puja', 'Choose whether a puja room is requested.');
  let levels = [];
  if (need(Array.isArray(program.levels) && program.levels.length > 0, 'buildingProgram.levels', 'Describe each physical level, including any partial top level.')) {
    bad(expectedLevels && program.levels.length !== expectedLevels, 'buildingProgram.levels', `This house needs ${expectedLevels} explicit level entries.`);
    const ids = new Set();
    levels = program.levels.map((level, i) => {
      const id = String(level?.id || '').trim();
      need(id, `buildingProgram.levels.${i}.id`, 'Each level needs a stable ID.');
      bad(id && ids.has(id), `buildingProgram.levels.${i}.id`, 'Level IDs must be unique.'); ids.add(id);
      const expectedKind = i === expectedLevels - 1 && storeys % 1 ? 'partial' : 'full';
      bad(level?.kind !== expectedKind, `buildingProgram.levels.${i}.kind`, `This level must be marked ${expectedKind}.`);
      let elevationMm = null;
      if (need(level?.elevation, `buildingProgram.levels.${i}.elevation`, 'Enter this finished floor elevation.'))
        if (Number(level.elevation.value) >= 0 && level.elevation.value !== '' && ['mm', 'cm', 'm', 'ft'].includes(level.elevation.unit)) {
          elevationMm = Number(level.elevation.value) * { mm: 1, cm: 10, m: 1000, ft: 304.8 }[level.elevation.unit];
          bad(!finite(elevationMm), `buildingProgram.levels.${i}.elevation`, 'Elevation must be a finite number.');
        } else invalid.push(issue('INVALID_ELEVATION', `buildingProgram.levels.${i}.elevation`, 'Elevation must be a non-negative number with a length unit.'));
      let targetAreaSqM = null;
      if (expectedKind === 'partial' && need(level?.targetArea, `buildingProgram.levels.${i}.targetArea`, 'Enter the target area of the partial top floor.'))
        targetAreaSqM = readArea(level.targetArea, `buildingProgram.levels.${i}.targetArea`);
      // A partial floor is at most 65 % of a full floor, and a full floor is smaller than the plot.
      if (targetAreaSqM && measuredPlotAreaSqM && targetAreaSqM > 0.65 * measuredPlotAreaSqM)
        invalid.push(issue('PARTIAL_AREA_TOO_LARGE', `buildingProgram.levels.${i}.targetArea`,
          `The partial top floor cannot exceed 65 % of a full floor; on this ${Math.round(measuredPlotAreaSqM)} m² plot that is well under ${Math.floor(0.65 * measuredPlotAreaSqM)} m².`));
      need(String(level?.use || '').trim(), `buildingProgram.levels.${i}.use`, 'Describe this floor’s use.');
      const counts = {};
      for (const key of ['bedrooms', 'bathrooms', 'kitchens', 'livingRooms', 'attachedBathrooms']) {
        if (need(level?.[key] !== undefined && level[key] !== '', `buildingProgram.levels.${i}.${key}`, `Enter this level’s ${key} count.`)) {
          counts[key] = Number(level[key]);
          bad(!Number.isInteger(counts[key]) || counts[key] < 0 || counts[key] > 16,
            `buildingProgram.levels.${i}.${key}`, 'Enter a whole number from 0 to 16.');
        }
      }
      bad(level?.separateDiningRoom !== undefined && typeof level.separateDiningRoom !== 'boolean',
        `buildingProgram.levels.${i}.separateDiningRoom`, 'Separate dining must be a yes/no choice.');
      bad(level?.separateDiningRoom === true && counts.kitchens < 1,
        `buildingProgram.levels.${i}.separateDiningRoom`, 'A separate dining room needs a kitchen on the same floor.');
      bad(counts.attachedBathrooms > counts.bathrooms || counts.attachedBathrooms > counts.bedrooms,
        `buildingProgram.levels.${i}.attachedBathrooms`, 'Attached bathrooms cannot exceed this level’s bedrooms or bathrooms.');
      const occupancy = level?.occupancy;
      if (need(occupancy, `buildingProgram.levels.${i}.occupancy`, 'Choose owner or rental use for each floor.'))
        bad(!['owner', 'rental'].includes(occupancy), `buildingProgram.levels.${i}.occupancy`, 'Floor use must be owner or rental.');
      const specialRooms = level?.specialRooms;
      if (need(Array.isArray(specialRooms), `buildingProgram.levels.${i}.specialRooms`, 'List special rooms for this floor, or use an empty list.'))
        bad(specialRooms.some(room => !['puja', 'guestBedroom', 'study', 'store', 'laundry'].includes(room)),
          `buildingProgram.levels.${i}.specialRooms`, 'Choose supported special rooms: puja, guestBedroom, study, store or laundry.');
      return { id, kind: level?.kind, elevationMm, targetAreaSqM, use: String(level?.use || '').trim(),
        occupancy, specialRooms, separateDiningRoom:level?.separateDiningRoom === true, ...counts };
    });
    for (let i = 1; i < levels.length; i++) if (levels[i].elevationMm != null && levels[i - 1].elevationMm != null)
      bad(levels[i].elevationMm <= levels[i - 1].elevationMm, `buildingProgram.levels.${i}.elevation`, 'Finished floor elevations must increase.');
    for (const key of ['bedrooms', 'bathrooms', 'kitchens', 'livingRooms']) if (programCounts[key] != null && levels.every(level => level[key] != null))
      bad(levels.reduce((sum, level) => sum + level[key], 0) !== programCounts[key],
        `buildingProgram.${key}`, `Total ${key} must equal the sum of the floor-by-floor counts.`);
  }
  const rental = program.rental || {};
  need(typeof rental.intended === 'boolean', 'buildingProgram.rental.intended', 'Choose whether any floors will be rented out.');
  const rentalLevels = levels.filter(level => level.occupancy === 'rental');
  const ownerLevels = levels.filter(level => level.occupancy === 'owner');
  if (rental.intended === true) {
    if (need(rental.floorCount !== undefined && rental.floorCount !== '', 'buildingProgram.rental.floorCount', 'Enter how many floors will be rented.'))
      bad(!Number.isInteger(Number(rental.floorCount)) || Number(rental.floorCount) !== rentalLevels.length,
        'buildingProgram.rental.floorCount', 'Rented floor count must match the floors marked as rental.');
    bad(!rentalLevels.length, 'buildingProgram.rental.intended', 'Mark at least one floor as rental.');
    bad(!ownerLevels.length, 'buildingProgram.levels', 'Keep at least one owner floor in this residential brief.');
    if (programCounts.households != null) bad(programCounts.households !== rentalLevels.length + 1,
      'buildingProgram.households', 'Households must equal one owner household plus one for each independent rental floor.');
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (level.occupancy !== 'rental') continue;
      for (const key of ['bedrooms', 'bathrooms', 'kitchens', 'livingRooms'])
        bad(level[key] < 1, `buildingProgram.levels.${i}.${key}`, `Rental floor ${i + 1} needs its own ${key}.`);
      bad(level.kind === 'partial', `buildingProgram.levels.${i}.kind`, 'A partial top floor cannot be an independent rental unit in this first residential contract.');
    }
    for (let i = 1; i < levels.length; i++) if (levels[i].occupancy === 'rental' && levels.slice(0, i).some(level => level.occupancy === 'owner'))
      unsupported.push(issue('RENTAL_ABOVE_OWNER_PENDING', 'buildingProgram.levels',
        'Independent rentals above owner floors need a separate reviewed access arrangement. Place rentals below the owner home for this first profile.'));
    if (rental.access?.type !== 'continuousSharedStairOutsideUnits')
      invalid.push(issue('RENTAL_ACCESS_REQUIRED', 'buildingProgram.rental.access.type',
        'Rental floors need a continuous stair outside each unit, with separate floor entries.'));
    if (rental.access?.sidePreference && !['auto', 'north', 'south', 'east', 'west'].includes(rental.access.sidePreference))
      invalid.push(issue('INVALID_STAIR_SIDE', 'buildingProgram.rental.access.sidePreference', 'Choose automatic placement or a compass-side preference.'));
  } else if (rental.intended === false) {
    bad(Number(rental.floorCount || 0) !== 0, 'buildingProgram.rental.floorCount', 'Rental count must be zero when no floors are rented.');
    bad(rentalLevels.length > 0, 'buildingProgram.levels', 'Rental floors were marked although rental intent is No.');
    bad(programCounts.households !== 1, 'buildingProgram.households', 'Without rental floors, this first residential contract describes one owner household.');
  }
  const owner = program.ownerProgram || {};
  const primaryWardrobe = owner.primaryWardrobe || 'standard';
  if (!['none', 'standard', 'walkIn'].includes(primaryWardrobe))
    invalid.push(issue('INVALID_PRIMARY_WARDROBE', 'buildingProgram.ownerProgram.primaryWardrobe',
      'Choose no wardrobe, a standard wardrobe or a walk-in for the primary bedroom.'));
  const extraWardrobes = owner.otherBedroomWardrobes === true;
  for (const key of ['bedrooms', 'bathrooms', 'attachedBathrooms', 'kitchens', 'livingRooms']) {
    if (need(owner[key] !== undefined && owner[key] !== '', `buildingProgram.ownerProgram.${key}`, `Enter the owner home’s ${key} count.`)) {
      const n = Number(owner[key]);
      bad(!Number.isInteger(n) || n < (key === 'attachedBathrooms' ? 0 : 1) || n > 16,
        `buildingProgram.ownerProgram.${key}`, 'Enter a valid whole-number room count.');
      if (ownerLevels.length && ownerLevels.every(level => level[key] != null) &&
        !(key === 'kitchens' || key === 'livingRooms' ? ownerLevels.some(level => level[key] > 0) : true))
        invalid.push(issue('OWNER_SELF_SUFFICIENCY', `buildingProgram.ownerProgram.${key}`, 'Owner floors need a kitchen and living room.'));
      if (ownerLevels.length && ownerLevels.every(level => level[key] != null) &&
        ownerLevels.reduce((sum, level) => sum + level[key], 0) !== n)
        invalid.push(issue('OWNER_TOTAL_MISMATCH', `buildingProgram.ownerProgram.${key}`, `Owner ${key} count must equal the sum of owner floors.`));
    }
  }
  const ownerSpecial = owner.specialRooms;
  bad(owner.attachedBathrooms > owner.bathrooms || owner.attachedBathrooms > owner.bedrooms,
    'buildingProgram.ownerProgram.attachedBathrooms', 'Owner attached bathrooms cannot exceed owner bedrooms or bathrooms.');
  if (need(Array.isArray(ownerSpecial), 'buildingProgram.ownerProgram.specialRooms', 'List owner special rooms, or use an empty list.')) {
    for (const room of ownerSpecial) if (!['puja', 'guestBedroom', 'study', 'store', 'laundry'].includes(room))
      invalid.push(issue('UNKNOWN_SPECIAL_ROOM', 'buildingProgram.ownerProgram.specialRooms', `Unsupported special room: ${room}.`));
    for (const room of ownerSpecial) if (!ownerLevels.some(level => level.specialRooms?.includes(room)))
      invalid.push(issue('SPECIAL_ROOM_UNPLACED', 'buildingProgram.ownerProgram.specialRooms', `${room} must be assigned to an owner floor.`));
  }
  bad(Boolean(program.puja) !== Boolean(ownerSpecial?.includes('puja')), 'buildingProgram.puja', 'Puja request must match the owner’s special-room list.');
  for (const level of ownerLevels) if (level.specialRooms?.includes('guestBedroom') && level.bedrooms < 1)
    invalid.push(issue('GUEST_BEDROOM_COUNT', 'buildingProgram.levels', 'A guest bedroom counts as a bedroom on its floor.'));
  if (ownerSpecial?.includes('guestBedroom') && Number(owner.bedrooms) < 2)
    invalid.push(issue('GUEST_BEDROOM_DISTINCT', 'buildingProgram.ownerProgram.bedrooms',
      'A guest bedroom needs a separate owner primary bedroom; request at least two owner bedrooms.'));
  const parking = program.parking || {};
  const reservoirLitres = program.services?.groundReservoirLitres == null ? 8000 : Number(program.services.groundReservoirLitres);
  bad(!Number.isSafeInteger(reservoirLitres) || reservoirLitres < 5000,
    'buildingProgram.services.groundReservoirLitres', 'Ground reservoir must hold at least 5,000 L, enough for one full water delivery truck.');
  const otherNeeds = {
    balconies: program.balconies ?? [], laundry: program.laundry ?? 'unspecified',
    roofUse: program.roofUse ?? 'unspecified', accessibility: program.accessibility ?? 'unspecified',
    utilities: program.utilities ?? 'unspecified',
  };
  if (!Array.isArray(otherNeeds.balconies)) invalid.push(issue('INVALID_BALCONIES', 'buildingProgram.balconies', 'List the levels needing balconies.'));
  else for (const id of otherNeeds.balconies) if (!levels.some(level => level.id === id))
    invalid.push(issue('UNKNOWN_BALCONY_LEVEL', 'buildingProgram.balconies', 'Balcony request refers to an unknown level ID.'));
  for (const key of ['bikes', 'cars']) {
    if (need(parking[key] !== undefined && parking[key] !== '', `buildingProgram.parking.${key}`, `Enter the number of ${key}.`))
      bad(!Number.isInteger(Number(parking[key])) || Number(parking[key]) < 0 || Number(parking[key]) > 10,
        `buildingProgram.parking.${key}`, 'Parking count must be a whole number from 0 to 10.');
  }
  const stairType = program.stair?.type || 'halfTurnLanding';
  if (!['halfTurnLanding', 'straight', 'quarterTurnLanding'].includes(stairType))
    unsupported.push(issue('STAIR_TYPE_NOT_SUPPORTED', 'buildingProgram.stair.type', 'Choose half-turn, straight or quarter-turn with landing.'));
  if (stairType !== 'halfTurnLanding') unsupported.push(issue('STAIR_TYPE_PENDING', 'buildingProgram.stair.type', 'This stair type needs a verified Nepal geometry profile.'));
  const vastuProfile = raw.vastuProfile || 'Jain-led';
  if (vastuProfile !== 'Jain-led') unsupported.push(issue('VASTU_PROFILE_NOT_REVIEWED', 'vastuProfile', 'This Vaastu interpretation needs a reviewed profile.'));
  return { brief: { version: 1, jurisdiction: { country: 'NP', municipality, ward: String(jurisdiction.ward ?? '').trim() },
    site: { shape, verticesMm: vertices, measuredAreaSqM, declaredAreaSqM, north: { bearingDegrees: bearing, evidence: north.evidence },
      frontageEdges, boundaries: normalizedBoundaries, context: siteContext },
    buildingProgram: { storeys, levels, ...programCounts, puja: program.puja,
      rental: { intended: rental.intended, floorCount: Number(rental.floorCount || 0),
        floorIds: rentalLevels.map(level => level.id), access: rental.access || null },
      ownerProgram: { ...owner, primaryWardrobe, otherBedroomWardrobes: extraWardrobes },
      parking: { bikes: Number(parking.bikes), cars: Number(parking.cars) }, stair: { type: stairType },
      services: { groundReservoirLitres: reservoirLitres, groundReservoirPreference: 'underStair' },
      ...otherNeeds }, vastuProfile,
    originalInput: raw }, missing, invalid, unsupported };
}
module.exports = { normalizeBrief, polygonArea };
