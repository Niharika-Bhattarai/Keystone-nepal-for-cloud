const { doorSwingSign } = require('./openingPresentation');
// lib/renderPlanSvg.js
// Architectural floor plan renderer — proper wall thickness, door swings,
// window glazing symbols, stair risers, and clean room labels.

const { patternIdForRoom, planPresentationDefs } = require('./planPresentationStyles');
const { isOutdoorType } = require('./tile/canonicalRoomTypes');
const { renderedPlanDefs, renderedFloorFill, styleFurniture } = require('./renderedPlanStyles');
const { escXml } = require('./svgText');
const { openPairKeys, pairKey } = require('./openEdges');

const ROOM_COLORS = {
  living_room:      '#EEF4FB',
  dining_room:      '#F0F8EE',
  kitchen:          '#FFF8EE',
  primary_bedroom:  '#F8F0F8',
  primary_bathroom: '#EEF8FB',
  bedroom:          '#F5F0FB',
  guest_bedroom:    '#F5F0FB',
  bathroom:         '#EEF8FB',
  powder_room:      '#EEF8FB',
  garage:           '#F0F0F0',
  stairs:           '#F5F5DC',
  hallway:          '#F9F9F9',
  entry:            '#FFFEF0',
  mudroom:          '#F2EDE4',
  laundry:          '#EDF5F0',
  study:            '#FFF5F0',
  loft:             '#F7F3EA',
  gaming_room:      '#F0F0FF',
  playroom:         '#F4F2DF',
  gym:              '#F0FFF0',
  library:          '#FFF8EE',
  movie_room:       '#F0EEF8',
  storage:          '#F5F5F5',
  covered_porch:    '#E8E0D0',
  open_deck:        '#E0D8C8',
  screened_porch:   '#E4DCD0',
  patio:            '#DCD4C4',
};

// Outdoor living (level.outdoor, outside the house): the structure's own
// finish drawn under the walls, with its name and size.
const OUTDOOR_NAMES = { covered_porch: 'COVERED PORCH', open_deck: 'DECK', screened_porch: 'SCREENED PORCH', patio: 'PATIO' };
function outdoorLivingSvg(items, startX, startY) {
  return (items || []).map((o) => {
    const x = startX + num(o.x) * PX, y = startY + num(o.y) * PX, w = num(o.w) * PX, h = num(o.h) * PX;
    const along = o.side === 'top' || o.side === 'bottom';
    const out = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${roomColor(o.type)}" stroke="#8B7D6B" stroke-width="1.5"${o.screened ? ' stroke-dasharray="6 3"' : ''}/>`];
    if (o.type === 'open_deck') {
      // Boards run along the house, one line a foot.
      const n = Math.floor(along ? num(o.h) : num(o.w));
      for (let i = 1; i < n; i++) {
        out.push(along ? `<line x1="${x}" y1="${y + i * PX}" x2="${x + w}" y2="${y + i * PX}" stroke="#c9bda6" stroke-width="0.7"/>`
          : `<line x1="${x + i * PX}" y1="${y}" x2="${x + i * PX}" y2="${y + h}" stroke="#c9bda6" stroke-width="0.7"/>`);
      }
    } else if (o.type === 'patio') {
      for (let i = 2; i < num(o.w); i += 2) out.push(`<line x1="${x + i * PX}" y1="${y}" x2="${x + i * PX}" y2="${y + h}" stroke="#c7bfae" stroke-width="0.6"/>`);
      for (let i = 2; i < num(o.h); i += 2) out.push(`<line x1="${x}" y1="${y + i * PX}" x2="${x + w}" y2="${y + i * PX}" stroke="#c7bfae" stroke-width="0.6"/>`);
    }
    if (o.covered) {
      // Posts along the outer edge, at most ten feet apart.
      const span = along ? num(o.w) : num(o.h);
      const count = Math.max(2, Math.ceil(span / 10) + 1);
      for (let i = 0; i < count; i++) {
        const t = (span - 0.5) * i / (count - 1);
        const px = along ? x + t * PX : (o.side === 'left' ? x : x + w - 0.5 * PX);
        const py = along ? (o.side === 'top' ? y : y + h - 0.5 * PX) : y + t * PX;
        out.push(`<rect x="${px}" y="${py}" width="${0.5 * PX}" height="${0.5 * PX}" fill="#6f6252"/>`);
      }
    }
    const cx = x + w / 2, cy = y + h / 2;
    out.push(`<text x="${cx}" y="${cy - 4}" class="rl" font-size="11" font-weight="700" fill="#111" text-anchor="middle" letter-spacing="0.06em">${OUTDOOR_NAMES[o.type] || 'OUTDOOR'}</text>`);
    out.push(`<text x="${cx}" y="${cy + 10}" class="rl" font-size="10" fill="#777" text-anchor="middle">${num(o.w)}' × ${num(o.h)}' · ${Math.round(num(o.w) * num(o.h))} sq ft</text>`);
    return `<g class="outdoor-living">${out.join('')}</g>`;
  }).join('\n');
}

function roomColor(type) {
  return ROOM_COLORS[String(type || '').toLowerCase()] || '#FFFFFF';
}

function openingProfileLabel(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'maximum_glazing') return 'MAXIMUM GLAZING';
  if (profile === 'privacy_first') return 'PRIVACY FIRST';
  return 'BALANCED';
}

function doorwayProfileLabel(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'wide') return 'WIDE';
  return 'STANDARD';
}

function indoorOutdoorProfileLabel(value) {
  const profile = String(value || '').toLowerCase();
  if (profile === 'maximum_outdoor') return 'MAX OUTDOOR';
  if (profile === 'enclosed') return 'ENCLOSED';
  return 'MODERATE';
}

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fb !== undefined ? fb : 0);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roomRects(level) {
  const rects = [];
  for (const room of (level?.rooms || [])) {
    if (Array.isArray(room?.parts) && room.parts.length) {
      for (const part of room.parts) {
        const w = num(part?.w);
        const h = num(part?.h);
        if (w > 0 && h > 0) {
          rects.push({ x: num(part?.x), y: num(part?.y), w, h });
        }
      }
      continue;
    }
    const w = num(room?.w);
    const h = num(room?.h);
    if (w > 0 && h > 0) {
      rects.push({ x: num(room?.x), y: num(room?.y), w, h });
    }
  }
  return rects;
}

function mergeOutlineSegments(segments) {
  const EPS = 1e-6;
  const horizontal = segments
    .filter((segment) => Math.abs(segment.y1 - segment.y2) < EPS)
    .sort((a, b) => (a.y1 - b.y1) || (a.x1 - b.x1) || (a.x2 - b.x2));
  const vertical = segments
    .filter((segment) => Math.abs(segment.x1 - segment.x2) < EPS)
    .sort((a, b) => (a.x1 - b.x1) || (a.y1 - b.y1) || (a.y2 - b.y2));

  function merge(sorted, axis) {
    const merged = [];
    for (const segment of sorted) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push({ ...segment });
        continue;
      }
      if (axis === 'h') {
        if (Math.abs(prev.y1 - segment.y1) < EPS && Math.abs(prev.x2 - segment.x1) < EPS) {
          prev.x2 = segment.x2;
          continue;
        }
      } else if (Math.abs(prev.x1 - segment.x1) < EPS && Math.abs(prev.y2 - segment.y1) < EPS) {
        prev.y2 = segment.y2;
        continue;
      }
      merged.push({ ...segment });
    }
    return merged;
  }

  return [...merge(horizontal, 'h'), ...merge(vertical, 'v')];
}

