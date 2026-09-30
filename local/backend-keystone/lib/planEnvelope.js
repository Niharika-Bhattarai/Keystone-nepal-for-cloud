'use strict';

function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (fb !== undefined ? fb : 0);
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

module.exports = {
  mergeOutlineSegments,
  resolveLevelExteriorGeometry,
  resolveExteriorOutlineSegments,
  roomRects,
};
