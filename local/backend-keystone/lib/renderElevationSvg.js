'use strict';
const { doorHeight: openingDoorHeight, windowHeights } = require('./openingPresentation');
const { PRODUCT_NAME } = require('./brand');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EDGE_ORDER = ['top', 'right', 'bottom', 'left'];

function rotateEdge(edge, steps) {
  const index = EDGE_ORDER.indexOf(String(edge || 'bottom'));
  const safeIndex = index >= 0 ? index : 2;
  return EDGE_ORDER[(safeIndex + steps + EDGE_ORDER.length) % EDGE_ORDER.length];
}

function relativeViewToEdge(frontEdge, viewKey) {
  if (viewKey === 'front') return frontEdge;
  if (viewKey === 'rear') return rotateEdge(frontEdge, 2);
  if (viewKey === 'right') return rotateEdge(frontEdge, 1);
  return rotateEdge(frontEdge, -1);
}

function frontEdgeOffset(frontIndex, offset) {
  const cardinal = ['north', 'east', 'south', 'west'];
  return cardinal[(frontIndex + offset + cardinal.length) % cardinal.length];
}

function getFacingLabelForView(frontFacing, viewKey) {
  const base = String(frontFacing || 'South').toLowerCase().includes('north') ? 0
    : String(frontFacing || 'South').toLowerCase().includes('east') ? 1
    : String(frontFacing || 'South').toLowerCase().includes('west') ? 3
    : 2;
  const offset = viewKey === 'front' ? 0 : viewKey === 'right' ? 1 : viewKey === 'rear' ? 2 : 3;
  return frontEdgeOffset(base, offset);
}

function touchesEdge(room, level, edge) {
  const parts = Array.isArray(room?.parts) && room.parts.length
    ? room.parts
    : [room];
  const width = num(level?.width);
  const height = num(level?.height);
  return parts.some((part) => {
    const x = num(part?.x);
    const y = num(part?.y);
    const w = num(part?.w);
    const h = num(part?.h);
    if (edge === 'top') return y === 0;
    if (edge === 'bottom') return y + h === height;
    if (edge === 'left') return x === 0;
    return x + w === width;
  });
}

function projectEdge(room, level, edge) {
  const x = num(room?.x);
  const y = num(room?.y);
  const w = num(room?.w);
  const h = num(room?.h);
  const width = num(level?.width);
  const height = num(level?.height);

  if (edge === 'top' || edge === 'bottom') {
    return {
      start: x,
      span: w,
      depth: h,
      inset: edge === 'top' ? y : height - (y + h),
    };
  }

  return {
    start: y,
    span: h,
    depth: w,
    inset: edge === 'left' ? x : width - (x + w),
  };
}

function voidStepSegments(voidRects, levelWidth, levelHeight, edge) {
  if (!Array.isArray(voidRects) || !voidRects.length) return [];
  const steps = [];
  for (const rect of voidRects) {
    const vx = num(rect?.x);
    const vy = num(rect?.y);
    const vw = num(rect?.w);
    const vh = num(rect?.h);
    if (vw <= 0 || vh <= 0) continue;

    if (edge === 'bottom' || edge === 'top') {
      // Front/rear elevation: void creates horizontal gaps
      // Step lines at void left and right x boundaries
      const touchesEdgeSide = (edge === 'bottom') ? (vy + vh >= levelHeight) : (vy <= 0);
      if (touchesEdgeSide) {
        steps.push({ pos: vx, extent: vh, side: 'left_step' });
        steps.push({ pos: vx + vw, extent: vh, side: 'right_step' });
      }
    } else {
      // Side elevation: void creates vertical gaps
      const touchesEdgeSide = (edge === 'right') ? (vx + vw >= levelWidth) : (vx <= 0);
      if (touchesEdgeSide) {
        steps.push({ pos: vy, extent: vw, side: 'top_step' });
        steps.push({ pos: vy + vh, extent: vw, side: 'bottom_step' });
      }
    }
  }
  return steps;
}