function resolveLevelExteriorGeometry(level) {
  if (Array.isArray(level?.outlineSegments) && level.outlineSegments.length) {
    return {
      segments: mergeOutlineSegments(level.outlineSegments.map((segment) => ({
        x1: num(segment?.x1),
        y1: num(segment?.y1),
        x2: num(segment?.x2),
        y2: num(segment?.y2),
      }))),
      areaSqFt: num(level?.envelopeAreaSqFt, num(level?.width) * num(level?.height)),
    };
  }
  const fallbackSegments = [
    { x1: 0, y1: 0, x2: num(level?.width), y2: 0 },
    { x1: num(level?.width), y1: 0, x2: num(level?.width), y2: num(level?.height) },
    { x1: num(level?.width), y1: num(level?.height), x2: 0, y2: num(level?.height) },
    { x1: 0, y1: num(level?.height), x2: 0, y2: 0 },
  ];
  const rects = roomRects(level);
  if (!rects.length) {
    return {
      segments: fallbackSegments,
      areaSqFt: num(level?.width) * num(level?.height),
    };
  }

  const xs = [...new Set(rects.flatMap((rect) => [rect.x, rect.x + rect.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((rect) => [rect.y, rect.y + rect.h]))].sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) {
    return {
      segments: fallbackSegments,
      areaSqFt: num(level?.width) * num(level?.height),
    };
  }

  const cells = [];
  let areaSqFt = 0;
  for (let ix = 0; ix < xs.length - 1; ix++) {
    cells[ix] = [];
    const x0 = xs[ix];
    const x1 = xs[ix + 1];
    const midX = (x0 + x1) / 2;
    for (let iy = 0; iy < ys.length - 1; iy++) {
      const y0 = ys[iy];
      const y1 = ys[iy + 1];
      const midY = (y0 + y1) / 2;
      const occupied = rects.some((rect) =>
        midX >= rect.x && midX < rect.x + rect.w &&
        midY >= rect.y && midY < rect.y + rect.h
      );
      cells[ix][iy] = occupied;
      if (occupied) areaSqFt += (x1 - x0) * (y1 - y0);
    }
  }

  const segments = [];
  for (let ix = 0; ix < xs.length - 1; ix++) {
    for (let iy = 0; iy < ys.length - 1; iy++) {
      if (!cells[ix][iy]) continue;
      const x0 = xs[ix];
      const x1 = xs[ix + 1];
      const y0 = ys[iy];
      const y1 = ys[iy + 1];
      if (ix === 0 || !cells[ix - 1][iy]) segments.push({ x1: x0, y1: y0, x2: x0, y2: y1 });
      if (ix === xs.length - 2 || !cells[ix + 1][iy]) segments.push({ x1, y1: y0, x2: x1, y2: y1 });
      if (iy === 0 || !cells[ix][iy - 1]) segments.push({ x1: x0, y1: y0, x2: x1, y2: y0 });
      if (iy === ys.length - 2 || !cells[ix][iy + 1]) segments.push({ x1: x0, y1, x2: x1, y2: y1 });
    }
  }

  return {
    segments: mergeOutlineSegments(segments),
    areaSqFt,
  };
}

function resolveExteriorOutlineSegments(level) {
  return resolveLevelExteriorGeometry(level).segments;
}

const PX       = 18;
const WALL_EXT = 7;   // exterior wall stroke-width px
const WALL_INT = 4;   // interior wall stroke-width px
const PAD      = 100;
const GAP      = 130;
const DOOR_FT  = 3;
const WIN_FT   = 4;

function openingProfileAnnotationSvg(planSpec, x = PAD, y = 42) {
  const diagnostics = planSpec?.openingDiagnostics || null;
  const profiles = diagnostics?.profiles || {};
  const totals = diagnostics?.totals || {};
  const openingLabel = openingProfileLabel(profiles?.openingProfile);
  const doorwayLabel = doorwayProfileLabel(profiles?.doorwayProfile);
  const indoorOutdoorLabel = indoorOutdoorProfileLabel(profiles?.indoorOutdoorProfile);

  const windows = Math.round(num(totals?.windowCount));
  const exteriorDoors = Math.round(num(totals?.exteriorDoorCount));
  const wideDoors = Math.round(num(totals?.wideDoorCount));

  return `
    <g class="opening-profile-annotation">
      <text x="${x}" y="${y}" class="dl" font-size="12" fill="#7C6A2F" font-weight="700" letter-spacing="0.06em">OPENINGS: ${openingLabel}</text>
      <text x="${x}" y="${y + 18}" class="dl" font-size="11" fill="#8E8159" font-weight="600" letter-spacing="0.05em">DOORWAYS: ${doorwayLabel} · IN/OUT: ${indoorOutdoorLabel}</text>
      <text x="${x}" y="${y + 34}" class="dl" font-size="10" fill="#9B8F6A" font-weight="500" letter-spacing="0.03em">WINDOWS ${windows} · EXTERIOR DOORS ${exteriorDoors} · WIDE DOORS ${wideDoors}</text>
    </g>
  `;
}

// ── STAIR RISERS ────────────────────────────────────────────────────────────
function resolveDrawableStairGeometry(level, room) {
  if (!room || String(level?.stairCore?.roomId) !== String(room.id)) return null;
  const layout = level.stairCore.layout;
  return layout?.valid ? layout : null;
}

function stairRisersSvg(levelObj, room, startX, startY) {
  const geometry = resolveDrawableStairGeometry(levelObj, room);
  if (geometry) return fittedStairSvg(geometry, levelObj, startX, startY);
  const label = levelObj?.stairCore?.layout?.valid === false ? 'STAIR NEEDS REFIT' : 'STAIR DATA NEEDED';
  return `<text class="stair-fit-error" x="${startX+(room.x+room.w/2)*PX}" y="${startY+(room.y+room.h/2)*PX}" text-anchor="middle" font-size="9" fill="#9b2727">${escXml(label)}</text>`;
}

function fittedStairSvg(layout, level, startX, startY) {
  const parts = [`<g class="stair-layout" data-stair-kind="${layout.kind}" data-risers="${layout.risers}" data-riser-ft="${layout.riserFt}" data-tread-ft="${layout.treadFt}">`];
  const point = p => ({x:startX+p.x*PX,y:startY+p.y*PX});
  const box = (r,cls,fill) => `<rect class="${cls}" x="${startX+r.x*PX}" y="${startY+r.y*PX}" width="${r.w*PX}" height="${r.h*PX}" fill="${fill}" stroke="#a99d80" stroke-width="0.9"/>`;
  for(const r of layout.landings) parts.push(box(r,'stair-landing','#F8F4E3'));
  for(const flight of layout.flights) {
    parts.push(box(flight.rect,'stair-run','#F4EFD2'));
    const a=point(flight.from),b=point(flight.to),vertical=Math.abs(a.x-b.x)<1e-6;
    // n risers bound n-1 full-depth treads; no rescaling into a smaller box.
    for(let i=0;i<flight.risers;i++) {
      const t=i/(flight.risers-1),x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
      parts.push(vertical
        ? `<line class="stair-riser" x1="${startX+flight.rect.x*PX}" y1="${y}" x2="${startX+(flight.rect.x+flight.rect.w)*PX}" y2="${y}" stroke="#9b9384" stroke-width="0.9"/>`
        : `<line class="stair-riser" x1="${x}" y1="${startY+flight.rect.y*PX}" x2="${x}" y2="${startY+(flight.rect.y+flight.rect.h)*PX}" stroke="#9b9384" stroke-width="0.9"/>`);
    }
  }
  const upper=Number(level.level)>=2;
  const travel=(upper?[...layout.path].reverse():layout.path).map(point).filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.y-all[i-1].y)>0.01);
  const end=travel.at(-1),before=travel.at(-2),angle=Math.atan2(end.y-before.y,end.x-before.x);
  const head=[end,{x:end.x-7*Math.cos(angle-.5),y:end.y-7*Math.sin(angle-.5)},{x:end.x-7*Math.cos(angle+.5),y:end.y-7*Math.sin(angle+.5)}];
  parts.push(`<polyline class="stair-arrow" points="${travel.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#655d4b" stroke-width="1.3"/>`);
  parts.push(`<polygon class="stair-arrow-head" points="${head.map(p=>`${p.x},${p.y}`).join(' ')}" fill="#655d4b"/>`);
  const label=travel[Math.floor(travel.length/2)];
  parts.push(`<text class="stair-arrow-label" x="${label.x+4}" y="${label.y-5}" font-family="Arial,sans-serif" font-size="8" fill="#514b3d">${upper?'DOWN TO L1':'UP TO L2'}</text></g>`);
  return parts.join('\n');
}

