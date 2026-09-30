'use strict';

// POST /api/plan/edit  { planSpec, ops?: [...] }
// The Studio's edit mode: apply hand edits (lib/planEdit/applyEditOps.js) and
// return the recomputed plan, its drawing and where each floor sits in it,
// the walls that can be dragged, the areas, and what the checks found. With
// no ops it describes the plan as sent (entering edit mode). No language
// model is involved; a refused edit answers 422 and changes nothing.

const { sanitizePlanInput } = require('../lib/sanitizePlanInput');
const { recomputeEditedPlan } = require('../lib/planEdit/recomputeEditedPlan');

const MAX_OPS = 20;
const OPS = new Set(['moveWall', 'resizeRoom', 'swapRooms', 'changeRoomType', 'openWall', 'closeWall', 'mergeRooms',
  'moveFurniture', 'turnFurniture', 'removeFurniture', 'resetFurniture']);
const text = (v) => (v === undefined || v === null ? v : String(v).slice(0, 120));
const number = (v) => (v === undefined ? undefined : Number(v));

function sanitizeOps(ops) {
  if (ops === undefined || ops === null) return [];
  if (!Array.isArray(ops) || ops.length > MAX_OPS) return null;
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object' || !OPS.has(op.op)) return null;
    out.push({ op: op.op, runId: text(op.runId), roomId: text(op.roomId), itemId: text(op.itemId), a: text(op.a), b: text(op.b),
      side: text(op.side), type: text(op.type), delta: number(op.delta), dx: number(op.dx), dy: number(op.dy) });
  }
  return out.map((op) => Object.fromEntries(Object.entries(op).filter(([, v]) => v !== undefined)));
}

module.exports = function planEditHandler(req, res) {
  const planSpec = sanitizePlanInput(req.body?.planSpec);
  if (!planSpec || !Array.isArray(planSpec.levels) || !planSpec.levels.length) {
    return res.status(400).json({ success: false, message: 'A generated floor plan is required.' });
  }
  const ops = sanitizeOps(req.body?.ops);
  if (!ops) return res.status(400).json({ success: false, message: `Send up to ${MAX_OPS} edits of a known kind.` });
  const surveyData = planSpec.designSurvey || req.body?.surveyData || {};
  try {
    const result = recomputeEditedPlan(planSpec, ops, surveyData);
    if (!result.ok) {
      return res.status(422).json({ success: false, code: 'EDIT_REFUSED', message: result.issues[0]?.message, issues: result.issues });
    }
    const { planSpec: plan, svg, layout, wallRuns, areas, issues, newIssues, changedRoomIds } = result;
    return res.json({ success: true, planSpec: plan, svg, layout, wallRuns, areas, issues, newIssues, changedRoomIds,
      estimate: plan.estimate || null });
  } catch (error) {
    console.error('[plan/edit]', error);
    return res.status(422).json({ success: false, code: 'EDIT_FAILED', message: 'That edit could not be applied to this plan.' });
  }
};

module.exports.sanitizeOps = sanitizeOps;
