'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const refineHandler = require('../api/refine');
const {
  applyDiff,
  sanitizeChangesDetailed,
  parseExactInstruction,
  parseGeminiDiff,
  computeExactResizeChanges,
  estimatePlanQuality,
  collectProtectedIssues,
  collectRefinementScopeIssues,
  sanitizeChanges,
} = refineHandler.__test;

// ── Fixtures ────────────────────────────────────────────────────────────────────

function makePlanSpec(overrides = {}) {
  return {
    stories: 1,
    totalAreaSqFt: 1800,
    levels: [
      {
        level: 1,
        width: 60,
        height: 40,
        rooms: [
          { id: 'living1', type: 'living_room', label: 'Living Room', x: 0, y: 0, w: 20, h: 20 },
          { id: 'kitchen1', type: 'kitchen', label: 'Kitchen', x: 20, y: 0, w: 16, h: 16 },
          { id: 'dining1', type: 'dining_room', label: 'Dining Room', x: 36, y: 0, w: 14, h: 16 },
          { id: 'bed1', type: 'primary_bedroom', label: 'Primary Bedroom', x: 0, y: 20, w: 16, h: 20 },
          { id: 'bed2', type: 'bedroom', label: 'Bedroom 2', x: 16, y: 20, w: 14, h: 20 },
          { id: 'bath1', type: 'primary_bathroom', label: 'Primary Bathroom', x: 30, y: 16, w: 10, h: 12 },
          { id: 'bath2', type: 'bathroom', label: 'Bathroom 2', x: 40, y: 16, w: 10, h: 12 },
          { id: 'hall1', type: 'hallway', label: 'Hallway', x: 50, y: 16, w: 10, h: 24 },
          { id: 'laundry1', type: 'laundry', label: 'Laundry', x: 30, y: 28, w: 10, h: 12 },
          { id: 'entry1', type: 'entry', label: 'Entry', x: 40, y: 28, w: 10, h: 12 },
        ],
        doors: [],
        windows: [],
      },
    ],
    buildingModel: { protectedRoomIds: ['hall1'] },
    stairCore: [],
    ...overrides,
  };
}

function makeTwoStoryPlan() {
  return {
    stories: 2,
    totalAreaSqFt: 2400,
    levels: [
      {
        level: 1,
        width: 40,
        height: 30,
        rooms: [
          { id: 'living1', type: 'living_room', label: 'Living Room', x: 0, y: 0, w: 20, h: 16 },
          { id: 'kitchen1', type: 'kitchen', label: 'Kitchen', x: 20, y: 0, w: 14, h: 16 },
          { id: 'stairs1', type: 'stairs', label: 'Stairs', x: 34, y: 0, w: 6, h: 16 },
          { id: 'garage1', type: 'garage', label: 'Garage', x: 0, y: 16, w: 20, h: 14, protected: true },
          { id: 'entry1', type: 'entry', label: 'Entry', x: 20, y: 16, w: 10, h: 14 },
          { id: 'laundry1', type: 'laundry', label: 'Laundry', x: 30, y: 16, w: 10, h: 14 },
        ],
        doors: [
          { a: 'living1', b: 'kitchen1' },
          { a: 'kitchen1', b: 'entry1' },
        ],
      },
      {
        level: 2,
        width: 40,
        height: 30,
        rooms: [
          { id: 'bed1', type: 'primary_bedroom', label: 'Primary Bedroom', x: 0, y: 0, w: 20, h: 16 },
          { id: 'bed2', type: 'bedroom', label: 'Bedroom 2', x: 20, y: 0, w: 14, h: 16 },
          { id: 'stairs2', type: 'stairs', label: 'Stairs', x: 34, y: 0, w: 6, h: 16 },
          { id: 'bath1', type: 'primary_bathroom', label: 'Primary Bath', x: 0, y: 16, w: 14, h: 14 },
          { id: 'bath2', type: 'bathroom', label: 'Bathroom 2', x: 14, y: 16, w: 10, h: 14 },
          { id: 'hall2', type: 'hallway', label: 'Hallway', x: 24, y: 16, w: 16, h: 14 },
        ],
        doors: [],
      },
    ],
    buildingModel: { protectedRoomIds: ['stairs1', 'stairs2', 'hall2', 'garage1'] },
    stairCore: [
      { level: 1, roomId: 'stairs1', x: 34, w: 6 },
      { level: 2, roomId: 'stairs2', x: 34, w: 6 },
    ],
  };
}

