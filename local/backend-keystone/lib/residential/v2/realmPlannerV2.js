'use strict';

const { getAdapter } = require('./familyAdapterRegistry');
const { buildRealmGraphV2 } = require('./graph/graphBuilderV2');
const { buildAssemblyOrderV2 } = require('./assemblyOrderV2');
const { applyWingAwarePlacement, applyFootprintShapeToLayout } = require('./orthogonalAssembler');
const { placeRoom } = require('./fitRoomsToRealms');
const { normalizeRoomType } = require('../../tile/canonicalRoomTypes');
const { shareWall, roomArea } = require('../../planGeometry');
const { placeRemainingBathrooms } = require('./placeRemainingBathrooms');

function placeLaundryOnRequestedLevel(layout, brief, program) {
  if (Number(brief?.stories) !== 2 || Number(brief?.laundryLevel) !== 2) return layout;
  const lower = layout.levels.find(l => Number(l.level) === 1);
  const upper = layout.levels.find(l => Number(l.level) === 2);
  const spec = program.levels.find(l => Number(l.level) === 2)?.rooms.find(r => normalizeRoomType(r.type) === 'laundry');
  if (!lower || !upper || !spec) throw new Error('Requested upstairs laundry has no upper-floor program');
  if (upper.rooms.some(r => normalizeRoomType(r.type) === 'laundry')) return layout;
  const sourceIndex = lower.rooms.findIndex(r => normalizeRoomType(r.type) === 'laundry');
  const landing = upper.rooms.find(r => String(r.id) === String(upper.stairCore?.landingRoomId));
  const hosts = upper.rooms.filter(r => ['storage','loft'].includes(normalizeRoomType(r.type)) &&
    !r.requestedFeature && !r.protected && r !== landing && !r.parts?.length &&
    Math.min(r.w,r.h) >= 4 && roomArea(r) >= 40 && landing && shareWall(r,landing,5))
    .sort((a,b) => Math.abs(roomArea(a)-Number(spec.targetAreaSqFt||48))-Math.abs(roomArea(b)-Number(spec.targetAreaSqFt||48)));
  if (sourceIndex < 0 || !hosts.length) throw new Error('Requested upstairs laundry needs a usable room with independent landing access');
  const host = hosts[0], source = lower.rooms[sourceIndex];
  upper.rooms[upper.rooms.indexOf(host)] = placeRoom(spec, host);
  // The vacated service room becomes real storage, preserving the envelope.
  lower.rooms[sourceIndex] = placeRoom({id:host.id,type:'storage',level:1,zone:'service',label:'Storage'}, source);
  const supportNode = program.graph?.nodes?.find(n=>String(n.roomId)===String(host.id));
  if (supportNode) supportNode.level=1;
  return layout;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function applyKitchenLocation(layout, brief) {
  if (!brief.raw?.kitchenPlacement) return layout;
  const level = layout.levels.find(l => Number(l.level) === 1);
  const kitchen = level?.rooms.find(r => r.type === 'kitchen');
  const entry = level?.rooms.find(r => r.type === 'entry');
  if (!kitchen || !entry) return layout;
  const touches = (r, side) => side === 'bottom' ? r.y + r.h === level.height
    : side === 'top' ? r.y === 0 : side === 'left' ? r.x === 0 : r.x + r.w === level.width;
  const front = ['bottom','top','left','right'].find(side => touches(entry, side)) || 'bottom';
  const opposite = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };
  const wanted = brief.kitchenRear ? opposite[front] : front;
  if (touches(kitchen, wanted)) return layout;
  const host = level.rooms.find(r => r.type === 'living_room' && touches(r, wanted));
  if (!host) return layout;
  const geometry = r => ({ x:r.x, y:r.y, w:r.w, h:r.h, ...(r.parts?.length ? { parts:r.parts } : {}) });
  const kitchenGeometry = geometry(kitchen), hostGeometry = geometry(host);
  delete kitchen.parts; delete host.parts;
  Object.assign(kitchen, hostGeometry); Object.assign(host, kitchenGeometry);
  return layout;
}

function planRealmsV2({ brief, interpretation, footprint, program }) {
  const pattern = String(interpretation?.housePattern || '');

  const adapter = getAdapter(pattern);
  if (!adapter) {
    throw new Error(`No architect_v2 adapter for pattern ${pattern || 'unknown'}`);
  }

  const graph = program?.graph || buildRealmGraphV2(brief, interpretation, program?.levels || []);
  const assemblyOrder = buildAssemblyOrderV2(graph);

  const rawResult = adapter.assembleLayout({
    brief,
    interpretation,
    footprint,
    program,
    graph,
    assemblyOrder,
  });

  // Wing-aware pre-placement pass: for L/T envelopes, nudge non-structural rooms
  // out of void zones before carving so geometry is better by construction.
  const wingAwareResult = applyWingAwarePlacement(rawResult, footprint);

  // Apply non-rectangular envelope carving (L/T shapes) to all levels.
  // This is done here so every adapter (one-story and two-story) benefits.
  const result = applyFootprintShapeToLayout(wingAwareResult, footprint);

  const withLaundry = placeLaundryOnRequestedLevel(result, brief, program);
  return applyKitchenLocation(placeRemainingBathrooms(withLaundry, program), brief);
}

module.exports = {
  planRealmsV2,
  placeLaundryOnRequestedLevel,
};
