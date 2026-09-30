'use strict';
// Bedroom layout (lib/bedPlacement.js through planFurniture): the headboard is on a
// real wall, never beside a doorway or in its landing, paths stay open, and every
// bedroom of a generated house passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFurnitureLayout, furnitureForRoom } = require('../lib/planFurniture');
const { bedroomLayoutIssues, headLine, connected, landingIn } = require('../lib/bedPlacement');
const { fitsRoom, clearPartsFor } = require('../lib/furnitureGeometry');

const issuesOf = (level) => bedroomLayoutIssues(level, (room) => (q) => fitsRoom(q, room, clearPartsFor(level, room)));
const bedOf = (items) => items.find((i) => /^bed_/.test(i.kind));
// How far the headboard edge is from the room's own wall on that side.
const headGap = (bed, room) => ({ n: bed.y - room.y, s: room.y + room.h - (bed.y + bed.h),
  w: bed.x - room.x, e: room.x + room.w - (bed.x + bed.w) })[headLine(bed).head];

function level(rooms, doors, windows = []) {
  return { level: 1, rooms, doors, windows };
}

test('a narrow bedroom gets its headboard on a wall, not facing the room (the old flip)', () => {
  // 10 x 14 ft, entered from the west wall near the top: the old rule rotated the bed to
  // "east" and pushed it against the west wall, so the pillows faced the room.
  const room = { id: 'b', type: 'bedroom', x: 0, y: 0, w: 10, h: 14 };
  const lv = level([room, { id: 'h', type: 'hallway', x: -4, y: 0, w: 4, h: 14 }], [{ id: 'd', x: 0, y: 2, dir: 'vertical', width: 3, a: 'h', b: 'b' }]);
  const bed = bedOf(furnitureForRoom(room, lv));
  assert.ok(bed, 'a bed is placed');
  assert.ok(headGap(bed, room) < 0.5, `headboard flush with its wall (gap ${headGap(bed, room)})`);
  assert.deepEqual(issuesOf({ ...lv, furniture: furnitureForRoom(room, lv) }), []);
});

test('the headboard never sits beside the entry or inside a doorway landing', () => {
  // Door on the north wall near the west corner, a bath door on the east wall.
  const room = { id: 'b', type: 'bedroom', x: 0, y: 0, w: 13, h: 12 };
  const lv = level([room, { id: 'h', type: 'hallway', x: 0, y: -4, w: 13, h: 4 }, { id: 't', type: 'bathroom', x: 13, y: 0, w: 6, h: 8 }], [
    { id: 'entry', x: 2.5, y: 0, dir: 'horizontal', width: 3, a: 'h', b: 'b' },
    { id: 'bath', x: 13, y: 5, dir: 'vertical', width: 2.5, a: 'b', b: 't' },
  ], [{ roomId: 'b', x: 6.5, y: 12, dir: 'horizontal', width: 4 }]);
  const items = furnitureForRoom(room, lv);
  const bed = bedOf(items);
  const { head, at, span } = headLine(bed);
  for (const d of lv.doors) {
    const land = landingIn(d, [room]);
    assert.ok(!(bed.x < land.x + land.w && land.x < bed.x + bed.w && bed.y < land.y + land.h && land.y < bed.y + bed.h), `bed clear of the ${d.id} landing`);
  }
  assert.ok(!(head === 'n' && at < 1 && span[0] < 6), 'headboard is not next to the entry on the north wall');
  // Entry, bath and one side of the bed stay connected by a 2.5 ft path.
  const fits = (q) => fitsRoom(q, room, null);
  assert.ok(connected({ box: room, fits }, items.filter((i) => i.kind !== 'nightstand'), lv.doors.map((d) => landingIn(d, [room]))));
  assert.deepEqual(issuesOf({ ...lv, furniture: items }), []);
});

test('in an L-shaped bedroom the headboard is never against the open side between its parts', () => {
  // A 15 x 12 main part with an 11 x 4 alcove above it (the shape a generated plan had).
  const room = { id: 'b', type: 'bedroom', x: 27, y: 14, w: 15, h: 16,
    parts: [{ x: 31, y: 14, w: 11, h: 4 }, { x: 27, y: 18, w: 15, h: 12 }] };
  const lv = level([room], [{ id: 'd', x: 31, y: 16, dir: 'vertical', width: 3, a: 'hall', b: 'b' }], [{ roomId: 'b', x: 34.5, y: 30, dir: 'horizontal', width: 4 }]);
  const items = furnitureForRoom(room, lv);
  const bed = bedOf(items);
  const { head, at, span } = headLine(bed);
  const againstOpenSide = head === 'n' && Math.abs(at - 18) < 0.6 && span[1] > 31.5;
  assert.ok(!againstOpenSide, `headboard is on a wall, not the alcove opening (${JSON.stringify(bed)})`);
  assert.deepEqual(issuesOf({ ...lv, furniture: items }), []);
});