function mergeSegments(segments = []) {
  const sorted = segments
    .filter((segment) => num(segment?.span) > 0)
    .map((segment) => ({
      start: num(segment.start),
      span: num(segment.span),
      depth: num(segment.depth),
      inset: num(segment.inset),
    }))
    .sort((a, b) => a.start - b.start || a.inset - b.inset);

  const merged = [];
  for (const segment of sorted) {
    const end = segment.start + segment.span;
    const last = merged[merged.length - 1];
    if (last && segment.start <= last.start + last.span + 0.001 && segment.inset === last.inset) {
      last.span = Math.max(last.start + last.span, end) - last.start;
      last.depth = Math.max(last.depth, segment.depth);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function roomEdgeSegments(room, level, edge) {
  const parts = Array.isArray(room?.parts) && room.parts.length
    ? room.parts
    : [room];
  const touchingParts = parts.filter((part) => touchesEdge(part, level, edge));
  return mergeSegments(touchingParts.map((part) => projectEdge(part, level, edge)));
}

function edgeSpanForLevel(level, edge) {
  return edge === 'top' || edge === 'bottom' ? num(level?.width) : num(level?.height);
}

function roomArea(room) {
  if (Array.isArray(room?.parts) && room.parts.length) {
    return room.parts.reduce((sum, part) => sum + num(part?.w) * num(part?.h), 0);
  }
  return num(room?.w) * num(room?.h);
}

function normalizedStyleId(surveyData = {}) {
  const materials = String(surveyData?.materials || '').toLowerCase();
  if (materials.includes('mediterranean') || materials.includes('stucco') || materials.includes('tile')) return 'mediterranean';
  if (materials.includes('farmhouse') || materials.includes('board') || materials.includes('batten')) return 'farmhouse';
  if (materials.includes('modern') || materials.includes('concrete') || materials.includes('steel')) return 'modern';
  if (materials.includes('colonial') || materials.includes('traditional') || materials.includes('brick')) return 'colonial';
  if (materials.includes('craftsman') || materials.includes('wood') || materials.includes('stone')) return 'craftsman';
  if (materials.includes('rustic') || materials.includes('cabin') || materials.includes('log')) return 'rustic';
  return 'residential';
}

function getElevationStyleProfile(surveyData = {}) {
  const styleId = normalizedStyleId(surveyData);
  const budget = String(surveyData?.budgetTier || '').toLowerCase();
  const ceiling = String(surveyData?.ceilingHeight || '').toLowerCase();
  const premium = budget.includes('luxury');
  const tallerRoof = ceiling.includes('tall') || ceiling.includes('cathedral') || ceiling.includes('vault');

  const base = {
    id: styleId,
    bodyFill: '#efe3cf',
    baseFill: '#d0c0a5',
    trimStroke: '#5e4e3e',
    lineStroke: '#574838',
    windowFill: '#d7e8f5',
    roofFill: '#85715a',
    accentFill: '#b66b42',
    entryFill: '#8d6648',
    overlayFill: '#f6ecdd',
    roofKind: 'gabled',
    roofHeightFt: tallerRoof ? 7.5 : 6.5,
    corniceHeightFt: 1.2,
    stoneBase: true,
    porch: true,
    pairedWindows: false,
    label: 'Residential',
    subtitle: 'Balanced residential elevation',
  };

  if (styleId === 'craftsman') {
    return {
      ...base,
      roofKind: 'craftsman_gable',
      roofHeightFt: tallerRoof ? 8.5 : 7.25,
      stoneBase: true,
      porch: true,
      pairedWindows: true,
      label: 'Craftsman',
      subtitle: premium ? 'Timber-accented craftsman elevation' : 'Warm craftsman street elevation',
      accentFill: premium ? '#9f562f' : '#b66b42',
      bodyFill: '#efe0c9',
      baseFill: '#baa189',
    };
  }

  if (styleId === 'farmhouse') {
    return {
      ...base,
      roofKind: 'cross_gable',
      roofHeightFt: tallerRoof ? 8 : 7,
      stoneBase: false,
      porch: true,
      pairedWindows: true,
      label: 'Farmhouse',
      subtitle: 'Board-and-batten farmhouse elevation',
      bodyFill: '#f2ebe0',
      baseFill: '#c7baa4',
      roofFill: '#6b6b6b',
    };
  }

  if (styleId === 'modern') {
    return {
      ...base,
      roofKind: 'flat',
      roofHeightFt: 2.25,
      corniceHeightFt: 1.8,
      stoneBase: false,
      porch: false,
      pairedWindows: false,
      label: 'Modern',
      subtitle: 'Contemporary low-profile elevation',
      bodyFill: '#e7e2da',
      baseFill: '#c9c3ba',
      trimStroke: '#444',
      lineStroke: '#2e2e2e',
      roofFill: '#474747',
      accentFill: '#8f5f49',
      entryFill: '#4a4038',
    };
  }

  if (styleId === 'colonial') {
    return {
      ...base,
      roofKind: 'side_gable',
      roofHeightFt: tallerRoof ? 7.5 : 6.75,
      stoneBase: false,
      porch: false,
      pairedWindows: true,
      label: 'Colonial',
      subtitle: 'Traditional symmetrical elevation',
      bodyFill: '#ece3d7',
      baseFill: '#cab8a4',
      roofFill: '#6c5c4d',
    };
  }

  if (styleId === 'mediterranean') {
    return {
      ...base,
      roofKind: 'hip',
      roofHeightFt: 5.75,
      stoneBase: false,
      porch: false,
      pairedWindows: false,
      label: 'Mediterranean',
      subtitle: 'Stucco-and-tile elevation',
      bodyFill: '#efe0cf',
      baseFill: '#dac2ab',
      roofFill: '#a86143',
      accentFill: '#ba6944',
    };
  }

  if (styleId === 'rustic') {
    return {
      ...base,
      roofKind: 'gable',
      roofHeightFt: tallerRoof ? 8.25 : 7,
      stoneBase: true,
      porch: true,
      pairedWindows: false,
      label: 'Rustic',
      subtitle: 'Cabin-influenced mountain elevation',
      bodyFill: '#e8d9c6',
      baseFill: '#a88f76',
      roofFill: '#6b5849',
    };
  }

  return {
    ...base,
    label: 'Residential',
    subtitle: 'Balanced suburban elevation',
  };
}

function doorOnEdge(level, edge, predicate = () => true) {
  return (level?.doors || []).find((door) => {
    if (!predicate(door)) return false;
    if (edge === 'top') return door.dir === 'horizontal' && num(door.y) === 0;
    if (edge === 'bottom') return door.dir === 'horizontal' && num(door.y) === num(level.height);
    if (edge === 'left') return door.dir === 'vertical' && num(door.x) === 0;
    return door.dir === 'vertical' && num(door.x) === num(level.width);
  }) || null;
}

function openingsOnEdge(level, edge, kind = 'windows') {
  const items = kind === 'doors' ? (level?.doors || []) : (level?.windows || []);
  return items.filter((item) => {
    if (kind === 'windows') {
      if (edge === 'top') return item.dir === 'horizontal' && num(item.y) === 0;
      if (edge === 'bottom') return item.dir === 'horizontal' && num(item.y) === num(level.height);
      if (edge === 'left') return item.dir === 'vertical' && num(item.x) === 0;
      return item.dir === 'vertical' && num(item.x) === num(level.width);
    }
    if (edge === 'top') return item.dir === 'horizontal' && num(item.y) === 0;
    if (edge === 'bottom') return item.dir === 'horizontal' && num(item.y) === num(level.height);
    if (edge === 'left') return item.dir === 'vertical' && num(item.x) === 0;
    return item.dir === 'vertical' && num(item.x) === num(level.width);
  });
}

function openingPosition(opening, edge, defaultWidthFt = 3) {
  if (edge === 'top' || edge === 'bottom') {
    return {
      centerFt: num(opening?.x),
      widthFt: num(opening?.width, defaultWidthFt),
    };
  }
  return {
    centerFt: num(opening?.y),
    widthFt: num(opening?.width, defaultWidthFt),
  };
}

function inferFrontEdge(planSpec, fallback = 'bottom') {
  const level1 = (planSpec?.levels || []).find((level) => num(level?.level, 1) === 1) || (planSpec?.levels || [])[0] || null;
  if (!level1) return fallback;
  const scores = new Map();
  for (const door of Array.isArray(level1?.doors) ? level1.doors : []) {
    if (String(door?.b) !== '__exterior__') continue;
    let edge = null;
    if (door?.dir === 'horizontal') edge = num(door?.y) === 0 ? 'top' : num(door?.y) === num(level1?.height) ? 'bottom' : null;
    else edge = num(door?.x) === 0 ? 'left' : num(door?.x) === num(level1?.width) ? 'right' : null;
    if (!edge) continue;
    let weight = 2;
    if (door?.isMainEntry) weight += 12;
    if (door?.garageDoor) weight += 9;
    scores.set(edge, (scores.get(edge) || 0) + weight);
  }
  if (!scores.size) return fallback;
  let bestEdge = fallback;
  let bestScore = -Infinity;
  for (const [edge, score] of scores.entries()) {
    if (score > bestScore || (score === bestScore && edge === fallback)) {
      bestEdge = edge;
      bestScore = score;
    }
  }
  return bestEdge;
}

function buildRoofSvg({
  style,
  viewKey,
  baseX,
  roofBaseY,
  spanPx,
  roofHeightPx,
  lineStroke,
  roofFill,
  hasGarage,
  entryCenterX,
}) {
  if (style.roofKind === 'flat') {
    return [
      `<rect x="${baseX}" y="${roofBaseY - roofHeightPx}" width="${spanPx}" height="${roofHeightPx}" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2"/>`,
      `<line x1="${baseX}" y1="${roofBaseY - roofHeightPx}" x2="${baseX + spanPx}" y2="${roofBaseY - roofHeightPx}" stroke="${lineStroke}" stroke-width="2.2"/>`,
    ].join('');
  }

  if (style.roofKind === 'hip') {
    const inset = spanPx * 0.08;
    const ridgeY = roofBaseY - roofHeightPx;
    return [
      `<path d="M ${baseX} ${roofBaseY} L ${baseX + inset} ${ridgeY} L ${baseX + spanPx - inset} ${ridgeY} L ${baseX + spanPx} ${roofBaseY} Z" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2"/>`,
      `<line x1="${baseX + inset}" y1="${ridgeY}" x2="${baseX + spanPx - inset}" y2="${ridgeY}" stroke="${lineStroke}" stroke-width="1.5"/>`,
    ].join('');
  }

  if (style.roofKind === 'craftsman_gable' || style.roofKind === 'cross_gable') {
    const ridgeY = roofBaseY - roofHeightPx;
    const main = `<path d="M ${baseX} ${roofBaseY} L ${baseX + spanPx * 0.5} ${ridgeY} L ${baseX + spanPx} ${roofBaseY} Z" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2.2"/>`;
    const parts = [main];
    if (viewKey === 'front' && entryCenterX != null) {
      const gableWidth = Math.min(spanPx * 0.34, 180);
      const gx1 = Math.max(baseX + 16, entryCenterX - gableWidth / 2);
      const gx2 = Math.min(baseX + spanPx - 16, entryCenterX + gableWidth / 2);
      const gy = roofBaseY - roofHeightPx * (style.roofKind === 'craftsman_gable' ? 0.66 : 0.58);
      parts.push(`<path d="M ${gx1} ${roofBaseY + 6} L ${entryCenterX} ${gy} L ${gx2} ${roofBaseY + 6} Z" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2"/>`);
      parts.push(`<line x1="${gx1 + 10}" y1="${roofBaseY + 8}" x2="${gx1 + 10}" y2="${roofBaseY + 18}" stroke="${lineStroke}" stroke-width="1.3"/>`);
      parts.push(`<line x1="${gx2 - 10}" y1="${roofBaseY + 8}" x2="${gx2 - 10}" y2="${roofBaseY + 18}" stroke="${lineStroke}" stroke-width="1.3"/>`);
    }
    if (hasGarage && viewKey === 'front') {
      parts.push(`<line x1="${baseX + 12}" y1="${roofBaseY - 4}" x2="${baseX + spanPx - 12}" y2="${roofBaseY - 4}" stroke="${lineStroke}" stroke-width="1.4" opacity="0.75"/>`);
    }
    return parts.join('');
  }

  if (style.roofKind === 'side_gable' && (viewKey === 'left' || viewKey === 'right')) {
    const ridgeY = roofBaseY - roofHeightPx;
    return `<path d="M ${baseX} ${roofBaseY} L ${baseX + spanPx * 0.5} ${ridgeY} L ${baseX + spanPx} ${roofBaseY} Z" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2.2"/>`;
  }

  return `<path d="M ${baseX} ${roofBaseY} L ${baseX + spanPx * 0.5} ${roofBaseY - roofHeightPx} L ${baseX + spanPx} ${roofBaseY} Z" fill="${roofFill}" stroke="${lineStroke}" stroke-width="2.2"/>`;
}

function roofSupportSpan(levels, actualEdge) {
  const sorted = (Array.isArray(levels) ? levels.slice() : [])
    .sort((a, b) => num(b?.level, 1) - num(a?.level, 1));

  for (const level of sorted) {
    const edgeRooms = (level?.rooms || [])
      .flatMap((room) => roomEdgeSegments(room, level, actualEdge).map((proj) => ({ room, proj })));
    const spans = mergeSegments(edgeRooms.map((item) => item.proj));
    if (!spans.length) continue;
    const minStart = Math.min(...spans.map((span) => num(span.start)));
    const maxEnd = Math.max(...spans.map((span) => num(span.start) + num(span.span)));
    if (Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd > minStart) {
      return { start: minStart, span: maxEnd - minStart };
    }
  }
  return { start: 0, span: Math.max(...sorted.map((level) => edgeSpanForLevel(level, actualEdge)), 1) };
}

/* Facade runs that exist on the ground floor but carry no storey above them.
 *
 * A two-storey house with a single-storey garage wing has one: the main roof
 * covers the two-storey mass, and the wing needs its own lower roof. Without
 * this the wing was drawn as a wall with an open top edge.
 *
 * Returns an empty array for a building whose upper floor covers everything,
 * so ordinary elevations are untouched.
 */
function singleStoreyWingSpans(levels, actualEdge, roofSupport) {
  const sorted = (Array.isArray(levels) ? levels.slice() : [])
    .sort((a, b) => num(a?.level, 1) - num(b?.level, 1));
  const ground = sorted[0];
  if (!ground || sorted.length < 2) return [];

  const groundSpans = mergeSegments(
    (ground.rooms || []).flatMap((room) => roomEdgeSegments(room, ground, actualEdge))
  );
  if (!groundSpans.length) return [];

  const coveredStart = num(roofSupport?.start);
  const coveredEnd = coveredStart + num(roofSupport?.span);
  const wings = [];
  for (const span of groundSpans) {
    const start = num(span.start);
    const end = start + num(span.span);
    // The part of this run left of the covered mass, then the part right of it.
    const left = { start, end: Math.min(end, coveredStart) };
    const right = { start: Math.max(start, coveredEnd), end };
    for (const piece of [left, right]) {
      const width = piece.end - piece.start;
      // Below about 3 ft the wing is a jog in the wall, not a roofed volume.
      if (width >= 3) wings.push({ start: piece.start, span: width });
    }
  }
  return mergeSegments(wings.map((wing) => ({ start: wing.start, span: wing.span, depth: 0, inset: 0 })));
}

function claddingPatternDefs(finishSpec, style) {
  const primaryMat = String(finishSpec?.exterior?.primaryCladding?.material || '').toLowerCase();
  const accentMat = String(finishSpec?.exterior?.accentCladding?.material || '').toLowerCase();
  const roofMat = String(finishSpec?.roofing?.material || '').toLowerCase();
  const lineColor = style.trimStroke || '#5e4e3e';
  const defs = [];

  // Primary cladding pattern
  if (primaryMat.includes('lap') || primaryMat.includes('cedar') || primaryMat.includes('fiber_cement')) {
    // Horizontal lap siding -- parallel horizontal lines at ~6" spacing
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="200" height="8"><rect width="200" height="8" fill="${style.bodyFill}"/><line x1="0" y1="7.5" x2="200" y2="7.5" stroke="${lineColor}" stroke-width="0.5" opacity="0.35"/></pattern>`);
  } else if (primaryMat.includes('board') || primaryMat.includes('batten')) {
    // Vertical board & batten -- vertical lines at ~16px spacing
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="16" height="60"><rect width="16" height="60" fill="${style.bodyFill}"/><line x1="8" y1="0" x2="8" y2="60" stroke="${lineColor}" stroke-width="0.6" opacity="0.32"/></pattern>`);
  } else if (primaryMat.includes('brick')) {
    // Running bond brick -- staggered horizontal + vertical lines
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="24" height="8"><rect width="24" height="8" fill="${style.bodyFill}"/><line x1="0" y1="7.5" x2="24" y2="7.5" stroke="${lineColor}" stroke-width="0.4" opacity="0.3"/><line x1="12" y1="0" x2="12" y2="4" stroke="${lineColor}" stroke-width="0.35" opacity="0.25"/><line x1="0" y1="4" x2="0" y2="4" stroke="${lineColor}" stroke-width="0.35" opacity="0.25"/><line x1="24" y1="4" x2="24" y2="8" stroke="${lineColor}" stroke-width="0.35" opacity="0.25"/></pattern>`);
  } else if (primaryMat.includes('stucco')) {
    // Stucco -- subtle stipple using tiny circles
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="12" height="12"><rect width="12" height="12" fill="${style.bodyFill}"/><circle cx="3" cy="3" r="0.5" fill="${lineColor}" opacity="0.12"/><circle cx="9" cy="8" r="0.5" fill="${lineColor}" opacity="0.1"/></pattern>`);
  } else if (primaryMat.includes('concrete')) {
    // Concrete panel -- large panel reveal lines
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="60" height="40"><rect width="60" height="40" fill="${style.bodyFill}"/><line x1="0" y1="39.5" x2="60" y2="39.5" stroke="${lineColor}" stroke-width="0.4" opacity="0.25"/><line x1="59.5" y1="0" x2="59.5" y2="40" stroke="${lineColor}" stroke-width="0.4" opacity="0.25"/></pattern>`);
  } else {
    defs.push(`<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="${style.bodyFill}"/></pattern>`);
  }

  // Accent cladding pattern (used for base/foundation zone)
  if (accentMat.includes('stone')) {
    defs.push(`<pattern id="clad-accent" patternUnits="userSpaceOnUse" width="28" height="16"><rect width="28" height="16" fill="${style.baseFill}"/><rect x="1" y="1" width="12" height="6" rx="1" fill="none" stroke="${lineColor}" stroke-width="0.5" opacity="0.3"/><rect x="15" y="1" width="11" height="6" rx="1" fill="none" stroke="${lineColor}" stroke-width="0.5" opacity="0.25"/><rect x="8" y="9" width="14" height="5" rx="1" fill="none" stroke="${lineColor}" stroke-width="0.5" opacity="0.28"/></pattern>`);
  } else if (accentMat.includes('brick')) {
    defs.push(`<pattern id="clad-accent" patternUnits="userSpaceOnUse" width="24" height="8"><rect width="24" height="8" fill="${style.baseFill}"/><line x1="0" y1="7.5" x2="24" y2="7.5" stroke="${lineColor}" stroke-width="0.4" opacity="0.35"/><line x1="12" y1="0" x2="12" y2="4" stroke="${lineColor}" stroke-width="0.35" opacity="0.28"/></pattern>`);
  } else {
    defs.push(`<pattern id="clad-accent" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="${style.baseFill}"/></pattern>`);
  }

  // Roof texture pattern
  if (roofMat.includes('standing_seam') || roofMat.includes('metal')) {
    defs.push(`<pattern id="roof-tex" patternUnits="userSpaceOnUse" width="20" height="40"><rect width="20" height="40" fill="${style.roofFill}"/><line x1="10" y1="0" x2="10" y2="40" stroke="${lineColor}" stroke-width="0.6" opacity="0.3"/></pattern>`);
  } else if (roofMat.includes('clay') || roofMat.includes('tile')) {
    defs.push(`<pattern id="roof-tex" patternUnits="userSpaceOnUse" width="16" height="6"><rect width="16" height="6" fill="${style.roofFill}"/><path d="M0,5 Q4,1 8,5 Q12,1 16,5" stroke="${lineColor}" stroke-width="0.5" fill="none" opacity="0.3"/></pattern>`);
  } else if (roofMat.includes('slate')) {
    defs.push(`<pattern id="roof-tex" patternUnits="userSpaceOnUse" width="30" height="5"><rect width="30" height="5" fill="${style.roofFill}"/><line x1="0" y1="4.5" x2="30" y2="4.5" stroke="${lineColor}" stroke-width="0.35" opacity="0.25"/></pattern>`);
  } else {
    // Asphalt shingles or default -- subtle horizontal coursing
    defs.push(`<pattern id="roof-tex" patternUnits="userSpaceOnUse" width="40" height="6"><rect width="40" height="6" fill="${style.roofFill}"/><line x1="0" y1="5.5" x2="40" y2="5.5" stroke="${lineColor}" stroke-width="0.3" opacity="0.18"/></pattern>`);
  }

  return defs.length ? `<defs>${defs.join('')}</defs>` : '';
}

function renderElevationForView(planSpec, surveyData = {}, viewKey = 'front') {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  if (!levels.length) return '';

  const frontEdge = inferFrontEdge(planSpec, String(planSpec?.facade?.frontEdge || 'bottom'));
  const actualEdge = relativeViewToEdge(frontEdge, viewKey);
  const style = getElevationStyleProfile(surveyData);
  const finishSpec = planSpec?.finishSpec || null;
  const hasCladdingPatterns = Boolean(finishSpec?.exterior?.primaryCladding?.material);
  const verticalProfiles = Array.isArray(planSpec?.verticalModel?.levels) ? planSpec.verticalModel.levels : [];
  const profileByLevel = new Map(verticalProfiles.map((profile) => [num(profile?.level, 1), profile]));
  const spanFt = Math.max(...levels.map((level) => edgeSpanForLevel(level, actualEdge)), 1);
  const maxTopZFt = verticalProfiles.length
    ? Math.max(...verticalProfiles.map((profile) => num(profile?.topOfStructureZFt)))
    : levels.length * 10;
  const roofHeightFt = num(style.roofHeightFt, 7);
  // Use 18 px/ft to match plan SVG scale (PX=18 in renderPlanSvg.js)
  const PLAN_PX_PER_FT = 18;
  const scale = PLAN_PX_PER_FT;
  const verticalScale = PLAN_PX_PER_FT;
  const widthPx = Math.max(480, Math.round(spanFt * scale + 160));
  const heightPx = Math.max(320, Math.round(maxTopZFt * verticalScale + roofHeightFt * verticalScale + 140));
  const baseX = 80;
  const groundY = heightPx - 62;
  const bodyHeightPx = maxTopZFt * verticalScale;
  const topY = groundY - bodyHeightPx;
  const facingLabel = getFacingLabelForView(surveyData?.frontFacing || planSpec?.facade?.frontFacing, viewKey);
  const title = `${viewKey.charAt(0).toUpperCase()}${viewKey.slice(1)} Elevation`;

  const patternDefs = hasCladdingPatterns ? claddingPatternDefs(finishSpec, style) : '';
  const wallFill = hasCladdingPatterns ? 'url(#clad-primary)' : style.bodyFill;
  const baseFill = hasCladdingPatterns ? 'url(#clad-accent)' : style.baseFill;
  const roofTexFill = hasCladdingPatterns ? 'url(#roof-tex)' : style.roofFill;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">`,
    patternDefs,
    `<rect width="100%" height="100%" fill="#f8f2e7"/>`,
    `<text x="${baseX}" y="34" font-family="Georgia, serif" font-size="22" fill="${style.lineStroke}">${esc(title)}</text>`,
    `<text x="${baseX}" y="56" font-family="Arial, sans-serif" font-size="11" letter-spacing="1.8" fill="#7e6d5c">${PRODUCT_NAME.toUpperCase()}</text>`,
    `<line x1="${baseX}" y1="${groundY}" x2="${baseX + spanFt * scale}" y2="${groundY}" stroke="${style.lineStroke}" stroke-width="2.6"/>`,
  ];

  const frontLevel = levels.find((level) => num(level?.level, 1) === 1) || levels[0];
  // Looking from north or east reverses the plan's increasing coordinate.
  // Reflect only the building: captions and dimensions remain readable.
  const mirrorProjection = actualEdge === 'top' || actualEdge === 'right';
  parts.push(`<g data-elevation-edge="${actualEdge}"${mirrorProjection ? ` transform="translate(${2 * baseX + spanFt * scale} 0) scale(-1 1)"` : ''}>`);
  const frontEntryDoor = doorOnEdge(frontLevel, actualEdge, (door) => String(door?.b) === '__exterior__' && !door?.garageDoor);
  const garageDoor = doorOnEdge(frontLevel, actualEdge, (door) => Boolean(door?.garageDoor));
  const entryPos = frontEntryDoor ? openingPosition(frontEntryDoor, actualEdge, 3) : null;
  const garagePos = garageDoor ? openingPosition(garageDoor, actualEdge, 9) : null;
  const entryCenterX = entryPos ? baseX + entryPos.centerFt * scale : null;
  const roofSupport = roofSupportSpan(levels, actualEdge);
  const roofOverhangPx = Math.min(18, Math.max(8, scale * 1.2));
  const roofStartX = Math.max(baseX, baseX + roofSupport.start * scale - roofOverhangPx);
  const roofEndX = Math.min(baseX + spanFt * scale, baseX + (roofSupport.start + roofSupport.span) * scale + roofOverhangPx);
  const roofSpanPx = Math.max(40, roofEndX - roofStartX);

  for (const level of levels.slice().sort((a, b) => num(a?.level, 1) - num(b?.level, 1))) {
    const profile = profileByLevel.get(num(level?.level, 1)) || null;
    // Cladding continues over the floor/roof structure above the ceiling.
    // Stopping at ceilingZFt left an empty strip between otherwise stacked
    // storeys and detached the roof from the upper facade.
    const levelTop = profile ? groundY - num(profile.topOfStructureZFt, num(profile.ceilingZFt)) * verticalScale : topY;
    const levelBottom = profile ? groundY - num(profile.floorZFt) * verticalScale : groundY;
    const levelHeightPx = Math.max(70, levelBottom - levelTop);
    const levelY = levelBottom - levelHeightPx;

    const edgeRooms = (level.rooms || [])
      .flatMap((room) => roomEdgeSegments(room, level, actualEdge).map((proj) => ({ room, proj })))
      .sort((a, b) => a.proj.start - b.proj.start || roomArea(b.room) - roomArea(a.room));
    const facadeSpans = mergeSegments(edgeRooms.map((item) => item.proj));
    const visibleSpans = facadeSpans.length ? facadeSpans : [{ start: 0, span: spanFt, depth: 0, inset: 0 }];

    for (const span of visibleSpans) {
      const spanX = baseX + span.start * scale;
      const spanW = Math.max(10, span.span * scale);
      parts.push(`<rect data-facade-level="${num(level?.level, 1)}" x="${spanX}" y="${levelY}" width="${spanW}" height="${levelHeightPx}" fill="${wallFill}" stroke="${style.lineStroke}" stroke-width="2"/>`);
      if (num(level?.level, 1) === 1 && (style.stoneBase || hasCladdingPatterns)) {
        parts.push(`<rect x="${spanX}" y="${Math.max(levelBottom - 26, levelY + 8)}" width="${spanW}" height="${Math.min(26, levelHeightPx * 0.22)}" fill="${baseFill}" opacity="0.92"/>`);
      }
    }

    // Draw explicit setback step lines for L/T void boundaries visible on this edge
    const voidRects = Array.isArray(planSpec?.envelopeVoidRects) ? planSpec.envelopeVoidRects : [];
    const steps = voidStepSegments(voidRects, num(level?.width), num(level?.height), actualEdge);
    for (const step of steps) {
      const stepX = baseX + step.pos * scale;
      parts.push(`<line x1="${stepX}" y1="${levelY}" x2="${stepX}" y2="${levelY + levelHeightPx}" stroke="${style.lineStroke}" stroke-width="2.2"/>`);
    }

    for (const item of edgeRooms) {
      const bayX = baseX + item.proj.start * scale;
      const bayW = Math.max(12, item.proj.span * scale);
      parts.push(`<rect x="${bayX}" y="${levelY}" width="${bayW}" height="${levelHeightPx}" fill="${style.overlayFill}" fill-opacity="0.18" stroke="${style.trimStroke}" stroke-width="0.9" opacity="0.55"/>`);
    }

    const windows = openingsOnEdge(level, actualEdge, 'windows');
    for (const window of windows) {
      const pos = openingPosition(window, actualEdge, 4);
      const wx = baseX + pos.centerFt * scale;
      const openingWidthPx = pos.widthFt * scale;
      const room = (level.rooms || []).find(r => String(r.id) === String(window.roomId)) || edgeRooms.find((item) => pos.centerFt >= item.proj.start && pos.centerFt <= item.proj.start + item.proj.span)?.room || null;
      const { sill: sillHeightFt, head: headHeightFt } = windowHeights(window, room);
      const wy = groundY - (num(profile?.floorZFt) + headHeightFt) * verticalScale;
      const winH = Math.max(16, (headHeightFt - sillHeightFt) * verticalScale);

      parts.push(`<g data-opening="window" data-opening-id="${esc(window.id || '')}" data-level="${num(level?.level, 1)}" data-width-ft="${pos.widthFt}" data-sill-ft="${sillHeightFt}" data-head-ft="${headHeightFt}">`);
      if (style.pairedWindows && room && !String(room.type || '').toLowerCase().includes('bath') && pos.widthFt >= 4) {
        const gap = Math.min(4, openingWidthPx * 0.05);
        const winW = (openingWidthPx - gap) / 2;
        parts.push(`<rect x="${wx - winW - gap / 2}" y="${wy}" width="${winW}" height="${winH}" rx="1.5" fill="${style.windowFill}" stroke="${style.trimStroke}" stroke-width="1.6"/>`);
        parts.push(`<rect x="${wx + gap / 2}" y="${wy}" width="${winW}" height="${winH}" rx="1.5" fill="${style.windowFill}" stroke="${style.trimStroke}" stroke-width="1.6"/>`);
      } else {
        const winW = openingWidthPx;
        parts.push(`<rect x="${wx - winW / 2}" y="${wy}" width="${winW}" height="${winH}" rx="1.5" fill="${style.windowFill}" stroke="${style.trimStroke}" stroke-width="1.6"/>`);
      }
      parts.push('</g>');
    }

    const edgeDoors = openingsOnEdge(level, actualEdge, 'doors').filter((door) => String(door?.b) === '__exterior__');
    for (const door of edgeDoors) {
      const pos = openingPosition(door, actualEdge, door?.garageDoor ? 9 : 3);
      const dx = baseX + pos.centerFt * scale;
      if (door?.garageDoor) {
        const width = pos.widthFt * scale;
        const doorHeight = openingDoorHeight(door, level.rooms || []) * verticalScale;
        const doorTop = levelBottom - doorHeight;
        const panelH = doorHeight / 4;
        parts.push(`<rect data-opening="garage-door" x="${dx - width / 2}" y="${doorTop}" width="${width}" height="${doorHeight}" fill="#f5ecdd" stroke="${style.lineStroke}" stroke-width="2"/>`);
        parts.push(`<line x1="${dx - width / 2}" y1="${doorTop + panelH}" x2="${dx + width / 2}" y2="${doorTop + panelH}" stroke="${style.trimStroke}" stroke-width="1.1"/>`);
        parts.push(`<line x1="${dx - width / 2}" y1="${doorTop + panelH * 2}" x2="${dx + width / 2}" y2="${doorTop + panelH * 2}" stroke="${style.trimStroke}" stroke-width="1.1"/>`);
        parts.push(`<line x1="${dx - width / 2}" y1="${doorTop + panelH * 3}" x2="${dx + width / 2}" y2="${doorTop + panelH * 3}" stroke="${style.trimStroke}" stroke-width="1.1"/>`);
        const panelCount = Math.max(3, Math.round(pos.widthFt / 3));
        for (let i = 1; i < panelCount; i++) {
          const x = dx - width / 2 + (width / panelCount) * i;
          parts.push(`<line x1="${x}" y1="${doorTop}" x2="${x}" y2="${doorTop + panelH * 4}" stroke="${style.trimStroke}" stroke-width="0.9" opacity="0.82"/>`);
        }
      } else {
        const width = pos.widthFt * scale;
        const doorHeight = openingDoorHeight(door, level.rooms || []) * verticalScale;
        const doorTop = levelBottom - doorHeight;
        parts.push(`<rect data-opening="${door.slidingDoor ? 'sliding-door' : 'entry-door'}" x="${dx - width / 2}" y="${doorTop}" width="${width}" height="${doorHeight}" fill="${door.slidingDoor ? style.windowFill : style.entryFill}" stroke="${style.lineStroke}" stroke-width="1.9"/>`);
        if (door.slidingDoor) {
          parts.push(`<line x1="${dx}" y1="${doorTop}" x2="${dx}" y2="${levelBottom}" stroke="${style.trimStroke}" stroke-width="2"/>`);
        } else {
          parts.push(`<circle cx="${dx + width * 0.22}" cy="${levelBottom - 3 * verticalScale}" r="2.1" fill="#f2ddbe"/>`);
        }

        if (viewKey === 'front' && style.porch && door.isMainEntry) {
          const porchWidth = Math.max(width + 54, 84);
          const porchY = doorTop - 16;
          parts.push(`<line x1="${dx - porchWidth / 2}" y1="${porchY}" x2="${dx + porchWidth / 2}" y2="${porchY}" stroke="${style.lineStroke}" stroke-width="2.2"/>`);
          parts.push(`<line x1="${dx - porchWidth / 2 + 10}" y1="${porchY}" x2="${dx - porchWidth / 2 + 10}" y2="${groundY}" stroke="${style.trimStroke}" stroke-width="1.5"/>`);
          parts.push(`<line x1="${dx + porchWidth / 2 - 10}" y1="${porchY}" x2="${dx + porchWidth / 2 - 10}" y2="${groundY}" stroke="${style.trimStroke}" stroke-width="1.5"/>`);
        }
      }
    }
  }

  const roofBaseY = groundY - bodyHeightPx;
  parts.push(buildRoofSvg({
    style,
    viewKey,
    baseX: roofStartX,
    roofBaseY,
    spanPx: roofSpanPx,
    roofHeightPx: roofHeightFt * verticalScale,
    lineStroke: style.lineStroke,
    roofFill: roofTexFill,
    hasGarage: Boolean(garagePos),
    entryCenterX,
  }));

  // A single-storey wing beside the two-storey mass gets its own roof, seated
  // on top of that wing's structure rather than on the main body height.
  const groundProfile = profileByLevel.get(1) || null;
  const wingBaseY = groundProfile
    ? groundY - num(groundProfile.topOfStructureZFt, num(groundProfile.ceilingZFt)) * verticalScale
    : null;
  if (wingBaseY != null) {
    for (const wing of singleStoreyWingSpans(levels, actualEdge, roofSupport)) {
      const wingStartX = Math.max(baseX, baseX + num(wing.start) * scale - roofOverhangPx);
      const wingEndX = Math.min(baseX + spanFt * scale, baseX + (num(wing.start) + num(wing.span)) * scale + roofOverhangPx);
      const wingSpanPx = wingEndX - wingStartX;
      if (wingSpanPx < 24) continue;
      parts.push(buildRoofSvg({
        style,
        viewKey,
        baseX: wingStartX,
        roofBaseY: wingBaseY,
        spanPx: wingSpanPx,
        // Lower pitch than the main mass, and never taller than it.
        roofHeightPx: Math.max(18, roofHeightFt * verticalScale * 0.55),
        lineStroke: style.lineStroke,
        roofFill: roofTexFill,
        hasGarage: false,
        entryCenterX: null,
      }));
    }
  }

  parts.push('</g>');
  parts.push(`<line x1="${baseX}" y1="${groundY + 26}" x2="${baseX + spanFt * scale}" y2="${groundY + 26}" stroke="#907f6e" stroke-width="1.1"/>`);
  parts.push(`<line x1="${baseX}" y1="${groundY + 20}" x2="${baseX}" y2="${groundY + 32}" stroke="#907f6e" stroke-width="1.1"/>`);
  parts.push(`<line x1="${baseX + spanFt * scale}" y1="${groundY + 20}" x2="${baseX + spanFt * scale}" y2="${groundY + 32}" stroke="#907f6e" stroke-width="1.1"/>`);
  parts.push(`<text x="${baseX + spanFt * scale / 2}" y="${groundY + 20}" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#7e6d5c">${spanFt.toFixed(0)} ft overall</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function chooseSupportViewKey(planSpec, surveyData = {}) {
  const frontEdge = inferFrontEdge(planSpec, String(planSpec?.facade?.frontEdge || 'bottom'));
  const sideViews = ['left', 'right'];
  const scores = sideViews.map((viewKey) => {
    const edge = relativeViewToEdge(frontEdge, viewKey);
    const level1 = (planSpec?.levels || []).find((level) => num(level?.level, 1) === 1) || (planSpec?.levels || [])[0];
    const windows = openingsOnEdge(level1, edge, 'windows').length;
    const garageDoor = doorOnEdge(level1, edge, (door) => Boolean(door?.garageDoor));
    const entryDoor = doorOnEdge(level1, edge, (door) => String(door?.b) === '__exterior__' && !door?.garageDoor);
    return {
      viewKey,
      score: (garageDoor ? 8 : 0) + (entryDoor ? 5 : 0) + windows,
    };
  }).sort((a, b) => b.score - a.score);

  return scores[0]?.viewKey || 'right';
}

function renderElevations(planSpec, surveyData = {}) {
  const frontEdge = inferFrontEdge(planSpec, String(planSpec?.facade?.frontEdge || 'bottom'));
  const style = getElevationStyleProfile(surveyData);
  const supportViewKey = chooseSupportViewKey(planSpec, surveyData);

  return {
    frontSvg: renderElevationForView(planSpec, surveyData, 'front'),
    rearSvg: renderElevationForView(planSpec, surveyData, 'rear'),
    leftSvg: renderElevationForView(planSpec, surveyData, 'left'),
    rightSvg: renderElevationForView(planSpec, surveyData, 'right'),
    meta: {
      styleId: style.id,
      styleLabel: style.label,
      styleSubtitle: style.subtitle,
      roofKind: style.roofKind,
      frontEdge,
      frontFacing: surveyData?.frontFacing || planSpec?.facade?.frontFacing || 'South',
      supportViewKey,
      supportFacing: getFacingLabelForView(surveyData?.frontFacing || planSpec?.facade?.frontFacing, supportViewKey),
    },
  };
}

function renderFrontElevationSvg(planSpec, surveyData = {}) {
  return renderElevationForView(planSpec, surveyData, 'front');
}

module.exports = {
  getElevationStyleProfile,
  renderElevationForView,
  renderElevations,
  renderFrontElevationSvg,
};
