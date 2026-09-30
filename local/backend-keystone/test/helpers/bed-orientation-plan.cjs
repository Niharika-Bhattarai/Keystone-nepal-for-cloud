'use strict';
// Four asymmetric beds, one for every explicit plan rotation. The footprints
// already incorporate the quarter turn, matching generated plan furniture.
module.exports = function bedOrientationPlan() {
  const rooms = [], furniture = [];
  for (const [i, rotation] of [0, 90, 180, 270].entries()) {
    const x = (i % 2) * 14, y = Math.floor(i / 2) * 14, sideways = rotation % 180 !== 0;
    rooms.push({ id: `room-${rotation}`, type: 'bedroom', label: `Bed ${rotation}`, x, y, w: 14, h: 14 });
    furniture.push({ id: `bed-${rotation}`, roomId: `room-${rotation}`, kind: 'bed_queen', x: x + 3, y: y + 3,
      w: sideways ? 7 : 5, h: sideways ? 5 : 7, rotation });
  }
  return { levels: [{ level: 1, width: 28, height: 28, rooms, furniture }] };
};