test('nightstands flank the headboard and a dresser keeps 3 ft in front of it', () => {
  const room = { id: 'b', type: 'primary_bedroom', x: 0, y: 0, w: 16, h: 15 };
  const lv = level([room, { id: 'h', type: 'hallway', x: 0, y: 15, w: 16, h: 4 }], [{ id: 'd', x: 13, y: 15, dir: 'horizontal', width: 3, a: 'h', b: 'b' }]);
  const items = furnitureForRoom(room, lv);
  const bed = bedOf(items);
  const stands = items.filter((i) => i.kind === 'nightstand');
  assert.equal(stands.length, 2);
  const { head } = headLine(bed);
  for (const s of stands) assert.ok(head === 'n' || head === 's' ? Math.abs((head === 'n' ? s.y - bed.y : s.y + s.h - bed.y - bed.h)) < 0.01 : Math.abs(head === 'w' ? s.x - bed.x : s.x + s.w - bed.x - bed.w) < 0.01, 'at the head end');
  const dresser = items.find((i) => i.kind === 'dresser');
  assert.ok(dresser, 'a dresser fits in a 16 x 15 room');
  assert.ok(!(dresser.x < bed.x + bed.w && bed.x < dresser.x + dresser.w && dresser.y < bed.y + bed.h && bed.y < dresser.y + dresser.h));
});

test('the checker flags a bed pushed off its wall and one beside a doorway', () => {
  const room = { id: 'b', type: 'bedroom', x: 0, y: 0, w: 12, h: 12 };
  const doors = [{ id: 'd', x: 2, y: 0, dir: 'horizontal', width: 3, a: 'h', b: 'b' }];
  const off = issuesOf({ rooms: [room], doors, furniture: [{ roomId: 'b', kind: 'bed_full', x: 4, y: 5, w: 4.5, h: 6.25, rotation: 0 }] });
  assert.ok(off.some((i) => i.rule === 'headboard not against a wall'));
  const beside = issuesOf({ rooms: [room], doors, furniture: [{ roomId: 'b', kind: 'bed_full', x: 4, y: 0.27, w: 4.5, h: 6.25, rotation: 0 }] });
  assert.ok(beside.some((i) => i.rule === 'doorway beside the headboard'));
});

test('every bedroom of generated houses passes (production handler)', async () => {
  const handler = require('../api/plan');
  const invoke = (surveyData) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve(b); return this; }, send(b) { resolve(b); return this; } };
    Promise.resolve(handler({ method: 'POST', body: { surveyData, chatHistory: [] }, headers: {} }, res)).catch(reject);
  });
  const base = { location: '', privateBaths: '1', bedroomConfigs: null, materials: 'Craftsman (Wood & Stone)', openConcept: 'Open Concept (Combined)', frontFacing: 'South', shape: 'Rectangular' };
  for (const survey of [
    { totalArea: '2400', stories: '2 Stories', bedrooms: '3 Bed', bathrooms: '2 Bath', garage: '1 Car Garage', masterLocation: 'Level 2 (Upper)', specialRooms: ['Study'] },
    { totalArea: '2800', stories: '2 Stories', bedrooms: '4 Bed', bathrooms: '3 Bath', garage: '2 Car Garage', masterLocation: 'Level 2 (Upper)' },
    { totalArea: '2200', stories: '1 Story', bedrooms: '4 Bed', bathrooms: '3 Bath', garage: '2 Car Garage', shape: 'Rectangular (Wide)' },
  ]) {
    const body = await invoke({ ...base, ...survey });
    assert.equal(body.success, true, JSON.stringify(survey));
    for (const plan of [body.planSpec, ...(body.alternatives || []).map((a) => a.planSpec || a)].filter(Boolean)) {
      let beds = 0;
      for (const lv of plan.levels || []) {
        beds += (lv.furniture || []).filter((i) => /^bed_/.test(i.kind)).length;
        assert.deepEqual(issuesOf(lv), [], `${survey.totalArea} ${survey.stories} level ${lv.level}`);
      }
      assert.ok(beds >= Number.parseInt(survey.bedrooms, 10), 'every bedroom has its bed');
    }
  }
});

test('applyFurnitureLayout keeps working on a level without doors (legacy fallback path)', () => {
  const plan = { levels: [{ level: 1, rooms: [{ id: 'b', type: 'bedroom', x: 0, y: 0, w: 12, h: 12 }] }] };
  applyFurnitureLayout(plan);
  const bed = bedOf(plan.levels[0].furniture);
  assert.ok(bed);
  assert.ok(headGap(bed, plan.levels[0].rooms[0]) < 0.5);
});