// ── sanitizeChangesDetailed ─────────────────────────────────────────────────────

describe('sanitizeChangesDetailed', () => {
  it('accepts a valid resize within bounds', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [
      { action: 'resize', id: 'kitchen1', w: 18, h: 18 },
    ]);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].id, 'kitchen1');
    assert.equal(result.rejectedChanges.length, 0);
  });

  it('rejects changes to protected rooms', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [
      { action: 'resize', id: 'hall1', w: 14, h: 28 },
    ]);
    assert.equal(result.changes.length, 0);
    assert.equal(result.rejectedChanges.length, 1);
    assert.equal(result.rejectedChanges[0].reason, 'protected_or_uneditable_room');
  });

  it('rejects unknown room IDs', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [
      { action: 'resize', id: 'nonexistent', w: 10, h: 10 },
    ]);
    assert.equal(result.changes.length, 0);
    assert.equal(result.rejectedChanges[0].reason, 'unknown_room_id');
  });

  it('rejects out-of-bounds resize', () => {
    const plan = makePlanSpec();
    // living1 at x=0,y=0 — resize to w=80 overflows level width=60
    const result = sanitizeChangesDetailed(plan, [
      { action: 'resize', id: 'living1', w: 80, h: 20 },
    ]);
    assert.equal(result.changes.length, 0);
    assert.equal(result.rejectedChanges[0].reason, 'out_of_bounds_request');
  });

  it('enforces 4-room limit', () => {
    const plan = makePlanSpec();
    const changes = [
      { action: 'resize', id: 'living1', w: 22, h: 20 },
      { action: 'resize', id: 'kitchen1', w: 18, h: 16 },
      { action: 'resize', id: 'dining1', w: 16, h: 16 },
      { action: 'resize', id: 'bed1', w: 18, h: 20 },
      { action: 'resize', id: 'bed2', w: 16, h: 20 },
    ];
    const result = sanitizeChangesDetailed(plan, changes);
    assert.equal(result.changes.length, 4);
    assert.equal(result.rejectedChanges.length, 1);
    assert.equal(result.rejectedChanges[0].reason, 'room_limit_exceeded');
  });

  it('snaps values to 2-foot grid', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [
      { action: 'resize', id: 'kitchen1', w: 17, h: 15 },
    ]);
    assert.equal(result.changes.length, 1);
    // 17→18, 15→16 (snap to even)
    assert.equal(result.changes[0].w, 18);
    assert.equal(result.changes[0].h, 16);
  });

  it('rejects invalid change objects', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [null, 42, 'bad']);
    assert.equal(result.changes.length, 0);
    assert.equal(result.rejectedChanges.length, 3);
  });

  it('rejects invalid action strings', () => {
    const plan = makePlanSpec();
    const result = sanitizeChangesDetailed(plan, [
      { action: 'delete', id: 'kitchen1' },
    ]);
    assert.equal(result.changes.length, 0);
    assert.equal(result.rejectedChanges[0].reason, 'invalid_action');
  });
});

// ── applyDiff ───────────────────────────────────────────────────────────────────

describe('applyDiff', () => {
  it('applies resize correctly', () => {
    const plan = makePlanSpec();
    const updated = applyDiff(plan, [
      { action: 'resize', id: 'kitchen1', w: 18, h: 18 },
    ]);
    const kitchen = updated.levels[0].rooms.find((r) => r.id === 'kitchen1');
    assert.equal(kitchen.w, 18);
    assert.equal(kitchen.h, 18);
  });

  it('applies move correctly', () => {
    const plan = makePlanSpec();
    const updated = applyDiff(plan, [
      { action: 'move', id: 'kitchen1', x: 22, y: 2 },
    ]);
    const kitchen = updated.levels[0].rooms.find((r) => r.id === 'kitchen1');
    assert.equal(kitchen.x, 22);
    assert.equal(kitchen.y, 2);
  });

  it('applies resize_and_move correctly', () => {
    const plan = makePlanSpec();
    const updated = applyDiff(plan, [
      { action: 'resize_and_move', id: 'bed2', x: 18, y: 22, w: 12, h: 18 },
    ]);
    const bed = updated.levels[0].rooms.find((r) => r.id === 'bed2');
    assert.equal(bed.x, 18);
    assert.equal(bed.y, 22);
    assert.equal(bed.w, 12);
    assert.equal(bed.h, 18);
  });

  it('does not modify protected rooms', () => {
    const plan = makePlanSpec();
    const updated = applyDiff(plan, [
      { action: 'resize', id: 'hall1', w: 20, h: 30 },
    ]);
    const hall = updated.levels[0].rooms.find((r) => r.id === 'hall1');
    assert.equal(hall.w, 10);
    assert.equal(hall.h, 24);
  });

  it('preserves the requested totalAreaSqFt', () => {
    const plan = makePlanSpec();
    const before = plan.totalAreaSqFt;
    const updated = applyDiff(plan, [
      { action: 'resize', id: 'living1', w: 22, h: 22 },
    ]);
    // A local edit must not overwrite the user's requested total area.
    assert.equal(updated.totalAreaSqFt, before);
  });

  it('returns deep copy — original is unmodified', () => {
    const plan = makePlanSpec();
    const origW = plan.levels[0].rooms[0].w;
    applyDiff(plan, [{ action: 'resize', id: 'living1', w: 24, h: 24 }]);
    assert.equal(plan.levels[0].rooms[0].w, origW);
  });
});

