// lib/tile/tileUtils.js

function createGrid(widthTiles, heightTiles) {
  return Array.from({ length: heightTiles }, () => Array.from({ length: widthTiles }, () => null));
}

function paintRect(grid, rect, value) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (grid[y][x] !== null) {
        throw new Error(`Tile overlap at ${x},${y}`);
      }
      grid[y][x] = value;
    }
  }
}

function rect(x, y, w, h) {
  return { x, y, w, h };
}

function area(rectLike) {
  return rectLike.w * rectLike.h;
}

function cloneRect(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function splitVertical(rectangle, widths) {
  const parts = [];
  let x = rectangle.x;
  for (const w of widths) {
    parts.push(rect(x, rectangle.y, w, rectangle.h));
    x += w;
  }
  return parts;
}

function splitHorizontal(rectangle, heights) {
  const parts = [];
  let y = rectangle.y;
  for (const h of heights) {
    parts.push(rect(rectangle.x, y, rectangle.w, h));
    y += h;
  }
  return parts;
}

function proportionalHeights(totalHeight, widths, targetAreas) {
  const totalArea = targetAreas.reduce((sum, n) => sum + n, 0) || 1;
  const heights = targetAreas.map((a) => Math.max(1, Math.round((a / totalArea) * totalHeight)));
  let diff = totalHeight - heights.reduce((sum, h) => sum + h, 0);
  if (diff < 0 && heights.every((h) => h <= 1)) {
    // Can't shrink further — redistribute proportionally
    const fracs = targetAreas.map((a) => a / totalArea);
    let remaining = totalHeight;
    for (let j = 0; j < heights.length - 1; j++) {
      heights[j] = Math.max(1, Math.round(fracs[j] * totalHeight));
      remaining -= heights[j];
    }
    heights[heights.length - 1] = Math.max(1, remaining);
    return heights;
  }
  let i = 0;
  let safety = totalHeight * heights.length * 4;
  while (diff !== 0 && heights.length && safety-- > 0) {
    const idx = i % heights.length;
    if (diff > 0) { heights[idx] += 1; diff -= 1; }
    else if (heights[idx] > 1) { heights[idx] -= 1; diff += 1; }
    else { i += 1; }
    i += 1;
  }
  return heights;
}

function proportionalWidths(totalWidth, targetAreas, height) {
  const totalArea = targetAreas.reduce((sum, n) => sum + n, 0) || 1;
  const widths = targetAreas.map((a) => Math.max(1, Math.round(a / Math.max(1, height))));
  let total = widths.reduce((sum, w) => sum + w, 0);
  let diff = totalWidth - total;
  // Guard: if all widths are at minimum and we need to shrink, we can't — just scale up
  // to fill totalWidth instead of looping forever.
  if (diff < 0 && widths.every((w) => w <= 1)) {
    // Redistribute proportionally to fill exactly totalWidth
    const fracs = targetAreas.map((a) => a / totalArea);
    let remaining = totalWidth;
    for (let j = 0; j < widths.length - 1; j++) {
      widths[j] = Math.max(1, Math.round(fracs[j] * totalWidth));
      remaining -= widths[j];
    }
    widths[widths.length - 1] = Math.max(1, remaining);
    return widths;
  }
  let i = 0;
  let safety = totalWidth * widths.length * 4; // hard cap to prevent infinite loop
  while (diff !== 0 && widths.length && safety-- > 0) {
    const idx = i % widths.length;
    if (diff > 0) { widths[idx] += 1; diff -= 1; }
    else if (widths[idx] > 1) { widths[idx] -= 1; diff += 1; }
    else { i += 1; } // skip at-minimum entries when shrinking
    i += 1;
  }
  return widths;
}

function fillRectsWithin(rectangle, specs, orientation) {
  if (!specs.length) return [];
  if (orientation === 'horizontal') {
    const heights = proportionalHeights(rectangle.h, specs.map(() => rectangle.w), specs.map((r) => r.targetTiles));
    const rows = splitHorizontal(rectangle, heights);
    return rows.map((r, idx) => ({ ...r, roomSpec: specs[idx] }));
  }
  const TILE_SZ = 2;
  const widths = proportionalWidths(rectangle.w, specs.map((r) => r.targetTiles), rectangle.h);
  // Enforce minimum widths based on minAreaSqFt: a room must be at least
  // ceil(minAreaSqFt / (TILE_SZ^2 * height)) tiles wide.
  const totalMinW = specs.reduce((sum, r) => {
    if (!r.minAreaSqFt) return sum + 1;
    return sum + Math.max(1, Math.ceil(r.minAreaSqFt / (TILE_SZ * TILE_SZ * rectangle.h)));
  }, 0);
  if (totalMinW <= rectangle.w) {
    for (let i = 0; i < widths.length; i++) {
      const spec = specs[i];
      if (!spec.minAreaSqFt) continue;
      const minW = Math.max(1, Math.ceil(spec.minAreaSqFt / (TILE_SZ * TILE_SZ * rectangle.h)));
      if (widths[i] < minW) {
        // Steal from the widest room that has slack
        const slack = widths.map((w, j) => {
          if (j === i) return 0;
          const otherMin = specs[j] && specs[j].minAreaSqFt
            ? Math.max(1, Math.ceil(specs[j].minAreaSqFt / (TILE_SZ * TILE_SZ * rectangle.h)))
            : 1;
          return Math.max(0, w - otherMin);
        });
        const maxSlackIdx = slack.indexOf(Math.max(...slack));
        const need = minW - widths[i];
        const canTake = Math.min(need, slack[maxSlackIdx]);
        if (canTake > 0) {
          widths[maxSlackIdx] -= canTake;
          widths[i] += canTake;
        }
      }
    }
  }
  const cols = splitVertical(rectangle, widths);
  return cols.map((r, idx) => ({ ...r, roomSpec: specs[idx] }));
}

function paintPolyomino(grid, parts, value) {
  for (const part of parts) {
    for (let y = part.y; y < part.y + part.h; y++) {
      for (let x = part.x; x < part.x + part.w; x++) {
        if (grid[y][x] !== null) {
          throw new Error(`Tile overlap at ${x},${y}`);
        }
        grid[y][x] = value;
      }
    }
  }
}

function tryPolyominoFit(grid, parts) {
  for (const part of parts) {
    if (part.y < 0 || part.x < 0) return false;
    for (let y = part.y; y < part.y + part.h; y++) {
      if (y >= grid.length) return false;
      for (let x = part.x; x < part.x + part.w; x++) {
        if (x >= grid[0].length) return false;
        if (grid[y][x] !== null) return false;
      }
    }
  }
  return true;
}

function findLShapedGap(grid, widthTiles, heightTiles, minArea = 4) {
  const H = heightTiles;
  const W = widthTiles;
  const results = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== null) continue;

      // Find maximal horizontal span of null tiles starting at (x, y)
      let maxW = 0;
      while (x + maxW < W && grid[y][x + maxW] === null) maxW++;
      if (maxW < 2) continue;

      // Find height of this rect
      let maxH = 0;
      outer: for (let dy = 0; y + dy < H; dy++) {
        for (let dx = 0; dx < maxW; dx++) {
          if (grid[y + dy][x + dx] !== null) break outer;
        }
        maxH++;
      }

      // Try L-shapes by finding an adjacent extension
      const baseRect = { x, y, w: maxW, h: maxH };
      const baseArea = maxW * maxH;

      // Extension below-right: narrower rect extending downward
      for (let ew = 1; ew < maxW; ew++) {
        let eh = 0;
        while (y + maxH + eh < H) {
          let rowOk = true;
          for (let dx = 0; dx < ew; dx++) {
            if (grid[y + maxH + eh][x + dx] !== null) { rowOk = false; break; }
          }
          if (!rowOk) break;
          eh++;
        }
        if (eh > 0 && baseArea + ew * eh >= minArea) {
          results.push({
            parts: [baseRect, { x, y: y + maxH, w: ew, h: eh }],
            area: baseArea + ew * eh,
          });
        }
      }

      // Extension below-left: narrower rect extending downward aligned right
      for (let ew = 1; ew < maxW; ew++) {
        const ex = x + maxW - ew;
        let eh = 0;
        while (y + maxH + eh < H) {
          let rowOk = true;
          for (let dx = 0; dx < ew; dx++) {
            if (grid[y + maxH + eh][ex + dx] !== null) { rowOk = false; break; }
          }
          if (!rowOk) break;
          eh++;
        }
        if (eh > 0 && baseArea + ew * eh >= minArea) {
          results.push({
            parts: [baseRect, { x: ex, y: y + maxH, w: ew, h: eh }],
            area: baseArea + ew * eh,
          });
        }
      }

      // Extension right: narrower rect extending to the right
      for (let eh = 1; eh < maxH; eh++) {
        let ew = 0;
        while (x + maxW + ew < W) {
          let colOk = true;
          for (let dy = 0; dy < eh; dy++) {
            if (grid[y + dy][x + maxW + ew] !== null) { colOk = false; break; }
          }
          if (!colOk) break;
          ew++;
        }
        if (ew > 0 && baseArea + ew * eh >= minArea) {
          results.push({
            parts: [baseRect, { x: x + maxW, y, w: ew, h: eh }],
            area: baseArea + ew * eh,
          });
        }
      }
    }
  }

  // Sort by area descending, return unique gaps
  results.sort((a, b) => b.area - a.area);
  return results;
}

module.exports = { createGrid, paintRect, paintPolyomino, tryPolyominoFit, findLShapedGap, rect, area, cloneRect, splitVertical, splitHorizontal, fillRectsWithin };
