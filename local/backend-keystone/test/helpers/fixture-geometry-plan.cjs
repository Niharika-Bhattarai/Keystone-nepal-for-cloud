'use strict';
const { closetLayout } = require('../../lib/closetGeometry');
module.exports = function fixtureGeometryPlan() {
  return { levels: ['reach_in', 'walk_in'].map((closetType, index) => {
    const rooms = [], furniture = [];
    for (const [i, front] of ['top', 'bottom', 'left', 'right'].entries()) {
      const h = front === 'top' || front === 'bottom', depth = index ? 6 : 2.5;
      const room = { id: `closet-${index}-${front}`, type: 'closet', closetType, closetFront: front, ownerBedroomId: 'diagnostic',
        x: i * 9 + 1, y: 1, w: h ? 7 : depth, h: h ? depth : 7 };
      rooms.push(room); furniture.push({ ...closetLayout(room).storage, id: `storage-${index}-${front}`, roomId: room.id, kind: 'closet_storage' });
    }
    for (const rotation of [0, 90]) {
      const room = { id: `bath-${index}-${rotation}`, type: 'bathroom', x: rotation ? 18 : 0, y: 10, w: 10, h: 10 };
      rooms.push(room); furniture.push({ id: `toilet-${index}-${rotation}`, roomId: room.id, kind: 'toilet', rotation,
        x: room.x + 7, y: 17, w: rotation ? 2.5 : 2, h: rotation ? 2 : 2.5 });
    }
    return { level: index + 1, width: 36, height: 22, rooms, furniture };
  }) };
};
