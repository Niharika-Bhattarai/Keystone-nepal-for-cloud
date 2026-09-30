'use strict';

// Reproducible assumptions for tests/audits ONLY. Production must supply real
// furniture and window measurements, not import this benchmark policy.
function bedroomArchitecturePolicy(input) {
  const level = input.plan.levels.find(l => l.level === input.options.levelNumber);
  const bed = level.furniture.find(f => f.id === input.options.request.bedId);
  const room = level.rooms.find(r => r.id === bed.roomId);
  return {
    basis: 'Diagnostic assumptions: bed body 2 ft, headboard 4 ft tall by 0.25 ft deep, nightstands 2 ft, dresser 3.5 ft; window heights from generated concept metadata; 0.75 ft operating reservation. Not project measurements or code requirements.',
    headboardMaxGapFt: 0.25,
    furniture: level.furniture.filter(f => f.roomId === room.id).map(f => ({ furnitureId: f.id, kind: f.kind,
      widthFt: Math.min(f.w, f.h), lengthFt: Math.max(f.w, f.h),
      heightFt: f.id === bed.id || f.kind === 'nightstand' ? 2 : f.kind === 'dresser' ? 3.5 : NaN,
      ...(f.id === bed.id ? { headboardHeightFt: 4, headboardDepthFt: 0.25 } : {}) })),
    windows: level.windows.filter(w => w.roomId === room.id).map(w => ({
      binding: { roomId: w.roomId, x: w.x, y: w.y, dir: w.dir, width: w.width },
      sillHeightFt: room.heightMeta.windowSillHeightFt, headHeightFt: room.heightMeta.windowHeadHeightFt,
      clearanceDepthFt: 0.75 })),
  };
}

module.exports = { bedroomArchitecturePolicy };
