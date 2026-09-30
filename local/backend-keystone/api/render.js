// backend/api/render.js
// Plan-grounded Gemini render endpoint.
// Full renders MUST be conditioned on the generated floor-plan PNG so the
// exterior massing stays faithful to the actual plan.
// This version also explicitly forbids collage / diptych / stacked outputs.

const { GoogleGenAI } = require('@google/genai');
const { attachRender } = require('../lib/gallery');
const { resolve: resolveRenderPreferences } = require('../lib/renderPreferences');
const { isOutdoorType } = require('../lib/tile/canonicalRoomTypes');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8'));
  return req.body;
}

function parseDataUri(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function clampText(value, max = 160) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalizeRoomType(type) {
  const raw = String(type || '').toLowerCase();
  if (!raw) return 'room';
  if (raw.includes('primary_bedroom')) return 'primary bedroom';
  if (raw.includes('bedroom')) return 'bedroom';
  if (raw.includes('primary_bathroom')) return 'primary bathroom';
  if (raw.includes('bath')) return 'bathroom';
  if (raw.includes('great_room')) return 'great room';
  if (raw.includes('living')) return 'living room';
  if (raw.includes('family')) return 'family room';
  if (raw.includes('kitchen')) return 'kitchen';
  if (raw.includes('dining')) return 'dining room';
  if (raw.includes('garage')) return 'garage';
  if (raw.includes('entry') || raw.includes('foyer')) return 'entry';
  if (raw.includes('stairs')) return 'stairs';
  if (raw.includes('hall')) return 'hallway';
  if (raw.includes('laundry')) return 'laundry';
  if (raw.includes('office') || raw.includes('study')) return 'office';
  if (raw.includes('mud')) return 'mudroom';
  if (raw.includes('storage')) return 'storage';
  return raw.replace(/_/g, ' ');
}

function roomArea(room) {
  if (Array.isArray(room?.parts) && room.parts.length) return room.parts.reduce((sum, part) => sum + Number(part.w || 0) * Number(part.h || 0), 0);
  return Number(room?.w || 0) * Number(room?.h || 0);
}

function roomCenter(room) {
  return {
    x: Number(room?.x || 0) + Number(room?.w || 0) / 2,
    y: Number(room?.y || 0) + Number(room?.h || 0) / 2,
  };
}

function describeLevelEdges(level, facing = 'South') {
  const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
  const width = Number(level?.width || 0);
  const height = Number(level?.height || 0);
  if (!rooms.length || !width || !height) return 'No edge data available.';

  const edgeTolerance = 3;
  const byEdge = { front: [], rear: [], left: [], right: [] };

  for (const room of rooms) {
    const type = normalizeRoomType(room.type);
    const cx = roomCenter(room).x;
    const cy = roomCenter(room).y;
    const entry = { room, type, cx, cy, area: roomArea(room) };

    if (Number(room.y || 0) <= edgeTolerance) byEdge.front.push(entry);
    if (Number(room.x || 0) <= edgeTolerance) byEdge.left.push(entry);
    if (Number(room.x || 0) + Number(room.w || 0) >= width - edgeTolerance) byEdge.right.push(entry);
    if (Number(room.y || 0) + Number(room.h || 0) >= height - edgeTolerance) byEdge.rear.push(entry);
  }

  const sorters = {
    front: (a, b) => a.cx - b.cx,
    rear: (a, b) => a.cx - b.cx,
    left: (a, b) => a.cy - b.cy,
    right: (a, b) => a.cy - b.cy,
  };

  const formatEdge = (edgeName) => {
    const items = byEdge[edgeName]
      .sort(sorters[edgeName])
      .filter((item, index, arr) => index === arr.findIndex((other) => other.room.id === item.room.id))
      .slice(0, 8)
      .map((item) => item.type);

    const label = edgeLabel({ front: 'top', rear: 'bottom', left: 'left', right: 'right' }[edgeName], facing);
    return `${label}: ${items.length ? items.join(', ') : 'none'}`;
  };

  return [formatEdge('front'), formatEdge('left'), formatEdge('right'), formatEdge('rear')].join('; ');
}

function summarizePlanGeometry(planSpec, facing = 'South') {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  if (!levels.length) return 'No plan geometry available.';

  const parts = levels.map((level) => {
    const levelNo = Number(level?.level || 0) || 1;
    const width = Number(level?.width || 0);
    const height = Number(level?.height || 0);
    const envelopeArea = Number(level?.envelopeAreaSqFt || 0);
    const rooms = Array.isArray(level?.rooms) ? level.rooms : [];
    const majorRooms = [...rooms]
      .sort((a, b) => roomArea(b) - roomArea(a))
      .slice(0, 8)
      .map((room) => normalizeRoomType(room.type));

    return `Level ${levelNo}: bounding box ${width}ft x ${height}ft, actual envelope area ${Math.round(envelopeArea || (width * height))} sqft; major rooms: ${majorRooms.join(', ') || 'none'}; perimeter layout: ${describeLevelEdges(level, facing)}.`;
  });

  const allRooms = levels.flatMap((level) => level.rooms || []);
  const garage = allRooms.find((room) => normalizeRoomType(room.type) === 'garage');
  const entry = allRooms.find((room) => normalizeRoomType(room.type) === 'entry');
  const stairs = allRooms.find((room) => normalizeRoomType(room.type) === 'stairs');

  if (garage) {
    const c = roomCenter(garage);
    parts.push(`Garage placement: level ${garage.level || 1}, centered around (${c.x.toFixed(1)}ft, ${c.y.toFixed(1)}ft). Preserve the garage side and frontage from the plan image.`);
  }
  if (entry) {
    const c = roomCenter(entry);
    parts.push(`Primary entry placement: level ${entry.level || 1}, centered around (${c.x.toFixed(1)}ft, ${c.y.toFixed(1)}ft). Keep the entry on this same exterior side.`);
  }
  if (stairs) {
    const c = roomCenter(stairs);
    parts.push(`Stairs massing cue: level ${stairs.level || 1}, centered around (${c.x.toFixed(1)}ft, ${c.y.toFixed(1)}ft). Reflect the second-story massing above this zone if stories = 2.`);
  }

  return parts.join(' ');
}

function summarizeBuildingModel(planSpec) {
  const archetype = planSpec?.archetype?.label || planSpec?.archetype?.id || 'Unknown archetype';
  const levelZones = (planSpec?.zones || [])
    .map((level) => {
      const zoneNames = (level?.zones || []).map((zone) => zone.zone).join(', ');
      return `L${level.level}: ${zoneNames || 'none'}`;
    })
    .join('; ');
  const stairCore = (planSpec?.stairCore || [])
    .map((core) => `L${core.level} stairs x=${core.x}ft w=${core.w}ft dir=${core.direction || 'unknown'} landing=${core.landingSide || 'hall'}`)
    .join('; ');
  const vertical = (planSpec?.verticalModel?.levels || [])
    .map((level) => `L${level.level} z=${level.floorZFt}-${level.ceilingZFt}ft clear=${level.clearHeightFt}ft`)
    .join('; ');
  return `Archetype: ${archetype}. Zones: ${levelZones || 'not available'}. Stair core: ${stairCore || 'not available'}. Vertical profile: ${vertical || 'not available'}.`;
}

function summarizeFrontElevation(planSpec) {
  const frontSvg = String(planSpec?.elevations?.frontSvg || '');
  if (!frontSvg) return 'No deterministic front elevation available.';
  const levelCount = Array.isArray(planSpec?.levels) ? planSpec.levels.length : 0;
  const garagePresent = frontSvg.includes('garage');
  return `A deterministic front elevation is available for ${levelCount} level(s)${garagePresent ? ', including a visible garage bay' : ''}. Preserve that front-facing composition in the render.`;
}

function summarizeElevationPackage(planSpec) {
  const meta = planSpec?.elevations?.meta || {};
  if (!planSpec?.elevations?.frontSvg) return 'No deterministic elevation package is available.';
  const styleLabel = meta?.styleLabel || 'Residential';
  const roofKind = String(meta?.roofKind || 'gabled').replace(/_/g, ' ');
  const supportView = meta?.supportViewKey || 'side';
  const supportFacing = meta?.supportFacing || supportView;
  return `Deterministic elevations are available in a ${styleLabel.toLowerCase()} style with a ${roofKind} roof profile. Use the front elevation for facade composition and the ${supportView} elevation facing ${supportFacing} for side-wall depth, roof rake, and secondary openings.`;
}

function frontEdgeForFacing(frontFacing) {
  const facing = safeLower(frontFacing);
  if (facing.includes('north')) return 'top';
  if (facing.includes('south')) return 'bottom';
  if (facing.includes('east')) return 'right';
  if (facing.includes('west')) return 'left';
  return 'bottom';
}

function edgeLabel(edge, frontFacing = 'South') {
  const frontEdge = frontEdgeForFacing(frontFacing);
  const relation = String(edge || '').toLowerCase();
  if (!relation || relation === 'unknown') return 'unknown';
  if (relation === frontEdge) return `front/${relation}`;
  if (relation === (frontEdge === 'top' ? 'bottom' : frontEdge === 'bottom' ? 'top' : frontEdge === 'left' ? 'right' : 'left')) return `rear/${relation}`;
  return relation;
}

function inferRoomEdge(room, level) {
  if (!room || !level) return null;
  const width = Number(level?.width || 0);
  const height = Number(level?.height || 0);
  if (!width || !height) return null;

  const tol = Math.max(1.5, Math.min(width, height) * 0.04);
  const x = Number(room?.x || 0);
  const y = Number(room?.y || 0);
  const x2 = x + Number(room?.w || 0);
  const y2 = y + Number(room?.h || 0);

  const edges = [];
  if (y <= tol) edges.push('top');
  if (x2 >= width - tol) edges.push('right');
  if (y2 >= height - tol) edges.push('bottom');
  if (x <= tol) edges.push('left');

  if (!edges.length) return null;
  if (edges.length === 1) return edges[0];
  const dist = {
    top: Math.abs(y - 0),
    right: Math.abs(width - x2),
    bottom: Math.abs(height - y2),
    left: Math.abs(x - 0),
  };

  return edges.reduce((best, edge) => (dist[edge] < dist[best] ? edge : best), edges[0]);
}

function buildIdentityLockBlock(planSpec, surveyData) {
  const sd = surveyData || {};
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  const level1 = levels.find((level) => Number(level?.level || 0) === 1) || levels[0] || null;
  const width = Number(level1?.width || 0);
  const depth = Number(level1?.height || 0);
  const ratio = width && depth ? (width / depth) : null;
  const storyText = levels.length ? `${levels.length} stories` : String(planSpec?.stories || sd?.stories || '1 Story').trim();

  const frontFacing = planSpec?.facade?.frontFacing || sd?.frontFacing || 'South';
  const frontEdge = planSpec?.facade?.frontEdge || frontEdgeForFacing(frontFacing);
  const roofKind = String(planSpec?.elevations?.meta?.roofKind || 'gabled').replace(/_/g, ' ');

  const allRooms = levels.flatMap((level) => (Array.isArray(level?.rooms) ? level.rooms.map((room) => ({ room, level })) : []));
  const garageEntry = allRooms.find(({ room }) => normalizeRoomType(room?.type) === 'garage') || null;
  const mainEntry = allRooms.find(({ room }) => normalizeRoomType(room?.type) === 'entry') || null;

  const doorEdge = (entry, flag) => {
    if (!entry) return null;
    const door = (entry.level.doors || []).find(d => d[flag] && (d.a === entry.room.id || d.b === entry.room.id));
    if (!door) return inferRoomEdge(entry.room, entry.level);
    return door.dir === 'vertical'
      ? (Number(door.x) < Number(entry.room.x) + Number(entry.room.w) / 2 ? 'left' : 'right')
      : (Number(door.y) < Number(entry.room.y) + Number(entry.room.h) / 2 ? 'top' : 'bottom');
  };
  const garageEdge = doorEdge(garageEntry, 'garageDoor');
  const entryEdge = doorEdge(mainEntry, 'isMainEntry');

  const garageLabel = garageEdge ? edgeLabel(garageEdge, frontFacing) : 'unknown';
  const entryLabel = entryEdge ? edgeLabel(entryEdge, frontFacing) : 'unknown';

  const widthText = width && depth
    ? `${width.toFixed(1)}ft wide x ${depth.toFixed(1)}ft deep`
    : 'unknown footprint';
  const ratioText = ratio ? `${ratio.toFixed(2)}:1` : 'unknown';

  return [
    `Identity lock: ${storyText}, footprint ${widthText}, width/depth ratio ${ratioText}, front facade ${frontFacing} (${frontEdge} edge), garage side ${garageLabel}, entry side ${entryLabel}, roof profile ${roofKind}.`,
    'Hard no-drift constraints: keep the exact garage location, entry location, door openings, story count, footprint width/depth ratio, and roof profile shown in the plan/elevation references.',
    'If the survey text conflicts with the plan or elevations, the plan and elevations win.',
  ].join(' ');
}

function buildStyleDescription(materials, budget) {
  const mat = safeLower(materials);
  const bud = safeLower(budget);

  if ((mat.includes('modern') && !mat.includes('farmhouse')) || mat.includes('concrete') || mat.includes('steel') || mat.includes('minimalist')) {
    return 'contemporary modern home with exposed concrete, steel accents, large glazing, and crisp minimalist detailing';
  }
  if (mat.includes('mediterranean') || mat.includes('stucco')) {
    return 'Mediterranean-style home with smooth stucco walls, arched openings, warm plaster tones, and clay or tile roof cues';
  }
  if (mat.includes('colonial') || mat.includes('traditional') || mat.includes('brick') || (mat.includes('stone') && !mat.includes('craftsman'))) {
    return 'traditional home with brick and stone facade, punched windows, and more classical residential proportions';
  }
  if (mat.includes('farmhouse') || mat.includes('rustic') || mat.includes('board')) {
    return bud.includes('lux')
      ? 'luxury modern farmhouse with board-and-batten siding, black window frames, and refined entry detailing'
      : 'farmhouse-inspired home with board-and-batten siding, simple trim, and simple gabled forms';
  }
  if (mat.includes('craftsman') || mat.includes('wood') || mat.includes('natural')) {
    return bud.includes('lux')
      ? 'luxury craftsman home with cedar siding, heavy timber accents, stone base elements, and rich trim detail'
      : 'craftsman-influenced home with natural wood accents, stone wainscot, and warm residential character';
  }
  return 'well-resolved residential exterior with believable materials and regionally appropriate detailing';
}

// Every style's finish spec names a porch or portico type, but the generator
// places no outdoor structures: the entry expression is only described when the
// plan really has a porch room; otherwise the prompt would ask for one while
// also forbidding porches the plan does not support.
function buildStructuredMaterialSpec(finishSpec, { planHasPorch = false } = {}) {
  if (!finishSpec || typeof finishSpec !== 'object') return null;
  const lines = [];
  const ext = finishSpec.exterior || {};
  const roof = finishSpec.roofing || {};
  const win = finishSpec.windows || {};
  const entry = finishSpec.entryExpression || {};

  if (ext.primaryCladding?.label) {
    lines.push(`Primary cladding: ${ext.primaryCladding.label} siding`);
  }
  if (ext.accentCladding?.label) {
    lines.push(`Accent cladding: ${ext.accentCladding.label} at foundation zone and entry accent areas`);
  }
  if (ext.trim?.material) {
    const trimLabel = String(ext.trim.material).replace(/_/g, ' ');
    lines.push(`Exterior trim: ${trimLabel}`);
  }
  if (roof.label) {
    lines.push(`Roofing: ${roof.label}`);
  }
  if (win.frameType) {
    const frame = String(win.frameType).replace(/_/g, ' ');
    const mullion = win.mullionPattern && win.mullionPattern !== 'none'
      ? `, ${String(win.mullionPattern).replace(/_/g, ' ')} mullion pattern`
      : '';
    lines.push(`Windows: ${frame} frame${mullion}`);
  }
  if (entry.porchType && !planHasPorch) {
    lines.push("Entry: the plan's main door with style-appropriate trim; no porch, portico or covered entry (the plan has none)");
  } else if (entry.porchType) {
    const porch = String(entry.porchType).replace(/_/g, ' ');
    const col = entry.columnStyle && entry.columnStyle !== 'none'
      ? ` with ${String(entry.columnStyle).replace(/_/g, ' ')} columns`
      : '';
    lines.push(`Entry: ${porch}${col}`);
  }
  if (lines.length === 0) return null;
  return lines.join('. ') + '.';
}

function buildRoofDescription(roofStyle, ceiling) {
  const roof = safeLower(roofStyle);
  const ceil = safeLower(ceiling);
  if (roof.includes('flat')) return 'flat or very low-slope roof';
  if (roof.includes('metal')) return 'standing-seam metal roof';
  if (roof.includes('hip')) return 'hip roof';
  if (roof.includes('gable')) return 'gable roof';
  if (roof.includes('terracotta') || roof.includes('tile')) return 'clay tile roof';
  if (roof.includes('cathedral') || roof.includes('vault')) return 'expressive vaulted roofline';
  if (roofStyle) return clampText(roofStyle, 80);
  if (ceil.includes('cathedral') || ceil.includes('vault')) return 'expressive vaulted roofline';
  return 'roof form appropriate to the chosen style and exact plan massing';
}

function buildLightingDescription(facing, season, timeOfDay, weather, lightingHint) {
  if (lightingHint) return lightingHint;

  const face = String(facing || 'South');
  const facingLight = face === 'South'
    ? 'bright southern light on the front facade'
    : face === 'North'
      ? 'soft diffused northern light on the front facade'
      : face === 'East'
        ? 'warm morning light on the front facade'
        : 'late-afternoon light on the front facade';

  const tod = String(timeOfDay || 'Midday');
  let timeDesc = `${String(season || 'Summer')} season, ${tod.toLowerCase()} light`;
  if (tod === 'Golden Hour') timeDesc = 'warm golden hour light with long shadows';
  else if (tod === 'Night') timeDesc = 'night scene with warm interior glow and restrained exterior lighting';
  else if (tod === 'Overcast') timeDesc = 'overcast sky with soft diffuse shadows';
  else if (tod === 'Sunrise') timeDesc = 'sunrise sky with pink-orange tones and long shadows';
  else if (tod === 'Midday') timeDesc = 'bright midday sun with crisp shadows';

  const weatherDesc = String(weather || '').trim();
  const diffuseWeather = /overcast|storm|snowy/i.test(weatherDesc) || tod === 'Overcast';
  if (diffuseWeather && tod === 'Midday') timeDesc = 'midday with diffuse daylight and soft shadows';
  const directionalLight = tod === 'Night' ? '' : diffuseWeather ? 'diffuse ambient light' : facingLight;
  return `${String(season || 'Summer')} season; ${directionalLight ? `${directionalLight}; ` : ''}${timeDesc}${weatherDesc ? `; ${weatherDesc.toLowerCase()}` : ''}`;
}

function buildSiteDescription(renderSurveyData, surveyData) {
  const rd = renderSurveyData || {};
  const sd = surveyData || {};
  const lotContext = String(rd?.lotContext || sd?.lotContext || 'Suburban standard lot');
  const surroundings = String(rd?.surroundings || '');
  const landscaping = String(rd?.landscaping || 'Manicured lawn with foundation plantings');
  const contextDensity = String(rd?.contextDensity || '');
  const topography = String(rd?.topography || '');
  const drivewayStyle = String(rd?.drivewayStyle || '');
  const zipCode = String(rd?.zipCode || '');

  let lotDesc = 'well-kept suburban lot';
  const lot = safeLower(lotContext);
  if (/\burban\b/.test(lot) || lot.includes('tight')) lotDesc = 'tight urban lot with close neighbors';
  else if (lot.includes('rural') || lot.includes('acreage')) lotDesc = 'rural or acreage lot with open surroundings';
  else if (lot.includes('corner')) lotDesc = 'corner suburban lot';
  else if (lot.includes('hillside')) lotDesc = 'hillside site';
  else if (lot.includes('view')) lotDesc = 'view-focused site';
  else if (lot.includes('waterfront') || lot.includes('lake') || lot.includes('beach')) lotDesc = 'waterfront or water-adjacent lot';
  else if (lot.includes('cul-de-sac')) lotDesc = 'cul-de-sac suburban lot';

  const extras = [];
  if (zipCode) extras.push(`Zip code context: ${zipCode}.`);
  if (contextDensity) extras.push(`Neighborhood context: ${clampText(contextDensity, 120)}.`);
  if (topography) extras.push(`Topography: ${clampText(topography, 120)}.`);
  if (drivewayStyle) extras.push(`Driveway and hardscape: ${clampText(drivewayStyle, 120)}.`);
  if (surroundings) extras.push(`Surroundings: ${clampText(surroundings, 120)}.`);
  if (landscaping) extras.push(`Landscape direction: ${clampText(landscaping, 120)}.`);

  return `Site context: ${lotDesc}. ${extras.join(' ')}`.trim();
}

function buildSingleImageGuardText() {
  return [
    'Output exactly ONE image.',
    'Do not create a collage, diptych, triptych, split-screen, storyboard, stacked render, before/after comparison, sheet layout, or multiple camera views in one frame.',
    'The final output must be one single full-frame exterior rendering only.',
    'Do not place white gutters, separators, borders, title blocks, captions, contact sheets, or duplicate renders anywhere in the image.',
  ].join(' ');
}

function buildPlanGroundedPrompt({ surveyData, renderSurveyData, planSpec, lightingHint, referenceImageCount = 1, elevationReferenceMode = 'sheet' }) {
  const sd = surveyData || {};
  const rd = resolveRenderPreferences(sd, renderSurveyData, planSpec);

  const levels = planSpec?.levels || [];
  const rooms = levels.flatMap(level => level.rooms || []);
  const stories = levels.length || parseInt(planSpec?.stories || sd?.stories, 10) || 1;
  const garageRoom = rooms.find(room => room.type === 'garage');
  const garage = levels.length ? (garageRoom ? garageRoom.label || 'Attached garage' : 'None') : sd?.garage || 'None';
  const materials = sd?.materials || 'Wood Framing with Natural Finishes';
  const facing = planSpec?.facade?.frontFacing || sd?.frontFacing || 'South';
  const sqft = planSpec?.totalAreaSqFt || sd?.totalArea || '2000';
  const beds = levels.length ? `${rooms.filter(room => /^(primary_bedroom|bedroom|guest_bedroom)$/.test(room.type)).length} bedrooms` : sd?.bedrooms || '3 Bed';
  const baths = levels.length ? `${rooms.filter(room => /^(primary_bathroom|bathroom|powder_room)$/.test(room.type)).length} bathrooms (including any powder room)` : sd?.bathrooms || '2 Bath';
  const budget = sd?.budgetTier || 'Mid ($200–300/sqft)';
  const naturalLight = sd?.naturalLight || 'Balanced windows';
  const indoorOut = sd?.indoorOutdoor || 'Moderate (some connection)';
  const ceiling = sd?.ceilingHeight || 'Standard (9 ft)';
  const shape = sd?.shape || 'Rectangular';
  const roofStyle = planSpec?.elevations?.meta?.roofKind || '';

  const renderFinishSpec = structuredClone(planSpec?.finishSpec || {});
  renderFinishSpec.exterior = { ...renderFinishSpec.exterior, primaryCladding: { label: rd.exteriorSiding } };
  renderFinishSpec.roofing = { ...renderFinishSpec.roofing, label: rd.roofMaterial };
  const planHasPorch = rooms.some(room => isOutdoorType(room.type));
  const structuredMaterialDesc = buildStructuredMaterialSpec(renderFinishSpec, { planHasPorch });
  const styleDesc = structuredMaterialDesc || buildStyleDescription(materials, budget);
  const roofDesc = buildRoofDescription(roofStyle, ceiling);
  const lightingDesc = buildLightingDescription(facing, rd?.season || 'Summer', rd?.timeOfDay || 'Midday', rd?.weather || '', lightingHint);
  const siteDesc = buildSiteDescription(rd, surveyData);
  const geometryDesc = summarizePlanGeometry(planSpec, facing);
  const modelDesc = summarizeBuildingModel(planSpec);
  const elevationDesc = summarizeFrontElevation(planSpec);
  const elevationPackageDesc = summarizeElevationPackage(planSpec);
  const identityLockDesc = buildIdentityLockBlock(planSpec, sd);
  const openingSchedule = levels.map((level, index) => `Level ${level.level || index + 1}: ${[
    ...(level.windows || []).map(w => `window at (${w.x},${w.y})ft, ${w.dir}, width ${w.width || 3}ft`),
    ...(level.doors || []).filter(d => d.exterior || ['outside', '__exterior__'].includes(d.a) || ['outside', '__exterior__'].includes(d.b)).map(d => `exterior ${d.garageDoor ? 'garage door' : 'door'} at (${d.x},${d.y})ft, ${d.dir}, width ${d.width || d.doorWidth || 3}ft`),
  ].join('; ')}`).join(' | ');

  const glazingDesc = 'the exact window positions and widths in the opening schedule and elevations';

  const garageDesc = safeLower(garage).includes('none')
    ? 'no garage'
    : safeLower(garage).includes('2')
      ? 'attached two-car garage'
      : garage;

  return [
    'Create a photorealistic exterior 3D render of the EXACT house shown in the attached floor-plan image.',
    buildSingleImageGuardText(),
    referenceImageCount > 1 && elevationReferenceMode === 'sheet'
      ? 'The attached reference images are ordered as follows: image 1 is the generated floor plan, and image 2 is a combined deterministic elevation sheet containing front, rear, left, and right elevations.'
      : referenceImageCount > 1
      ? `The attached reference images are ordered as follows: image 1 is the generated floor plan, and images 2-${referenceImageCount} are deterministic elevations.`
      : 'The attached reference image is the generated floor plan.',
    'The plan image is the primary source of truth for footprint, actual exterior envelope, massing, garage placement, entry location, and which rooms touch exterior walls.',
    elevationReferenceMode === 'sheet'
      ? 'The elevation sheet is a secondary structural reference for roof profile, front-facade composition, entry expression, garage-door treatment, window rhythm, and side-wall proportions. Use it as a technical reference only; do not recreate the sheet itself.'
      : 'The elevation images are secondary structural references for roof profile, front-facade composition, entry expression, garage-door treatment, window rhythm, and side-wall proportions.',
    identityLockDesc,
    'Do not invent a different house. Do not mirror the plan. Do not rotate the massing arbitrarily. Do not add or remove wings, porches, garages, bump-outs, dormers, or roof volumes that are not supported by the plan.',
    'Do not move exterior doors, entry locations, or the garage to a different side. Do not change the roofline or roof pitch away from the elevation references. Do not alter the width/depth ratio or footprint proportions.',
    'Use the base survey for architectural style and intent. Use the effective render settings below for exterior finishes, site context, and lighting, including explicit user overrides. Finish overrides change surface materials only, never roof shape or opening positions. Neither survey may override the actual plan geometry.',
    'Very important: preserve the outer-room placement from the plan. Exterior-facing rooms and their side-of-house relationships must remain consistent with the plan image.',
    `Program summary: ${stories} stories, about ${sqft} sqft, ${beds}, ${baths}, ${garageDesc}, requested shape ${shape}.`,
    `Architectural style family: ${materials}. Retain this character with the effective finishes below.`,
    structuredMaterialDesc
      ? `MATERIALS SPECIFICATION: ${styleDesc} Roof: ${roofDesc}. Window placement: ${glazingDesc}. MATERIAL LOCK: The exterior must show EXACTLY the materials listed above. Do not substitute different cladding, roofing, or window frame materials. Match the specified finishes precisely.`
      : `Style direction: ${styleDesc}. Roof direction: ${roofDesc}. Window direction: ${glazingDesc}.`,
    `Lighting direction: ${lightingDesc}.`,
    siteDesc,
    `Plan geometry summary: ${geometryDesc}`,
    `Opening schedule, coordinates measured from the plan top-left: ${openingSchedule}. Preserve every visible opening position and width; do not add glazing to satisfy a style preference.`,
    `Survey intent: ${clampText(sd.indoorOutdoor, 100)}; ${clampText(sd.naturalLight, 100)}; outdoor living: ${clampText(sd.outdoorLiving || 'None', 100)}. Reproduce outdoor spaces only where present in the plan. Lot dimensions: ${clampText(sd.lotWidth || 'unspecified', 40)}ft by ${clampText(sd.lotDepth || 'unspecified', 40)}ft.`,
    `Building model summary: ${modelDesc}`,
    elevationDesc,
    elevationPackageDesc,
    'If the elevation references show a specific gable, hip, parapet, porch, or garage composition, preserve that exactly. Do not simplify the roofline into a generic suburban roof.',
    'Camera/view: one single front exterior architectural perspective from the street, eye-level or slightly elevated, wide enough to show the full front facade.',
    'Output should look like a premium architectural visualization, but must stay plan-faithful first and beautiful second.',
    'No text overlays, no labels, no watermarks, no people, and no visible cars unless a driveway context absolutely requires one, in which case keep it unobtrusive.'
  ].join(' ');
}

function buildLightingEditPrompt(lightingHint) {
  return [
    'You are an architectural visualization editor.',
    'The provided image is already the correct house.',
    buildSingleImageGuardText(),
    'Re-render this EXACT same exterior with ONLY the lighting, sky, shadow softness, and ambient mood changed.',
    'Do not alter the architecture, room massing, facade composition, windows, doors, garage, materials, landscaping layout, camera position, or any structural element.',
    `New lighting target: ${lightingHint}.`,
    'The house must remain identical.'
  ].join(' ');
}

async function generateImageFromGemini(ai, { prompt, inlineImages }) {
  const imageModels = [
    process.env.GEMINI_RENDER_MODEL || 'gemini-3-pro-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image-preview',
  ];

  let imageBase64 = null;
  let mimeType = 'image/jpeg';

  const parts = [{ text: prompt }];
  for (const img of inlineImages || []) {
    if (img?.mimeType && img?.data) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }

  for (const model of imageModels) {
    if (imageBase64) break;
    try {
      console.log(`[render] trying ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts }],
        config: {
          responseModalities: ['Text', 'Image'],
          temperature: 0.2,
          imageConfig: { imageSize: '2K', aspectRatio: '16:9' },
        },
      });

      const outParts = response?.candidates?.[0]?.content?.parts || [];
      for (const part of outParts) {
        if (!part.thought && part.inlineData?.mimeType?.startsWith('image/')) {
          imageBase64 = part.inlineData.data;
          mimeType = part.inlineData.mimeType;
          break;
        }
      }
      if (imageBase64) console.log(`[render] ${model} succeeded`);
    } catch (error) {
      console.log(`[render] ${model} failed:`, error?.message || error);
    }
  }

  return imageBase64 ? { imageBase64, mimeType } : null;
}

module.exports = async function renderHandler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      message: 'GEMINI_API_KEY / GOOGLE_API_KEY not set on the server.',
    });
  }

  try {
    const body = parseJsonBody(req);
    const surveyData = body?.surveyData || {};
    const renderSurveyData = body?.renderSurveyData || {};
    const planSpec = body?.planSpec || {};
    const galleryId = body?.galleryId || null;
    const lightingHint = body?.lightingHint || null;
    const existingRenderImage = body?.existingRenderImage || null;
    const planImage = body?.planImage || body?.planPng || null;
    const elevationImages = body?.elevationImages || {};
    const elevationSheetImage = body?.elevationSheetImage || null;

    const ai = new GoogleGenAI({ apiKey });

    let imageBase64 = null;
    let mimeType = 'image/jpeg';

    if (lightingHint && existingRenderImage) {
      const parsedExisting = parseDataUri(existingRenderImage);
      if (!parsedExisting) {
        return res.status(400).json({
          success: false,
          message: 'existingRenderImage must be a base64 data URI when using lighting refinements.',
        });
      }

      console.log('[render] lighting-only edit mode');
      const edited = await generateImageFromGemini(ai, {
        prompt: buildLightingEditPrompt(lightingHint),
        inlineImages: [parsedExisting],
      });

      if (edited) {
        imageBase64 = edited.imageBase64;
        mimeType = edited.mimeType;
      }
    }

    if (!imageBase64) {
      const parsedPlan = parseDataUri(planImage);
      if (!parsedPlan) {
        return res.status(400).json({
          success: false,
          message: 'planImage (PNG data URI of the generated floor plan) is required for full 3D renders.',
        });
      }

      const parsedElevationSheet = parseDataUri(elevationSheetImage);
      const parsedElevations = parsedElevationSheet
        ? [{ key: 'sheet', parsed: parsedElevationSheet }]
        : [
            { key: 'front', parsed: parseDataUri(elevationImages?.front || null) },
            { key: 'support', parsed: parseDataUri(elevationImages?.support || null) },
          ].filter((entry) => entry.parsed && entry.parsed.mimeType && entry.parsed.data);

      const prompt = buildPlanGroundedPrompt({
        surveyData,
        renderSurveyData,
        planSpec,
        lightingHint: lightingHint && !existingRenderImage ? lightingHint : null,
        referenceImageCount: 1 + parsedElevations.length,
        elevationReferenceMode: parsedElevationSheet ? 'sheet' : 'separate',
      });

      console.log('[render] plan-grounded prompt:', prompt.slice(0, 500), '...');

      const generated = await generateImageFromGemini(ai, {
        prompt,
        inlineImages: [parsedPlan, ...parsedElevations.map((entry) => entry.parsed)],
      });

      if (generated) {
        imageBase64 = generated.imageBase64;
        mimeType = generated.mimeType;
      }
    }

    if (!imageBase64) {
      return res.status(500).json({
        success: false,
        message: 'All Gemini image generation models failed. Check server logs for details.',
      });
    }

    const imageDataUri = `data:${mimeType};base64,${imageBase64}`;
    if (galleryId) await attachRender(galleryId, imageDataUri);

    return res.status(200).json({
      success: true,
      image: imageDataUri,
    });
  } catch (err) {
    console.error('[render] unexpected error:', err);
    return res.status(500).json({
      success: false,
      message: `Render failed: ${err?.message || String(err)}`,
    });
  }
};

module.exports.buildPlanGroundedPrompt = buildPlanGroundedPrompt;
module.exports.buildStyleDescription = buildStyleDescription;
module.exports.describeLevelEdges = describeLevelEdges;