// ── DOOR SWING ───────────────────────────────────────────────────────────────
// Draws a proper architectural door symbol:
//   - White gap cutting through the wall
//   - Thin door-leaf line
//   - Dashed quarter-circle arc showing swing path
function doorSwingSvg(door, lvlRooms, PAD, startY) {
  const DOOR_PX = Math.max(0.1, num(door.width ?? door.doorWidth, DOOR_FT)) * PX;
  // ── GARAGE DOOR: wide exterior door with panel lines ──────────────────────
  if (door.garageDoor) {
    const gw = Math.max(0.1, num(door.width, 9)) * PX;
    const cx = PAD + num(door.x) * PX;
    const cy = startY + num(door.y) * PX;
    const halfGw = gw / 2;
    const gapH = WALL_EXT + 7;

    const left  = cx - halfGw;
    const right = cx + halfGw;

    const parts = [];
    const panelDepth = 12;
    const topY = cy - gapH;
    const bottomY = cy + gapH;

    parts.push(`<rect x="${left}" y="${cy - gapH}" width="${gw}" height="${gapH * 2}" fill="#F9F8F4" stroke="none"/>`);
    // Overhead garage-door notation: wide opening with sectional panel box.
    parts.push(`<rect x="${left}" y="${topY + 2}" width="${gw}" height="${panelDepth}" fill="none" stroke="#333" stroke-width="2.2"/>`);
    parts.push(`<line x1="${left}" y1="${topY + 2 + panelDepth / 2}" x2="${right}" y2="${topY + 2 + panelDepth / 2}" stroke="#666" stroke-width="1"/>`);
    parts.push(`<line x1="${left}" y1="${topY + 2 + panelDepth}" x2="${right}" y2="${topY + 2 + panelDepth}" stroke="#333" stroke-width="1.2"/>`);
    const panelCount = Math.max(3, Math.round(num(door.width) / 4));
    for (let i = 1; i < panelCount; i++) {
      const px = left + (gw / panelCount) * i;
      parts.push(`<line x1="${px}" y1="${topY + 2}" x2="${px}" y2="${topY + 2 + panelDepth}" stroke="#777" stroke-width="0.9"/>`);
    }
    parts.push(`<line x1="${left}" y1="${topY + 2 + panelDepth}" x2="${left + 10}" y2="${bottomY - 2}" stroke="#888" stroke-width="1.1"/>`);
    parts.push(`<line x1="${right}" y1="${topY + 2 + panelDepth}" x2="${right - 10}" y2="${bottomY - 2}" stroke="#888" stroke-width="1.1"/>`);
    parts.push(`<line x1="${left}"  y1="${topY}" x2="${left}"  y2="${bottomY}" stroke="#333" stroke-width="2.2"/>`);
    parts.push(`<line x1="${right}" y1="${topY}" x2="${right}" y2="${bottomY}" stroke="#333" stroke-width="2.2"/>`);
    const symbol = parts.join('\n');
    return door.dir === 'vertical' ? `<g transform="rotate(90 ${cx} ${cy})">${symbol}</g>` : symbol;
  }
  // ── END GARAGE DOOR ───────────────────────────────────────────────────────

  const dx = PAD + num(door.x) * PX;
  const dy = startY + num(door.y) * PX;
  const halfD = DOOR_PX / 2;
  const gap   = WALL_EXT + 3;

  if (door.slidingDoor) {
    // Two overlapping leaves in a track, without an impossible eight-foot swing.
    const left = dx - halfD;
    const right = dx + halfD;
    const symbol = `<g data-opening="sliding-door"><rect x="${left}" y="${dy - gap}" width="${DOOR_PX}" height="${gap * 2}" fill="#F9F8F4"/>` +
      `<rect x="${left}" y="${dy - 3}" width="${halfD + 4}" height="3" fill="#dde9ee" stroke="#333"/>` +
      `<rect x="${dx - 4}" y="${dy + 1}" width="${halfD + 4}" height="3" fill="#dde9ee" stroke="#333"/>` +
      `<path d="M${left},${dy - gap}v${gap * 2} M${right},${dy - gap}v${gap * 2}" stroke="#333" fill="none"/></g>`;
    return door.dir === 'vertical' ? `<g transform="rotate(90 ${dx} ${dy})">${symbol}</g>` : symbol;
  }

  const parts = [];

  if (door.openThreshold) {
    if (door.dir === 'vertical') {
      parts.push(`<rect x="${dx - gap}" y="${dy - halfD}" width="${gap * 2}" height="${DOOR_PX}" fill="#F9F8F4" stroke="none"/>`);
      parts.push(`<line x1="${dx - gap}" y1="${dy - halfD}" x2="${dx}" y2="${dy - halfD}" stroke="#333" stroke-width="1.5"/>`);
      parts.push(`<line x1="${dx - gap}" y1="${dy + halfD}" x2="${dx}" y2="${dy + halfD}" stroke="#333" stroke-width="1.5"/>`);
    } else {
      parts.push(`<rect x="${dx - halfD}" y="${dy - gap}" width="${DOOR_PX}" height="${gap * 2}" fill="#F9F8F4" stroke="none"/>`);
      parts.push(`<line x1="${dx - halfD}" y1="${dy - gap}" x2="${dx - halfD}" y2="${dy}" stroke="#333" stroke-width="1.5"/>`);
      parts.push(`<line x1="${dx + halfD}" y1="${dy - gap}" x2="${dx + halfD}" y2="${dy}" stroke="#333" stroke-width="1.5"/>`);
    }
    return parts.join('\n');
  }

  if (door.dir === 'vertical') {
    // Vertical wall — door leaf swings left or right
    // Gap in wall
    parts.push(`<rect x="${dx - gap}" y="${dy - halfD}" width="${gap * 2}" height="${DOOR_PX}" fill="#F9F8F4" stroke="none"/>`);

    const swingRight = doorSwingSign(door, lvlRooms) > 0;
    const hingeX  = dx;
    const hingeY  = dy - halfD;   // hinge at top of opening
    const leafEndX = swingRight ? dx + DOOR_PX : dx - DOOR_PX;

    // Wall opening jamb marks
    parts.push(`<line x1="${hingeX}" y1="${dy - halfD}" x2="${hingeX}" y2="${dy - halfD}" stroke="none"/>`);

    // Door leaf
    parts.push(`<line x1="${hingeX}" y1="${hingeY}" x2="${leafEndX}" y2="${hingeY}" stroke="#333" stroke-width="1.8" stroke-linecap="round"/>`);

    // Swing arc — quarter circle from leaf tip back to wall
    const sweepFlag = swingRight ? 0 : 1;
    const arcEndX = hingeX;
    const arcEndY = hingeY + DOOR_PX;
    parts.push(`<path d="M ${leafEndX} ${hingeY} A ${DOOR_PX} ${DOOR_PX} 0 0 ${sweepFlag} ${arcEndX} ${arcEndY}"
      fill="none" stroke="#aaa" stroke-width="1" stroke-dasharray="4,3"/>`);

    // Small jamb ticks at door edges to show the wall break
    parts.push(`<line x1="${dx - gap}" y1="${dy - halfD}" x2="${dx}" y2="${dy - halfD}" stroke="#333" stroke-width="1.5"/>`);
    parts.push(`<line x1="${dx - gap}" y1="${dy + halfD}" x2="${dx}" y2="${dy + halfD}" stroke="#333" stroke-width="1.5"/>`);

  } else {
    // Horizontal wall — door leaf swings up or down
    parts.push(`<rect x="${dx - halfD}" y="${dy - gap}" width="${DOOR_PX}" height="${gap * 2}" fill="#F9F8F4" stroke="none"/>`);

    const swingDown = doorSwingSign(door, lvlRooms) > 0;
    const hingeX  = dx - halfD;   // hinge at left of opening
    const hingeY  = dy;
    const leafEndY = swingDown ? dy + DOOR_PX : dy - DOOR_PX;

    // Door leaf
    parts.push(`<line x1="${hingeX}" y1="${hingeY}" x2="${hingeX}" y2="${leafEndY}" stroke="#333" stroke-width="1.8" stroke-linecap="round"/>`);

    // Swing arc
    const sweepFlag = swingDown ? 1 : 0;
    const arcEndX = hingeX + DOOR_PX;
    const arcEndY = dy;
    parts.push(`<path d="M ${hingeX} ${leafEndY} A ${DOOR_PX} ${DOOR_PX} 0 0 ${sweepFlag} ${arcEndX} ${arcEndY}"
      fill="none" stroke="#aaa" stroke-width="1" stroke-dasharray="4,3"/>`);

    // Jamb ticks
    parts.push(`<line x1="${dx - halfD}" y1="${dy - gap}" x2="${dx - halfD}" y2="${dy}" stroke="#333" stroke-width="1.5"/>`);
    parts.push(`<line x1="${dx + halfD}" y1="${dy - gap}" x2="${dx + halfD}" y2="${dy}" stroke="#333" stroke-width="1.5"/>`);
  }

  return parts.join('\n');
}

