// lib/tile/validateTilePlan.js
const { createGrid, paintRect, paintPolyomino } = require('./tileUtils');

function validateTilePlan(tilePlan) {
  const errors = [];

  if (!tilePlan || typeof tilePlan !== 'object') return ['Tile plan is missing or invalid'];
  if (!Array.isArray(tilePlan.levels) || tilePlan.levels.length === 0) return ['Tile plan has no levels'];

  for (const level of tilePlan.levels || []) {
    if (!level || typeof level !== 'object') { errors.push('Invalid level object in tile plan'); continue; }
    if (!Number.isFinite(level.level)) { errors.push('Tile plan level is missing a numeric level index'); continue; }
    if (!Number.isFinite(level.widthTiles) || level.widthTiles <= 0) { errors.push(`Level ${level.level}: invalid widthTiles`); continue; }
    if (!Number.isFinite(level.heightTiles) || level.heightTiles <= 0) { errors.push(`Level ${level.level}: invalid heightTiles`); continue; }
    if (!Array.isArray(level.rooms) || level.rooms.length === 0) { errors.push(`Level ${level.level}: no rooms generated`); continue; }

    const grid = createGrid(level.widthTiles, level.heightTiles);
    const seenIds = new Set();

    for (const room of level.rooms || []) {
      if (!room || typeof room !== 'object') { errors.push(`Level ${level.level}: invalid room object`); continue; }
      if (!room.id) { errors.push(`Level ${level.level}: room missing id`); continue; }
      if (seenIds.has(room.id)) { errors.push(`Level ${level.level}: duplicate room id ${room.id}`); continue; }
      seenIds.add(room.id);
      if (!room.type) { errors.push(`Level ${level.level}: room ${room.id} missing type`); continue; }
      if (!Number.isFinite(room.x) || !Number.isFinite(room.y) || !Number.isFinite(room.w) || !Number.isFinite(room.h)) {
        errors.push(`Level ${level.level}: room ${room.id} has non-numeric tile rect`); continue;
      }
      if (room.x < 0 || room.y < 0 || room.w <= 0 || room.h <= 0) { errors.push(`Level ${level.level}: invalid tile rect for ${room.id}`); continue; }
      if (room.x + room.w > level.widthTiles || room.y + room.h > level.heightTiles) {
        errors.push(`Level ${level.level}: room ${room.id} out of bounds`); continue;
      }
      try {
        if (Array.isArray(room.parts) && room.parts.length > 0) {
          for (const part of room.parts) {
            if (part.x < 0 || part.y < 0 || part.w <= 0 || part.h <= 0) {
              throw new Error(`room ${room.id} has invalid part rect`);
            }
            if (part.x + part.w > level.widthTiles || part.y + part.h > level.heightTiles) {
              throw new Error(`room ${room.id} part out of bounds`);
            }
          }
          paintPolyomino(grid, room.parts, room.id);
        } else {
          paintRect(grid, room, room.id);
        }
      } catch (err) { errors.push(`Level ${level.level}: ${err.message}`); }
    }

    for (let y = 0; y < level.heightTiles; y++) {
      for (let x = 0; x < level.widthTiles; x++) {
        if (grid[y][x] === null) {
          errors.push(`Level ${level.level}: unfilled tile at ${x},${y}`);
          return errors; // stop early on first gap
        }
      }
    }
  }

  if ((tilePlan.levels || []).length > 1) {
    const stairRects = [];
    for (const level of tilePlan.levels) {
      const stairs = (level.rooms || []).find((r) => r.type === 'stairs');
      if (stairs) stairRects.push({ level: level.level, x: stairs.x, y: stairs.y, w: stairs.w, h: stairs.h });
    }
    if (stairRects.length > 1) {
      const first = stairRects[0];
      for (const s of stairRects.slice(1)) {
        // Only check x and w — y may differ because Level 1 can be offset by garage protrusion.
        // h may differ if the rear zone on Level 1 is shorter than the full Level 2 height.
        if (s.x !== first.x || s.w !== first.w) {
          errors.push(`Stairs misaligned between levels ${first.level} and ${s.level}`);
          break;
        }
      }
    }
  }

  return errors;
}

module.exports = { validateTilePlan };
