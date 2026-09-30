'use strict';
// C5e decoration clearance fixture: one 34 x 26 ft storey reproducing the cases
// the corpus audit found in real generated houses. Coordinates are chosen so
// that, with the pre-C5e bake code:
//   - the plant beside the queen bed lands inside a nightstand (one each side);
//   - the plant beside the sofa (against the south wall, facing north) stands
//     in the doorway just past its end;
//   - a shrub reaches onto the entry stoop (main door at x 12) and a mulch bed
//     onto the driveway (garage door at x 27.5), where the old door gaps were
//     narrower than the paving.
// It is a diagnostic fixture, not a house proposal.
module.exports = function decorClearancePlan() {
  const rooms = [
    { id: 'bed', type: 'bedroom', label: 'Bedroom', x: 0, y: 0, w: 14, h: 12 },
    { id: 'living', type: 'living_room', label: 'Living Room', x: 14, y: 0, w: 20, h: 12 },
    { id: 'hall', type: 'hallway', label: 'Hall', x: 0, y: 12, w: 20, h: 14 },
    { id: 'garage', type: 'garage', label: 'Garage', x: 20, y: 12, w: 14, h: 14, heightMeta: { clearHeightFt: 9, doorHeadHeightFt: 8 } },
  ];
  const furniture = [
    { id: 'bed-1', roomId: 'bed', kind: 'bed_queen', x: 4.5, y: 0.5, w: 5, h: 7, rotation: 0 },
    { id: 'ns-l', roomId: 'bed', kind: 'nightstand', x: 2.5, y: 0.5, w: 2, h: 1.5, rotation: 0 },
    { id: 'ns-r', roomId: 'bed', kind: 'nightstand', x: 9.5, y: 0.5, w: 2, h: 1.5, rotation: 0 },
    { id: 'sofa-1', roomId: 'living', kind: 'sofa', x: 19.5, y: 8.5, w: 7, h: 3, rotation: 180 },
  ];
  const doors = [
    { id: 'd-bed', a: 'bed', b: 'hall', dir: 'horizontal', x: 3, y: 12, width: 3 },
    { id: 'd-liv', a: 'living', b: 'hall', dir: 'horizontal', x: 18, y: 12, width: 3 },
    { id: 'd-main', a: 'hall', b: '__exterior__', dir: 'horizontal', x: 12, y: 26, width: 3, isMainEntry: true },
    { id: 'd-garage', a: 'garage', b: '__exterior__', dir: 'horizontal', x: 27.5, y: 26, width: 9, garageDoor: true },
  ];
  return {
    levels: [{ level: 1, width: 34, height: 26, rooms, furniture, doors, windows: [] }],
    verticalModel: { levels: [{ level: 1, floorZFt: 0, clearHeightFt: 9, floorToFloorFt: 10, structureThicknessFt: 1 }] },
  };
};