// ── WINDOW SYMBOL ────────────────────────────────────────────────────────────
// Standard arch symbol: three parallel lines — outer glass, air, inner glass
function windowSymbolSvg(win, PAD, startY) {
  const WIN_PX = Math.max(0.1, num(win.width ?? win.windowWidth, WIN_FT)) * PX;
  const wx = PAD + num(win.x) * PX;
  const wy = startY + num(win.y) * PX;
  const half = WIN_PX / 2;
  const gap  = WALL_EXT + 2;
  const parts = [];

  if (win.dir === 'vertical') {
    parts.push(`<rect x="${wx - gap}" y="${wy - half}" width="${gap * 2}" height="${WIN_PX}" fill="#F9F8F4" stroke="none"/>`);
    // Outer frame lines
    parts.push(`<line x1="${wx - 4}" y1="${wy - half}" x2="${wx - 4}" y2="${wy + half}" stroke="#5B9CB3" stroke-width="1.5"/>`);
    parts.push(`<line x1="${wx + 4}" y1="${wy - half}" x2="${wx + 4}" y2="${wy + half}" stroke="#5B9CB3" stroke-width="1.5"/>`);
    // Glazing fill between lines
    parts.push(`<rect x="${wx - 4}" y="${wy - half}" width="8" height="${WIN_PX}" fill="rgba(168,223,245,0.45)" stroke="none"/>`);
  } else {
    parts.push(`<rect x="${wx - half}" y="${wy - gap}" width="${WIN_PX}" height="${gap * 2}" fill="#F9F8F4" stroke="none"/>`);
    parts.push(`<line x1="${wx - half}" y1="${wy - 4}" x2="${wx + half}" y2="${wy - 4}" stroke="#5B9CB3" stroke-width="1.5"/>`);
    parts.push(`<line x1="${wx - half}" y1="${wy + 4}" x2="${wx + half}" y2="${wy + 4}" stroke="#5B9CB3" stroke-width="1.5"/>`);
    parts.push(`<rect x="${wx - half}" y="${wy - 4}" width="${WIN_PX}" height="8" fill="rgba(168,223,245,0.45)" stroke="none"/>`);
  }
  return parts.join('\n');
}

