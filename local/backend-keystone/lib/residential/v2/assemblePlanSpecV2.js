'use strict';

const { makeDisplayLabels } = require('../../tile/canonicalRoomTypes');
const { resolveLevelExteriorGeometry } = require('../../planEnvelope');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function transformRect(rect, width, height, frontFacing) {
  const facing = String(frontFacing || 'South').trim().toLowerCase();
  const x = num(rect?.x);
  const y = num(rect?.y);
  const w = num(rect?.w);
  const h = num(rect?.h);

  if (facing.includes('north')) {
    return { x: width - (x + w), y: height - (y + h), w, h };
  }
  if (facing.includes('east')) {
    return { x: height - (y + h), y: x, w: h, h: w };
  }
  if (facing.includes('west')) {
    return { x: y, y: width - (x + w), w: h, h: w };
  }
  return { x, y, w, h };
}

function transformedLevelSize(level, frontFacing) {
  const facing = String(frontFacing || 'South').trim().toLowerCase();
  if (facing.includes('east') || facing.includes('west')) {
    return {
      width: num(level?.height),
      height: num(level?.width),
    };
  }
  return {
    width: num(level?.width),
    height: num(level?.height),
  };
}

function transformStairCore(level, frontFacing) {
  if (!level?.stairCore) return null;
  const transformed = transformRect(level.stairCore, num(level?.width), num(level?.height), frontFacing);
  return {
    ...level.stairCore,
    x: transformed.x,
    y: transformed.y,
    w: transformed.w,
    h: transformed.h,
  };
}

function transformRoomGeometry(room, levelWidth, levelHeight, frontFacing) {
  const transformed = transformRect(room, levelWidth, levelHeight, frontFacing);
  const payload = {
    x: transformed.x,
    y: transformed.y,
    w: transformed.w,
    h: transformed.h,
  };

  if (Array.isArray(room?.parts) && room.parts.length > 0) {
    const transformedParts = room.parts.map((part) => transformRect(part, levelWidth, levelHeight, frontFacing));
    if (transformedParts.length > 0) {
      const minX = Math.min(...transformedParts.map((part) => num(part?.x)));
      const minY = Math.min(...transformedParts.map((part) => num(part?.y)));
      const maxX = Math.max(...transformedParts.map((part) => num(part?.x) + num(part?.w)));
      const maxY = Math.max(...transformedParts.map((part) => num(part?.y) + num(part?.h)));
      payload.x = minX;
      payload.y = minY;
      payload.w = maxX - minX;
      payload.h = maxY - minY;
      payload.parts = transformedParts;
    }
  }

  return payload;
}

function assemblePlanSpecV2(layout, brief, footprint, interpretation) {
  const levels = (layout?.levels || []).map((level) => {
    const size = transformedLevelSize(level, brief?.frontFacing);
    const rooms = (level?.rooms || []).map((room) => {
      const { parts: _ignoredParts, ...roomRest } = room || {};
      const transformed = transformRoomGeometry(room, num(level?.width), num(level?.height), brief?.frontFacing);
      return {
        ...roomRest,
        ...(['kitchen','dining_room','living_room'].includes(room.type) ? { openConcept: Boolean(brief.openConcept) } : {}),
        x: transformed.x,
        y: transformed.y,
        w: transformed.w,
        h: transformed.h,
        ...(transformed.parts ? { parts: transformed.parts } : {}),
      };
    });

    const levelSpec = {
      level: num(level?.level, 1),
      width: size.width,
      height: size.height,
      rooms,
      doors: [],
      windows: [],
      stairCore: transformStairCore(level, brief?.frontFacing),
    };
    const exteriorGeometry = resolveLevelExteriorGeometry(levelSpec);
    levelSpec.outlineSegments = exteriorGeometry.segments;
    levelSpec.envelopeAreaSqFt = exteriorGeometry.areaSqFt;
    return levelSpec;
  });

  // Transform envelope void rects to match front-facing orientation
  const rawVoidRects = Array.isArray(footprint?.envelopeVoidRects) ? footprint.envelopeVoidRects : [];
  const envelopeShape = String(footprint?.envelopeShape || 'RECTANGULAR');
  const transformedVoidRects = rawVoidRects.map(
    (rect) => transformRect(rect, num(footprint?.widthFt), num(footprint?.heightFt), brief?.frontFacing)
  );

  const planSpec = {
    stories: num(brief?.stories, interpretation?.stories || 1),
    totalAreaSqFt: num(brief?.totalAreaSqFt),
    tileSizeFt: 2,
    frontFacing: String(brief?.frontFacing || 'South').toUpperCase(),
    openConcept: Boolean(brief?.openConcept),
    generatorId: 'architect_v2',
    featureProgramVersion: 1,
    supportTier: interpretation?.supportTier || 'wave1',
    housePattern: interpretation?.housePattern || null,
    variationId: String(footprint?.variationId || 'variant_a_compact_core'),
    variationLabel: String(footprint?.variationLabel || 'Compact Core'),
    variationTheme: String(footprint?.variationTheme || 'balanced_compact'),
    functionalId: String(footprint?.functionalId || 'front_core_compact'),
    functionalLabel: String(footprint?.functionalLabel || 'Front Core — Compact'),
    envelopeShape,
    envelopeVoidRects: transformedVoidRects,
    levels,
  };

  return makeDisplayLabels(planSpec);
}

module.exports = {
  assemblePlanSpecV2,
};
