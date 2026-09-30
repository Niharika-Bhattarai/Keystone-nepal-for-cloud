'use strict';

// Move shared wall segments together. Independent room scaling creates overlaps
// and gaps; a boundary edit must transfer precisely the same area to its peers.
function resizeCandidates(plan, targetId, width, height) {
  const level = (plan.levels || []).find(l => l.rooms.some(r => r.id === targetId));
  if (!level) return [];
  const protectedIds = new Set(plan.buildingModel?.protectedRoomIds || []);
  const editable = room => !room.protected && !protectedIds.has(room.id) && !room.parts?.length;
  const target = level.rooms.find(r => r.id === targetId);
  if (!editable(target)) return [];
  const results = [];
  for (const horizontal of ['right', 'left']) for (const vertical of ['bottom', 'top']) {
    const rooms = level.rooms.map(r => ({ ...r }));
    const changed = rooms.find(r => r.id === targetId);
    let valid = true;
    for (const [axis, side, wanted] of [['x', horizontal, width], ['y', vertical, height]]) {
      const size = axis === 'x' ? 'w' : 'h';
      const cross = axis === 'x' ? 'y' : 'x';
      const crossSize = axis === 'x' ? 'h' : 'w';
      const trailing = side === 'right' || side === 'bottom';
      const delta = wanted - changed[size];
      if (!delta) continue;
      const boundary = changed[axis] + (trailing ? changed[size] : 0);
      const lo = changed[cross], hi = lo + changed[crossSize];
      const peers = rooms.filter(r => r.id !== targetId &&
        Math.abs(r[axis] + (trailing ? 0 : r[size]) - boundary) < 1e-6 &&
        Math.min(hi, r[cross] + r[crossSize]) > Math.max(lo, r[cross]));
      // A partial neighboring rectangle would need splitting; do not stretch
      // its unrelated wall or touch a protected stair/circulation core.
      if (!peers.length || peers.some(r => !editable(r) || r[cross] < lo || r[cross] + r[crossSize] > hi || r[size] - delta < 4)) {
        valid = false; break;
      }
      const intervals = peers.map(r => [r[cross], r[cross] + r[crossSize]]).sort((a,b) => a[0]-b[0]);
      let end = lo;
      for (const [start, stop] of intervals) {
        if (Math.abs(start - end) > 1e-6) { valid = false; break; }
        end = stop;
      }
      if (!valid || Math.abs(end - hi) > 1e-6) { valid = false; break; }
      for (const peer of peers) {
        if (trailing) peer[axis] += delta;
        peer[size] -= delta;
      }
      if (!trailing) changed[axis] -= delta;
      changed[size] = wanted;
    }
    if (!valid) continue;
    const changes = rooms.flatMap((room, i) => {
      const before = level.rooms[i];
      if (['x','y','w','h'].every(k => room[k] === before[k])) return [];
      return [{ action: 'resize_and_move', id: room.id, x: room.x, y: room.y, w: room.w, h: room.h }];
    });
    if (changes.length && !results.some(c => JSON.stringify(c) === JSON.stringify(changes))) results.push(changes);
  }
  return results;
}

module.exports = { resizeCandidates };