function furnitureItemSvg(item, PAD, startY, rendered = false) {
  const x = PAD + num(item?.x) * PX;
  const y = startY + num(item?.y) * PX;
  const w = num(item?.w) * PX;
  const h = num(item?.h) * PX;
  const kind = String(item?.kind || '').toLowerCase();
  if (!w || !h) return '';

  const stroke = '#8D8C88';
  const fill = 'rgba(255,255,255,0.28)';

  if (kind === 'closet_storage') {
    const horizontal = w >= h;
    const count = Math.max(3, Math.floor((horizontal ? w : h) / 10));
    const hangers = Array.from({ length: count }, (_, i) => {
      const t = (i + 0.5) / count;
      return horizontal
        ? `<path d="M${x + w * t - 3} ${y + h * .3}l3 ${h * .4}l3 ${-h * .4}"/>`
        : `<path d="M${x + w * .3} ${y + h * t - 3}l${w * .4} 3l${-w * .4} 3"/>`;
    }).join('');
    return `<g data-furniture="closet-storage"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${rendered ? '#c6b59b' : fill}" stroke="${stroke}"/>` +
      `<g fill="none" stroke="${stroke}" stroke-width=".8">${hangers}</g></g>`;
  }

  if (kind.includes('bed')) {
    if ([90, 180, 270].includes(item.rotation)) {
      const sideways = item.rotation !== 180;
      const rotated = { ...item, rotation: 0, x: item.x + (sideways ? (item.w - item.h) / 2 : 0),
        y: item.y + (sideways ? (item.h - item.w) / 2 : 0), w: sideways ? item.h : item.w, h: sideways ? item.w : item.h };
      return `<g transform="rotate(${item.rotation} ${x + w / 2} ${y + h / 2})">${furnitureItemSvg(rotated, PAD, startY, rendered)}</g>`;
    }
    const pillowW = Math.max(10, (w - 10) / 2);
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>
      <line x1="${x}" y1="${y + 10}" x2="${x + w}" y2="${y + 10}" stroke="${stroke}" stroke-width="1"/>
      <rect x="${x + 4}" y="${y + 3}" width="${pillowW}" height="7" rx="2" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      <rect x="${x + w - pillowW - 4}" y="${y + 3}" width="${pillowW}" height="7" rx="2" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      ${rendered ? `<rect x="${x + 2}" y="${y + h * .64}" width="${w - 4}" height="${h * .25}" rx="1" fill="#81908c"/>
      <path d="M${x + 3} ${y + h * .66}H${x + w - 3}M${x + 3} ${y + h * .86}H${x + w - 3}" stroke="#bcc6bf" stroke-width="1"/>
      <path d="M${x + 6} ${y + 15}Q${x + w * .3} ${y + h * .4} ${x + 7} ${y + h * .62}M${x + w - 6} ${y + 15}Q${x + w * .7} ${y + h * .4} ${x + w - 7} ${y + h * .62}" fill="none" stroke="#faf8ee" stroke-width="1.5"/>` : ''}
    `;
  }

  if (kind === 'sofa') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>
      <line x1="${x + 6}" y1="${y + h * 0.5}" x2="${x + w - 6}" y2="${y + h * 0.5}" stroke="${stroke}" stroke-width="1"/>
      <line x1="${x + 6}" y1="${y + 5}" x2="${x + 6}" y2="${y + h - 5}" stroke="${stroke}" stroke-width="1"/>
      <line x1="${x + w - 6}" y1="${y + 5}" x2="${x + w - 6}" y2="${y + h - 5}" stroke="${stroke}" stroke-width="1"/>
    `;
  }

  if (kind === 'coffee_table' || kind === 'dining_table' || kind === 'desk' || kind === 'kitchen_island' || kind === 'counter' || kind === 'console' || kind === 'bench' || kind === 'dresser' || kind === 'bookcase' || kind === 'vanity' || kind === 'laundry_counter') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
  }

  if (kind === 'toilet') {
    // The tank sits against the wall behind it (`back`); older plans only say
    // rotation 90 for a tank on the left.
    const back = ['n', 'e', 's', 'w'].includes(item.back) ? item.back : item.rotation === 90 ? 'w' : 'n';
    if (back === 'e') return `<rect x="${x + w * 0.7}" y="${y}" width="${w * 0.3}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <ellipse cx="${x + w * 0.36}" cy="${y + h / 2}" rx="${w * 0.34}" ry="${h * 0.38}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    if (back === 's') return `<rect x="${x}" y="${y + h * 0.7}" width="${w}" height="${h * 0.3}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <ellipse cx="${x + w / 2}" cy="${y + h * 0.36}" rx="${w * 0.38}" ry="${h * 0.34}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    if (back === 'w') return `<rect x="${x}" y="${y}" width="${w * 0.3}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <ellipse cx="${x + w * 0.64}" cy="${y + h / 2}" rx="${w * 0.34}" ry="${h * 0.38}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h * 0.3}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <ellipse cx="${x + w / 2}" cy="${y + h * 0.64}" rx="${w * 0.38}" ry="${h * 0.34}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
  }

  if (kind === 'tub') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${stroke}" stroke-width="1.2"/>
      <line x1="${x + 8}" y1="${y + h * 0.5}" x2="${x + w - 8}" y2="${y + h * 0.5}" stroke="${stroke}" stroke-width="0.9"/>
    `;
  }

  if (kind === 'shower') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="1.2"/>
      <line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="0.9"/>
      <line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${stroke}" stroke-width="0.9"/>
    `;
  }

  if (kind === 'washer' || kind === 'dryer' || kind === 'stacked_washer_dryer') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>
      <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.max(6, Math.min(w, h) * 0.24)}" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      ${kind === 'stacked_washer_dryer' ? `<text x="${x + w / 2}" y="${y + h * 0.85}" font-size="8" text-anchor="middle" fill="${stroke}">W/D STACK</text>` : ''}
    `;
  }

  if (kind === 'treadmill') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${stroke}" stroke-width="1.2"/>
      <line x1="${x + 6}" y1="${y + h - 5}" x2="${x + w - 6}" y2="${y + h - 5}" stroke="${stroke}" stroke-width="0.9"/>
    `;
  }

  if (kind === 'toy_storage') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>
      <path d="M ${x + w / 3} ${y} v ${h} M ${x + w * 2 / 3} ${y} v ${h}" stroke="${stroke}" stroke-width="0.8"/>`;
  }
  if (kind === 'play_mat') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>
      <path d="M ${x + w / 2} ${y} v ${h} M ${x} ${y + h / 2} h ${w}" stroke="${stroke}" stroke-width="0.6" stroke-dasharray="3,3"/>`;
  }
  if (kind === 'exercise_mat') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-dasharray="4,3"/>`;
  }

  if (kind === 'refrigerator') {
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <line x1="${x + 2}" y1="${y + h * 0.55}" x2="${x + w - 2}" y2="${y + h * 0.55}" stroke="${stroke}" stroke-width="0.8"/>
      <text x="${x + w / 2}" y="${y + h * 0.28}" font-family="Arial,sans-serif" font-size="${Math.max(5, Math.min(w, h) * 0.22)}" fill="${stroke}" text-anchor="middle" dominant-baseline="middle">REF</text>
    `;
  }

  if (kind === 'stove') {
    const br = Math.max(3.5, Math.min(w, h) * 0.13);
    const bx1 = x + w * 0.28; const bx2 = x + w * 0.72;
    const by1 = y + h * 0.28; const by2 = y + h * 0.72;
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <circle cx="${bx1}" cy="${by1}" r="${br}" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      <circle cx="${bx2}" cy="${by1}" r="${br}" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      <circle cx="${bx1}" cy="${by2}" r="${br}" fill="none" stroke="${stroke}" stroke-width="0.9"/>
      <circle cx="${bx2}" cy="${by2}" r="${br}" fill="none" stroke="${stroke}" stroke-width="0.9"/>
    `;
  }

  if (kind === 'car') {
    // Top-down car silhouette: body + windscreen rectangle
    const bodyX = x + 1.5; const bodyY = y + 1.5;
    const bodyW = w - 3;   const bodyH = h - 3;
    const rx    = Math.min(bodyW, bodyH) * 0.14;
    const cabW  = bodyW * 0.72; const cabH = bodyH * 0.46;
    const cabX  = bodyX + (bodyW - cabW) / 2;
    const cabY  = bodyY + bodyH * 0.24;
    return `
      <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="${rx}" fill="rgba(180,185,205,0.38)" stroke="${stroke}" stroke-width="1.1"/>
      <rect x="${cabX}"  y="${cabY}"  width="${cabW}"  height="${cabH}"  rx="${rx * 0.6}" fill="rgba(140,160,210,0.28)" stroke="${stroke}" stroke-width="0.8"/>
    `;
  }

  if (kind === 'outdoor_table') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="#8B7D6B" stroke-width="1.2"/>`;
  }

  if (kind === 'outdoor_chair') {
    return `<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) * 0.45}" fill="none" stroke="#8B7D6B" stroke-width="1"/>`;
  }

  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>`;
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
module.exports = {
  renderPlanSvg(planSpec, options = {}) {
    if (!planSpec || !Array.isArray(planSpec.levels)) return '';
    if (planSpec.levels.length > 1 && planSpec.levels.some(l => l.stairCore?.vertical && !l.stairCore.layout) && planSpec.levels.every(l=>l.stairCore?.landingRoomId)) {
      planSpec=require('./stairLayout').applyStairLayouts(JSON.parse(JSON.stringify(planSpec)));
    }
    const rendered = options.style === 'rendered';

    let xOffset = 0;
    let svgHeight = 0;
    const groups = [];

    const defs = `<defs>
      <style>
        .rl { font-family: 'Arial Narrow', 'Arial', sans-serif; }
        .dl { font-family: 'Arial', sans-serif; }
      </style>
      ${planPresentationDefs()}
      ${rendered ? renderedPlanDefs() : ''}
    </defs>`;

    // Outdoor structures on the top side push every level down the same
    // amount, so the floors stay aligned; side ones widen their own level.
    const outdoorTopFt = Math.max(0, ...planSpec.levels.flatMap((l) => (l.outdoor || []).map((o) => -num(o.y))));
    planSpec.levels.forEach((lvl, index) => {
      const levelNum  = lvl.level || (index + 1);
      const wFt   = num(lvl.width,  40);
      const hFt   = num(lvl.height, 40);
      const outdoor = Array.isArray(lvl.outdoor) ? lvl.outdoor : [];
      const leftExtraFt = Math.max(0, ...outdoor.map((o) => -num(o.x)));
      const rightExtraFt = Math.max(0, ...outdoor.map((o) => num(o.x) + num(o.w) - wFt));
      const bottomExtraFt = Math.max(0, ...outdoor.map((o) => num(o.y) + num(o.h) - hFt));
      const exteriorGeometry = resolveLevelExteriorGeometry(lvl);
      
      const levelPxW  = wFt * PX;
      const levelPxH  = hFt * PX;
      
      // Calculate max height
      svgHeight = Math.max(svgHeight, levelPxH + PAD * 2 + 80 + (outdoorTopFt + bottomExtraFt) * PX);
      
      const startX = xOffset + PAD + leftExtraFt * PX;
      const startY = PAD + outdoorTopFt * PX;
      // Where this floor sits in the drawing, for the Studio's edit layer.
      if (options.layout) (options.layout.levels ||= []).push({ level: levelNum, originX: startX, originY: startY, pxPerFt: PX, width: wFt, height: hFt });
      const frameTop = PAD; // title and top dimension stay above any outdoor structure
      const leftDimX = startX - leftExtraFt * PX - 38;

      const tickLen       = 8;
      const dimOff        = 38;

      /* Dimension the storey that was built, not the rectangle it was packed
         into. They are the same for a level that fills its footprint; they
         differ when an upper floor stops short of a single-storey wing, where
         quoting the ground-floor width would state a dimension the drawing
         does not show. The frame itself still uses the footprint so both
         sheets stay aligned and room coordinates remain absolute. */
      const builtRects = (lvl.rooms || [])
        .filter((room) => num(room?.w) > 0 && num(room?.h) > 0);
      const builtX0 = builtRects.length ? Math.min(...builtRects.map((r) => num(r.x))) : 0;
      const builtX1 = builtRects.length ? Math.max(...builtRects.map((r) => num(r.x) + num(r.w))) : wFt;
      const builtY0 = builtRects.length ? Math.min(...builtRects.map((r) => num(r.y))) : 0;
      const builtY1 = builtRects.length ? Math.max(...builtRects.map((r) => num(r.y) + num(r.h))) : hFt;
      const builtWFt = Math.max(1, builtX1 - builtX0);
      const builtHFt = Math.max(1, builtY1 - builtY0);
      const dimX0 = startX + builtX0 * PX;
      const dimX1 = startX + builtX1 * PX;
      const dimY0 = startY + builtY0 * PX;
      const dimY1 = startY + builtY1 * PX;

      // ── DIMENSION LINES ──────────────────────────────────────────────
      const dims = `
        <line x1="${dimX0}" y1="${frameTop - dimOff}" x2="${dimX1}" y2="${frameTop - dimOff}" stroke="#5B7C99" stroke-width="1.2"/>
        <line x1="${dimX0}" y1="${frameTop - dimOff - tickLen/2}" x2="${dimX0}" y2="${frameTop - dimOff + tickLen/2}" stroke="#5B7C99" stroke-width="1.2"/>
        <line x1="${dimX1}" y1="${frameTop - dimOff - tickLen/2}" x2="${dimX1}" y2="${frameTop - dimOff + tickLen/2}" stroke="#5B7C99" stroke-width="1.2"/>
        <text x="${(dimX0 + dimX1)/2}" y="${frameTop - dimOff - 10}" class="dl" font-size="13" fill="#5B7C99" text-anchor="middle" font-weight="600">${builtWFt}'</text>
        <line x1="${leftDimX}" y1="${dimY0}" x2="${leftDimX}" y2="${dimY1}" stroke="#5B7C99" stroke-width="1.2"/>
        <line x1="${leftDimX-tickLen/2}" y1="${dimY0}" x2="${leftDimX+tickLen/2}" y2="${dimY0}" stroke="#5B7C99" stroke-width="1.2"/>
        <line x1="${leftDimX-tickLen/2}" y1="${dimY1}" x2="${leftDimX+tickLen/2}" y2="${dimY1}" stroke="#5B7C99" stroke-width="1.2"/>
        <text x="${leftDimX-10}" y="${(dimY0 + dimY1)/2}" class="dl" font-size="13" fill="#5B7C99" text-anchor="end" dominant-baseline="middle" font-weight="600">${builtHFt}'</text>
      `;

      // ── LAYER 1: ROOM FILLS ──────────────────────────────────────────
      // Each room renders two passes: base color + optional material pattern overlay.
      const roomFills = (lvl.rooms || []).map((r) => {
        const rw = num(r.w); const rh = num(r.h);
        if (!rw || !rh) return '';
        const fill    = rendered ? renderedFloorFill(r, planSpec.finishSpec) : String(r.type).toLowerCase() === 'stairs' ? '#FAF6E8' : roomColor(r.type);
        const patId   = rendered || String(r.type).toLowerCase() === 'stairs' ? null : patternIdForRoom(r.type);
        const patFill = patId ? `url(#${patId})` : null;

        const isOutdoor = isOutdoorType(r.type);
        function roomRect(px, py, pw, ph) {
          const base = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${fill}" stroke="none"/>`;
          const pat  = patFill ? `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${patFill}" stroke="none"/>` : '';
          const dash = isOutdoor ? `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="none" stroke="#8B7D6B" stroke-width="2" stroke-dasharray="8 4"/>` : '';
          return base + pat + dash;
        }

        if (Array.isArray(r.parts) && r.parts.length > 1) {
          return r.parts.map((p) => {
            const px = startX + num(p.x) * PX;
            const py = startY + num(p.y) * PX;
            return roomRect(px, py, num(p.w) * PX, num(p.h) * PX);
          }).join('\n');
        }
        const rx = startX + num(r.x) * PX;
        const ry = startY + num(r.y) * PX;
        return roomRect(rx, ry, rw * PX, rh * PX);
      }).join('\n');

      // ── LAYER 2: STAIR RISERS ────────────────────────────────────────
      const stairSvg = (lvl.rooms || [])
        .filter((r) => String(r.type).toLowerCase() === 'stairs')
        .map((r) => stairRisersSvg({ ...lvl, __allLevels: planSpec.levels }, r, startX, startY))
        .join('\n');

      // Each piece is its own group, so the Studio's edit mode can take hold of it.
      const furnitureSvg = (lvl.furniture || [])
        .map((item) => {
          const markup = rendered ? styleFurniture(furnitureItemSvg(item, startX, startY, true), item) : furnitureItemSvg(item, startX, startY);
          return markup ? `<g data-item="${escXml(String(item.id || ''))}">${markup}</g>` : '';
        })
        .join('\n');

      // ── LAYER 3: INTERIOR WALLS (room borders) ───────────────────────
      const OPEN_CONCEPT_TYPES = new Set(['kitchen', 'dining_room', 'living_room', 'hallway']);
      const isOpenConcept = Boolean(planSpec.openConcept);

      // Build a lookup of which edges each stair has a door on.
      // A stair should only open on the side where its door is placed —
      // opening on all adjacent circulation walls creates a physically
      // impossible pass-through staircase.
      const stairDoorEdges = new Map();
      {
        const EPS_D = 0.15;
        const roomById = new Map((lvl.rooms || []).map((r) => [String(r.id), r]));
        const explicitLandingSide = String(lvl.stairCore?.landingSide || '').toLowerCase();
        const hasExplicitLandingSide =
          explicitLandingSide === 'top' ||
          explicitLandingSide === 'bottom' ||
          explicitLandingSide === 'left' ||
          explicitLandingSide === 'right';

        for (const room of (lvl.rooms || [])) {
          if (String(room.type).toLowerCase() !== 'stairs') continue;
          if (!stairDoorEdges.has(String(room.id))) stairDoorEdges.set(String(room.id), new Set());
          if (hasExplicitLandingSide) stairDoorEdges.get(String(room.id)).add(explicitLandingSide);
        }

        for (const d of (lvl.doors || [])) {
          const aId = String(d.a || '');
          const bId = String(d.b || '');
          const aRoom = roomById.get(aId);
          const bRoom = roomById.get(bId);
          if (!aRoom || !bRoom) continue;
          const aIsStair = String(aRoom.type).toLowerCase() === 'stairs';
          const bIsStair = String(bRoom.type).toLowerCase() === 'stairs';
          if (!aIsStair && !bIsStair) continue;
          const stair = aIsStair ? aRoom : bRoom;
          const sId = String(stair.id);
          if (!stairDoorEdges.has(sId)) stairDoorEdges.set(sId, new Set());
          if (hasExplicitLandingSide) continue;
          const dx = num(d.x);
          const dy = num(d.y);
          const sx = num(stair.x);
          const sy = num(stair.y);
          const sx2 = sx + num(stair.w);
          const sy2 = sy + num(stair.h);
          if (Math.abs(dx - sx) < EPS_D)  stairDoorEdges.get(sId).add('left');
          if (Math.abs(dx - sx2) < EPS_D) stairDoorEdges.get(sId).add('right');
          if (Math.abs(dy - sy) < EPS_D)  stairDoorEdges.get(sId).add('top');
          if (Math.abs(dy - sy2) < EPS_D) stairDoorEdges.get(sId).add('bottom');
        }
      }

      const openConceptAdj = (room, edge) => {
        const rType = String(room.type);
        const isRoomCirculation = rType === 'hallway' || rType === 'entry';
        const isRoomStair = rType === 'stairs';
        const isOpenConceptRoom = isOpenConcept && OPEN_CONCEPT_TYPES.has(rType);

        if (!isOpenConceptRoom && !isRoomStair && !isRoomCirculation) return false;

        const EPS = 0.15;
        const roms = lvl.rooms || [];
        return roms.some((o) => {
          if (o.id === room.id) return false;
          
          const oType = String(o.type);
          const isOtherCirculation = oType === 'hallway' || oType === 'entry';
          const isOtherStair = oType === 'stairs';
          const isOtherOpenConcept = isOpenConcept && OPEN_CONCEPT_TYPES.has(oType);

          const isStairOpen = (isRoomStair && isOtherCirculation) || (isOtherStair && isRoomCirculation);
          const isOpenConceptMatch = isOpenConceptRoom && isOtherOpenConcept;

          if (!isStairOpen && !isOpenConceptMatch) return false;

          // For stair openings, only suppress the wall on the edge where a
          // door actually exists. This prevents the stair from appearing
          // open on both sides (a physical impossibility).
          if (isStairOpen) {
            const stairRoom = isRoomStair ? room : o;
            const stairEdge = isRoomStair ? edge : (
              edge === 'left' ? 'right' : edge === 'right' ? 'left' :
              edge === 'top' ? 'bottom' : 'top'
            );
            const edges = stairDoorEdges.get(String(stairRoom.id));
            if (!edges || !edges.has(stairEdge)) return false;
          }

          const rx2 = num(room.x) + num(room.w);
          const ry2 = num(room.y) + num(room.h);
          return (o.parts?.length ? o.parts : [o]).some(o => {
            const ox2 = num(o.x) + num(o.w);
            const oy2 = num(o.y) + num(o.h);
            const yOverlap = Math.max(num(room.y), num(o.y)) < Math.min(ry2, oy2) - EPS;
            const xOverlap = Math.max(num(room.x), num(o.x)) < Math.min(rx2, ox2) - EPS;
            if (edge === 'right') return Math.abs(num(o.x) - rx2) < EPS && yOverlap;
            if (edge === 'left') return Math.abs(ox2 - num(room.x)) < EPS && yOverlap;
            if (edge === 'bottom') return Math.abs(num(o.y) - ry2) < EPS && xOverlap;
            if (edge === 'top') return Math.abs(oy2 - num(room.y)) < EPS && xOverlap;
            return false;
          });
        });
      };

      // Walls a person took out in the Studio's edit mode (level.openEdges).
      const userOpenPairs = openPairKeys(lvl);
      const partsOfRoom = (r) => (Array.isArray(r.parts) && r.parts.length ? r.parts : [r]);

      // Each part's four sides, less the stretches that stay open: seams with
      // the room's own other parts, and walls a person took out in edit mode.
      // Only those stretches are left out, so a neighbour's wall on the rest
      // of the side is never lost with them.
      function compositeWallSegs(room, sw) {
        const parts = Array.isArray(room.parts) && room.parts.length > 1
          ? room.parts
          : [{ x: num(room.x), y: num(room.y), w: num(room.w), h: num(room.h) }];
        const openTo = (lvl.rooms || []).filter((o) => o !== room && userOpenPairs.has(pairKey(room.id, o.id)));
        const EPS = 0.01;
        const segs = [];
        for (const p of parts) {
          const partRoom = { ...room, ...p };
          const x0 = num(p.x), y0 = num(p.y), x1 = x0 + num(p.w), y1 = y0 + num(p.h);
          const sides = {
            top: { horizontal: true, at: y0, lo: x0, hi: x1, meets: (q) => Math.abs(num(q.y) + num(q.h) - y0) < EPS },
            bottom: { horizontal: true, at: y1, lo: x0, hi: x1, meets: (q) => Math.abs(num(q.y) - y1) < EPS },
            left: { horizontal: false, at: x0, lo: y0, hi: y1, meets: (q) => Math.abs(num(q.x) + num(q.w) - x0) < EPS },
            right: { horizontal: false, at: x1, lo: y0, hi: y1, meets: (q) => Math.abs(num(q.x) - x1) < EPS },
          };
          for (const [edge, side] of Object.entries(sides)) {
            if (openConceptAdj(partRoom, edge)) continue;
            const others = [...parts.filter((o) => o !== p), ...openTo.flatMap(partsOfRoom)];
            const gaps = others.filter(side.meets).map((q) => side.horizontal
              ? [Math.max(side.lo, num(q.x)), Math.min(side.hi, num(q.x) + num(q.w))]
              : [Math.max(side.lo, num(q.y)), Math.min(side.hi, num(q.y) + num(q.h))])
              .filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0]);
            let from = side.lo;
            const pieces = [];
            for (const [a, b] of gaps) {
              if (a - from > EPS) pieces.push([from, a]);
              from = Math.max(from, b);
            }
            if (side.hi - from > EPS) pieces.push([from, side.hi]);
            for (const [a, b] of pieces) {
              segs.push(side.horizontal
                ? `<line x1="${startX + a * PX}" y1="${startY + side.at * PX}" x2="${startX + b * PX}" y2="${startY + side.at * PX}" stroke="#2c2c2e" stroke-width="${sw}"/>`
                : `<line x1="${startX + side.at * PX}" y1="${startY + a * PX}" x2="${startX + side.at * PX}" y2="${startY + b * PX}" stroke="#2c2c2e" stroke-width="${sw}"/>`);
            }
          }
        }
        return segs;
      }

      const intWalls = (lvl.rooms || []).map((r) => {
        const rw = num(r.w); const rh = num(r.h);
        if (!rw || !rh) return '';
        const sw = WALL_INT;
        return compositeWallSegs(r, sw).join('\n');
      }).join('\n');

      // ── LAYER 4: EXTERIOR OUTLINE ────────────────────────────────────
      const extOutline = exteriorGeometry.segments.map((segment) => `
        <line
          class="exterior-outline"
          x1="${startX + segment.x1 * PX}"
          y1="${startY + segment.y1 * PX}"
          x2="${startX + segment.x2 * PX}"
          y2="${startY + segment.y2 * PX}"
          stroke="#111"
          stroke-width="${WALL_EXT}"
          stroke-linecap="square"
          stroke-linejoin="miter"
        />`
      ).join('\n');

      // ── LAYER 5: DOORS ───────────────────────────────────────────────
      const stairIds = new Set(
        (lvl.rooms || [])
          .filter((r) => String(r.type).toLowerCase() === 'stairs')
          .map((r) => r.id)
      );
      const isOcDoor = (d) => {
        if (!isOpenConcept) return false;
        const rA = (lvl.rooms || []).find((r) => String(r.id) === String(d.a));
        const rB = (lvl.rooms || []).find((r) => String(r.id) === String(d.b));
        return rA && rB && OPEN_CONCEPT_TYPES.has(String(rA.type)) && OPEN_CONCEPT_TYPES.has(String(rB.type));
      };
      const doorsSvg = (lvl.doors || [])
        .filter((d) => !stairIds.has(d.a) && !stairIds.has(d.b) && !isOcDoor(d))
        .map((d) => {
          const symbol = doorSwingSvg(d, lvl.rooms || [], startX, startY);
          return rendered ? symbol.replaceAll('fill="#F9F8F4"', `fill="${renderedFloorFill((lvl.rooms || []).find(r => r.id === d.a) || {}, planSpec.finishSpec)}"`) : symbol;
        })
        .join('\n');

      // ── LAYER 6: WINDOWS ─────────────────────────────────────────────
      const winSvg = (lvl.windows || [])
        .map((w) => windowSymbolSvg(w, startX, startY))
        .join('\n');

      // ── LAYER 7: ROOM LABELS ─────────────────────────────────────────
      const roomLabels = (lvl.rooms || []).map((r) => {
        const rw = num(r.w); const rh = num(r.h);
        if (!rw || !rh) return '';
        if (String(r.id || '').startsWith('hall_core_')) return '';

        // For composite rooms, center the label on the largest part.
        let labelPart = r;
        if (Array.isArray(r.parts) && r.parts.length > 1) {
          labelPart = r.parts.reduce((best, p) =>
            num(p.w) * num(p.h) > num(best.w) * num(best.h) ? p : best, r.parts[0]);
        }
        const rpx = num(labelPart.w) * PX;
        const rpy = num(labelPart.h) * PX;
        const cx  = startX + num(labelPart.x)*PX + rpx/2;
        const cy  = startY + num(labelPart.y)*PX + rpy/2;

        const label  = (r.label || r.type || '').toUpperCase().replace(/_/g, ' ');
        const totalArea = Array.isArray(r.parts) && r.parts.length > 1
          ? r.parts.reduce((s, p) => s + num(p.w) * num(p.h), 0)
          : num(r.w) * num(r.h);
        const sqft   = Math.round(totalArea);
        const dimStr = `${rw}' × ${rh}'`;

        const minSide = Math.min(rpx, rpy);
        const fs = minSide < 44 ? 6.5 : minSide < 72 ? 8 : minSide < 110 ? 9 : 10;
        const showDims = rpx >= 58 && rpy >= 34;
        const showSqft = rpx >= 68 && rpy >= 50;
        const lineH = fs + 4;
        const lines  = [{ text: label, bold: true, size: fs }];
        if (showDims)  lines.push({ text: dimStr, bold: false, size: fs - 1.5 });
        if (showSqft)  lines.push({ text: `${sqft} sq ft`, bold: false, size: fs - 1.5 });

        const totalTextH = lines.length * lineH;
        const baseY = cy - totalTextH / 2 + fs;

        return lines.map((ln, i) =>
          `<text x="${cx}" y="${(baseY + i * lineH).toFixed(1)}"
            class="rl"
            font-size="${ln.size}"
            fill="${ln.bold ? '#111' : '#777'}"
            font-weight="${ln.bold ? '700' : '400'}"
            text-anchor="middle"
            letter-spacing="${ln.bold ? '0.06em' : '0'}">${escXml(ln.text)}</text>`
        ).join('\n');
      }).join('\n');

      // ── HEADER ───────────────────────────────────────────────────────
      const sqFt = Math.round(exteriorGeometry.areaSqFt || (wFt * hFt));
      const header = `
        <text x="${startX}" y="${frameTop - 60}" class="dl" font-size="20" font-weight="700" fill="#111" letter-spacing="0.04em">LEVEL ${escXml(levelNum)}</text>
        <text x="${startX}" y="${frameTop - 40}" class="dl" font-size="14" font-weight="500" fill="#777" letter-spacing="0.02em">${sqFt.toLocaleString()} SQ. FT.</text>`;

      groups.push(`<g>
        ${header}
        ${dims}
        ${outdoorLivingSvg(outdoor, startX, startY)}
        ${roomFills}
        ${rendered ? stairSvg.replaceAll('#F4EFD2', 'url(#ksRender_wood)').replaceAll('#F8F4E3', 'url(#ksRender_wood)') : stairSvg}
        ${furnitureSvg}
        ${rendered ? `<g class="rendered-walls" filter="url(#ksRender_wallShadow)">${(intWalls + extOutline).replaceAll('stroke="#2c2c2e"', 'stroke="#fffaf0"').replaceAll('stroke="#111"', 'stroke="#fffaf0"')}</g>` : intWalls + extOutline}
        ${doorsSvg}
        ${winSvg}
        <g class="${rendered ? 'rendered-labels' : 'room-labels'}">${roomLabels}</g>
      </g>`);

      xOffset += levelPxW + (leftExtraFt + rightExtraFt) * PX + PAD + GAP;
    });

    const totalW = xOffset + PAD - GAP; // minus the last GAP
    if (options.layout) Object.assign(options.layout, { width: totalW, height: svgHeight });
    // Keep the opening legend below all plans, clear of floor titles/dimensions.
    const openingAnnotation = openingProfileAnnotationSvg(planSpec, PAD, svgHeight - 65);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${rendered ? 'rendered-plan' : 'normal-plan'}" width="${totalW}" height="${svgHeight}" viewBox="0 0 ${totalW} ${svgHeight}">
      <rect width="100%" height="100%" fill="${rendered ? '#535f64' : '#F9F8F4'}"/>
      ${defs}
      ${openingAnnotation}
      ${groups.join('\n')}
    </svg>`;
  },
  resolveDrawableStairGeometry,
  resolveExteriorOutlineSegments,
  resolveLevelExteriorGeometry,
};