// ── parseExactInstruction ───────────────────────────────────────────────────────

describe('parseExactInstruction', () => {
  it('parses "resize kitchen to 12x14"', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('resize kitchen to 12x14', plan);
    assert.ok(result);
    assert.equal(result.room.id, 'kitchen1');
    assert.equal(result.newW, 12);
    assert.equal(result.newH, 14);
  });

  it('parses "make living room 14x16"', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('make living room 14x16', plan);
    assert.ok(result);
    assert.equal(result.room.id, 'living1');
    assert.equal(result.newW, 14);
    assert.equal(result.newH, 16);
  });

  it('parses "change the kitchen to 12ft × 14ft"', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('change the kitchen to 12ft × 14ft', plan);
    assert.ok(result);
    assert.equal(result.newW, 12);
    assert.equal(result.newH, 14);
  });

  it('parses "kitchen: 12x14"', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('kitchen: 12x14', plan);
    assert.ok(result);
    assert.equal(result.room.id, 'kitchen1');
  });

  it('returns null for unrecognized room', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('resize ballroom to 30x40', plan);
    assert.equal(result, null);
  });

  it('returns null for non-matching instruction', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('add a window to the kitchen', plan);
    assert.equal(result, null);
  });

  it('rejects absurdly large dimensions', () => {
    const plan = makePlanSpec();
    const result = parseExactInstruction('resize kitchen to 300x400', plan);
    assert.equal(result, null);
  });
});

// ── parseGeminiDiff ─────────────────────────────────────────────────────────────

describe('parseGeminiDiff', () => {
  it('parses clean JSON array', () => {
    const raw = '[{"action":"resize","id":"kitchen1","w":14,"h":14}]';
    const result = parseGeminiDiff(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'kitchen1');
  });

  it('parses markdown-fenced JSON', () => {
    const raw = '```json\n[{"action":"resize","id":"bed1","w":14,"h":14}]\n```';
    const result = parseGeminiDiff(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'bed1');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseGeminiDiff('not json at all'), /No JSON array found/);
  });

  it('throws on empty string', () => {
    assert.throws(() => parseGeminiDiff(''), /No JSON array found/);
  });

  it('extracts array from surrounding text', () => {
    const raw = 'Here are the changes:\n[{"action":"move","id":"bed2","x":10,"y":10}]\nDone.';
    const result = parseGeminiDiff(raw);
    assert.equal(result.length, 1);
  });
});

// ── computeExactResizeChanges ───────────────────────────────────────────────────

describe('computeExactResizeChanges', () => {
  it('produces resize for target room', () => {
    const plan = makePlanSpec();
    const room = plan.levels[0].rooms.find((r) => r.id === 'kitchen1');
    const changes = computeExactResizeChanges(plan, room, plan.levels[0], 18, 18);
    assert.ok(changes.length >= 1);
    const target = changes.find((c) => c.id === 'kitchen1');
    assert.ok(target);
    assert.equal(target.w, 18);
    assert.equal(target.h, 18);
  });

  it('adjusts neighbor when width grows', () => {
    const plan = makePlanSpec();
    // kitchen1: x=20, w=16 → right edge at 36. dining1 at x=36
    // Growing kitchen width from 16 to 20 pushes right edge to 40
    const room = plan.levels[0].rooms.find((r) => r.id === 'kitchen1');
    const changes = computeExactResizeChanges(plan, room, plan.levels[0], 20, 16);
    const neighborChange = changes.find((c) => c.id === 'dining1');
    // dining1 should be pushed rightward
    if (neighborChange) {
      assert.ok(neighborChange.x > 36, 'neighbor should shift right');
    }
  });
});

