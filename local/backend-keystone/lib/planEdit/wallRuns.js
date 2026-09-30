'use strict';

/* The interior walls a person can drag in the Studio's edit mode.
 *
 * Walls are not stored: they are the edges rooms share. Dragging one moves a
 * whole straight *run*: every room edge on that line that must move with it
 * so that every room stays a rectangle (or keeps its rectangular parts) and
 * no gap or overlap appears. A run is found by joining the room edges that
 * touch across the line until nothing else touches them. It can be dragged
 * only when rooms cover it completely on both sides; otherwise moving it
 * would cut a notch into the outside wall. Runs touching a stair are locked:
 * the flight is fitted to the storey and stacked with the floor above.
 *
 * A run: { id, level, axis: 'x' (a vertical line x = at) | 'y' (a horizontal
 *   line y = at), at, from, to, movable, reason, minDelta, maxDelta,
 *   moves: [{ roomId, part, edge }] }
 * `part` is the index into room.parts, or null for a plain rectangle; `edge`
 * is the side of that rectangle lying on the run. Dragging by `delta` moves
 * every listed edge by `delta` along the axis.
 */

const EPS = 1e-6;
// Below this a room is not a room; the only size limit that refuses an edit.
const MIN_ROOM_FT = 3;
const { isOutdoorType } = require('../tile/canonicalRoomTypes');

const round = (n) => Math.round(n * 1000) / 1000;
const fmt = (n) => String(round(n));

function cellsOf(level) {
  const cells = [];
  for (const room of level.rooms || []) {
    if (isOutdoorType(room.type)) continue;
    const parts = Array.isArray(room.parts) && room.parts.length ? room.parts : null;
    (parts || [room]).forEach((r, i) => cells.push({ room, part: parts ? i : null,
      x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }));
  }
  return cells;
}

// The edges of every rectangle, grouped by the line they lie on.
function edgesByLine(cells, axis) {
  const lines = new Map();
  const add = (at, entry) => {
    const key = fmt(at);
    if (!lines.has(key)) lines.set(key, { at: round(at), entries: [] });
    lines.get(key).entries.push(entry);
  };
  for (const cell of cells) {
    if (axis === 'x') {
      add(cell.x, { cell, side: 'after', edge: 'left', lo: cell.y, hi: cell.y + cell.h });
      add(cell.x + cell.w, { cell, side: 'before', edge: 'right', lo: cell.y, hi: cell.y + cell.h });
    } else {
      add(cell.y, { cell, side: 'after', edge: 'top', lo: cell.x, hi: cell.x + cell.w });
      add(cell.y + cell.h, { cell, side: 'before', edge: 'bottom', lo: cell.x, hi: cell.x + cell.w });
    }
  }
  return lines;
}

// Whether a set of intervals covers [lo, hi] without a gap.
function covers(intervals, lo, hi) {
  let end = lo;
  for (const [a, b] of [...intervals].sort((p, q) => p[0] - q[0])) {
    if (a > end + EPS) return false;
    end = Math.max(end, b);
  }
  return end >= hi - EPS;
}

function runsOnLine(levelNum, axis, line) {
  const { entries } = line;
  const parent = entries.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const walls = new Set();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      if (a.side === b.side) continue;
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) <= EPS) continue;
      parent[find(i)] = find(j);
      // Two parts of the same room meeting is not a wall, but it still moves.
      if (a.cell.room !== b.cell.room) walls.add(`${i}:${j}`);
    }
  }
  const groups = new Map();
  entries.forEach((entry, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });
  const hasWall = (members) => [...walls].some((key) => {
    const [i, j] = key.split(':').map(Number);
    return members.includes(i) && members.includes(j);
  });
  const runs = [];
  for (const members of groups.values()) {
    if (members.length < 2 || !hasWall(members)) continue;
    const list = members.map((i) => entries[i]);
    const from = round(Math.min(...list.map((e) => e.lo)));
    const to = round(Math.max(...list.map((e) => e.hi)));
    const before = list.filter((e) => e.side === 'before');
    const after = list.filter((e) => e.side === 'after');
    let reason = null;
    if (list.some((e) => String(e.cell.room.type) === 'stairs')) reason = 'stairs';
    else if (!covers(before.map((e) => [e.lo, e.hi]), from, to) || !covers(after.map((e) => [e.lo, e.hi]), from, to)) reason = 'exterior';
    // A room before the line grows with a positive delta; one after it shrinks.
    const span = (e) => (axis === 'x' ? e.cell.w : e.cell.h);
    const minDelta = round(Math.max(...before.map((e) => MIN_ROOM_FT - span(e))));
    const maxDelta = round(Math.min(...after.map((e) => span(e) - MIN_ROOM_FT)));
    runs.push({
      id: `${levelNum}:${axis}:${fmt(line.at)}:${fmt(from)}-${fmt(to)}`,
      level: levelNum, axis, at: line.at, from, to,
      movable: !reason && minDelta <= maxDelta,
      reason: reason || (minDelta > maxDelta ? 'too_small' : null),
      minDelta, maxDelta,
      moves: list.map((e) => ({ roomId: String(e.cell.room.id), part: e.cell.part, edge: e.edge })),
      rooms: [...new Set(list.map((e) => String(e.cell.room.id)))],
    });
  }
  return runs;
}

/** Every interior wall run on one level. */
function levelWallRuns(level) {
  const levelNum = Number(level.level) || 1;
  const cells = cellsOf(level);
  const runs = [];
  for (const axis of ['x', 'y']) {
    for (const line of edgesByLine(cells, axis).values()) runs.push(...runsOnLine(levelNum, axis, line));
  }
  return runs.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every interior wall run of the plan, level by level. */
function planWallRuns(planSpec) {
  return (planSpec?.levels || []).flatMap((level) => levelWallRuns(level));
}

module.exports = { MIN_ROOM_FT, levelWallRuns, planWallRuns, cellsOf };
