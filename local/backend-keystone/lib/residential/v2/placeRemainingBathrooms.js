'use strict';

const { placeRoom } = require('./fitRoomsToRealms');
const { normalizeRoomType } = require('../../tile/canonicalRoomTypes');
const { shareWall } = require('../../planGeometry');

// The layout families were drawn for fixed bathroom counts. A brief with a
// fourth or fifth bathroom (or a second shared bathroom where the family has
// one slot) leaves program bathrooms unplaced, and the plan then fails the
// bathroom count. Put each leftover bathroom where a builder would: in a spare
// storage or loft room on its level that it can open from a hall (a shared
// bathroom) or from its own bedroom (a private one). A large host keeps its
// remainder as storage. Nothing else moves, and the independent bathroom-fit,
// access and count validators still decide whether the plan is acceptable.

const HOST_TYPES = new Set(['storage', 'loft']);
const CIRCULATION = new Set(['hallway', 'entry', 'mudroom']);
const DOOR = 3;

const fits = (w, h, primary) => {
  const short = Math.min(w, h), long = Math.max(w, h);
  return primary ? short >= 8 && w * h >= 70 && long / short <= 2.8
    : short >= 6 && w * h >= 48 && long / short <= 2.8;
};

// Cuts of a host rectangle: the bathroom takes one end, `depth` feet deep,
// measured from each of the four sides; the rest stays with the host.
function cuts(host, depth) {
  const { x, y, w, h } = host;
  const out = [];
  if (depth < w) {
    out.push({ bath: { x, y, w: depth, h }, rest: { x: x + depth, y, w: w - depth, h } });
    out.push({ bath: { x: x + w - depth, y, w: depth, h }, rest: { x, y, w: w - depth, h } });
  }
  if (depth < h) {
    out.push({ bath: { x, y, w, h: depth }, rest: { x, y: y + depth, w, h: h - depth } });
    out.push({ bath: { x, y: y + h - depth, w, h: depth }, rest: { x, y, w, h: h - depth } });
  }
  return out;
}

function placeRemainingBathrooms(layout, program) {
  for (const levelProgram of program?.levels || []) {
    const level = layout?.levels?.find((l) => Number(l.level) === Number(levelProgram.level));
    if (!level) continue;
    const placed = new Set(level.rooms.map((r) => String(r.id)));
    const leftovers = (levelProgram.rooms || [])
      .filter((r) => ['bathroom', 'primary_bathroom'].includes(normalizeRoomType(r.type)) && !placed.has(String(r.id)));
    for (const bath of leftovers) {
      const primary = normalizeRoomType(bath.type) === 'primary_bathroom';
      const owner = bath.attachedTo ? level.rooms.find((r) => String(r.id) === String(bath.attachedTo)) : null;
      if (bath.attachedTo && !owner) throw new Error(`Bathroom ${bath.id} belongs to a bedroom on another level`);
      // A private bathroom opens only to its bedroom; a shared one to circulation.
      const access = owner ? [owner] : level.rooms.filter((r) => CIRCULATION.has(normalizeRoomType(r.type)));
      const opens = (rect) => access.some((a) => shareWall(rect, a, DOOR));
      let best = null;
      for (const host of level.rooms) {
        if (!HOST_TYPES.has(normalizeRoomType(host.type)) || host.requestedFeature || host.protected || host.parts?.length) continue;
        const options = [];
        if (fits(host.w, host.h, primary) && host.w * host.h <= (primary ? 130 : 110) && opens(host)) options.push({ bath: host, rest: null });
        for (const depth of [6, 7, 8, 9, 10]) {
          for (const cut of cuts(host, depth)) {
            if (!fits(cut.bath.w, cut.bath.h, primary) || !opens(cut.bath)) continue;
            if (Math.min(cut.rest.w, cut.rest.h) < 3) continue;
            options.push(cut);
          }
        }
        for (const option of options) {
          // Prefer a snug bathroom, then a remainder that keeps its own door.
          const area = option.bath.w * option.bath.h;
          const restOpen = option.rest && level.rooms.some((r) => r !== host && CIRCULATION.has(normalizeRoomType(r.type)) && shareWall(option.rest, r, DOOR));
          const score = Math.abs(area - (primary ? 90 : 60)) + (option.rest && !restOpen ? 25 : 0);
          if (!best || score < best.score) best = { host, option, score };
        }
      }
      if (!best) throw new Error(`No spare room on level ${level.level} can hold bathroom ${bath.id} with its own door`);
      const { host, option } = best;
      const index = level.rooms.indexOf(host);
      const placedBath = placeRoom(bath, option.bath);
      if (option.rest) {
        level.rooms.splice(index, 1, placedBath, { ...host, ...option.rest });
      } else {
        level.rooms.splice(index, 1, placedBath);
      }
    }
  }
  return layout;
}

module.exports = { placeRemainingBathrooms };