// ── estimatePlanQuality ─────────────────────────────────────────────────────────

describe('estimatePlanQuality', () => {
  it('returns high score for a valid plan', () => {
    const plan = makePlanSpec();
    const result = estimatePlanQuality(plan);
    assert.ok(result.score > 50, `Expected score > 50 but got ${result.score}`);
  });

  it('detects missing levels', () => {
    const result = estimatePlanQuality({ levels: [] });
    assert.ok(result.issues.includes('levels_missing'));
  });

  it('detects overlapping rooms', () => {
    const plan = makePlanSpec();
    // Force overlap: move bed2 to same position as bed1
    plan.levels[0].rooms.find((r) => r.id === 'bed2').x = 0;
    plan.levels[0].rooms.find((r) => r.id === 'bed2').y = 20;
    const result = estimatePlanQuality(plan);
    const overlapIssues = result.issues.filter((i) => i.startsWith('overlap_'));
    assert.ok(overlapIssues.length > 0, 'Should detect overlap');
  });

  it('detects off-grid rooms', () => {
    const plan = makePlanSpec();
    plan.levels[0].rooms.find((r) => r.id === 'kitchen1').w = 15; // odd
    const result = estimatePlanQuality(plan);
    const offGrid = result.issues.filter((i) => i.startsWith('off_grid_'));
    assert.ok(offGrid.length > 0, 'Should detect off-grid room');
  });
});

// ── collectProtectedIssues ──────────────────────────────────────────────────────

describe('collectProtectedIssues', () => {
  it('returns empty when protected rooms unchanged', () => {
    const plan = makeTwoStoryPlan();
    const after = JSON.parse(JSON.stringify(plan));
    const issues = collectProtectedIssues(plan, after);
    assert.equal(issues.length, 0);
  });

  it('detects when a protected room is moved', () => {
    const plan = makeTwoStoryPlan();
    const after = JSON.parse(JSON.stringify(plan));
    // Move garage
    const garage = after.levels[0].rooms.find((r) => r.id === 'garage1');
    garage.x = 2;
    const issues = collectProtectedIssues(plan, after);
    assert.ok(issues.some((i) => i.includes('garage1')));
  });

  it('detects stair core changes', () => {
    const plan = makeTwoStoryPlan();
    const after = JSON.parse(JSON.stringify(plan));
    after.stairCore[0].x = 30; // changed from 34
    const issues = collectProtectedIssues(plan, after);
    assert.ok(issues.includes('stair_core_changed'));
  });
});

// ── collectRefinementScopeIssues ────────────────────────────────────────────────

describe('collectRefinementScopeIssues', () => {
  it('detects cross-level refinement', () => {
    const plan = makeTwoStoryPlan();
    const after = JSON.parse(JSON.stringify(plan));
    // Change rooms on both levels
    after.levels[0].rooms.find((r) => r.id === 'living1').w = 22;
    after.levels[1].rooms.find((r) => r.id === 'bed1').w = 22;
    const changes = [
      { action: 'resize', id: 'living1', w: 22, h: 16 },
      { action: 'resize', id: 'bed1', w: 22, h: 16 },
    ];
    const issues = collectRefinementScopeIssues(plan, changes, after);
    assert.ok(issues.includes('cross_level_refinement'));
  });

  it('allows single-level single-room changes', () => {
    const plan = makePlanSpec();
    const after = JSON.parse(JSON.stringify(plan));
    after.levels[0].rooms.find((r) => r.id === 'kitchen1').w = 18;
    const changes = [{ action: 'resize', id: 'kitchen1', w: 18, h: 16 }];
    const issues = collectRefinementScopeIssues(plan, changes, after);
    assert.ok(!issues.includes('cross_level_refinement'));
    assert.ok(!issues.includes('scattered_refinement_cluster'));
  });
});

// ── sanitizeChanges (wrapper) ───────────────────────────────────────────────────

describe('sanitizeChanges', () => {
  it('returns only the changes array', () => {
    const plan = makePlanSpec();
    const result = sanitizeChanges(plan, [
      { action: 'resize', id: 'kitchen1', w: 18, h: 16 },
    ]);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
  });
});
