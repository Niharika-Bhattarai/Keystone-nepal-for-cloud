'use strict';

/* Apply hand edits and rebuild everything that depends on the rooms:
 * openings, furniture, the building model, outdoor living, cost, drawing,
 * areas, the draggable walls and the checks. About a third of a second for a
 * two-storey house; no language model involved.
 */

const { normalizeBrief } = require('../tile/normalizeBrief');
const { enrichPlanSpec } = require('../buildingModel');
const { placeOpenings } = require('../placeOpenings');
const { renderPlanSvg } = require('../renderPlanSvg');
const { attachOutdoorLiving } = require('../residential/v2/outdoorLiving');
const { applyEditOps } = require('./applyEditOps');
const { planWallRuns } = require('./wallRuns');
const { checkEditedPlan, newIssues, planAreas, programCounts } = require('./editChecks');

const MAX_LOGGED_OPS = 500;

// Doors touching each room, as a comparable signature.
function doorSignatures(plan) {
  const out = new Map();
  for (const level of plan.levels || []) {
    for (const d of level.doors || []) {
      for (const id of [d.a, d.b]) {
        if (id === undefined || id === null) continue;
        const key = String(id);
        out.set(key, [...(out.get(key) || []), `${d.x},${d.y},${d.width || d.doorWidth || ''}`].sort());
      }
    }
  }
  return out;
}

function drawing(plan) {
  const layout = {};
  const svg = renderPlanSvg(plan, { layout });
  return { svg, layout };
}

/** The Studio's view of a plan: drawing, walls, areas, checks. */
function describePlan(plan, surveyData) {
  const { svg, layout } = drawing(plan);
  return { planSpec: plan, svg, layout, wallRuns: planWallRuns(plan), areas: planAreas(plan, surveyData), issues: checkEditedPlan(plan, surveyData) };
}

/**
 * Apply `ops` to `planSpec` and recompute. Returns
 *   { ok: false, issues }   when an operation is refused (the plan is unchanged), or
 *   { ok: true, planSpec, svg, layout, wallRuns, areas, issues, newIssues, changedRoomIds }.
 */
function recomputeEditedPlan(planSpec, ops, surveyData = planSpec?.designSurvey || {}) {
  const before = checkEditedPlan(planSpec, surveyData);
  if (!ops?.length) return { ok: true, ...describePlan(planSpec, surveyData), newIssues: [], changedRoomIds: [] };

  const applied = applyEditOps(planSpec, ops);
  if (applied.issues.length) return { ok: false, issues: applied.issues };

  const brief = normalizeBrief(surveyData);
  const options = { brief, footprint: planSpec.buildingModel?.footprint || {}, archetype: planSpec.archetype || null, surveyData };
  const changed = new Set(applied.changedRoomIds);
  const allIds = planSpec.levels.flatMap((l) => (l.rooms || []).map((r) => String(r.id)));
  const doorsBefore = doorSignatures(planSpec);

  let plan = applied.plan;
  for (const level of plan.levels || []) { level.doors = []; level.windows = []; }
  // A hand-placed piece that no longer fitted was reported by the edit that
  // took it out; only this edit's losses are reported now.
  if (plan.furnitureDiagnostics?.omitted) {
    plan.furnitureDiagnostics = { ...plan.furnitureDiagnostics, omitted: plan.furnitureDiagnostics.omitted.filter((o) => !o.userPlaced) };
  }
  plan.editFurnitureKeep = allIds.filter((id) => !changed.has(id));
  plan = enrichPlanSpec(plan, options);
  plan = placeOpenings(plan, surveyData);
  // Furniture stays where the room and its doors are unchanged.
  const doorsAfter = doorSignatures(plan);
  plan.editFurnitureKeep = allIds.filter((id) => !changed.has(id) &&
    JSON.stringify(doorsBefore.get(id) || []) === JSON.stringify(doorsAfter.get(id) || []));
  plan = enrichPlanSpec(plan, options);
  delete plan.editFurnitureKeep;
  if ((planSpec.levels || []).some((l) => (l.outdoor || []).length)) plan = attachOutdoorLiving(plan, brief);

  try {
    plan.estimate = require('../estimate/buildEstimate').buildEstimate(plan, { brief, surveyData });
  } catch (_) { /* the estimate is optional in edit mode; the plan stays valid without it */ }
  plan.edited = true;
  // What the plan had before its first hand edit, for the room counts.
  plan.editBaseline = planSpec.editBaseline || programCounts(planSpec);
  plan.edits = { ops: [...(planSpec.edits?.ops || []), ...ops].slice(-MAX_LOGGED_OPS) };

  const described = describePlan(plan, surveyData);
  const blocking = described.issues.filter((i) => i.severity === 'block');
  if (blocking.length) return { ok: false, issues: blocking };
  return { ok: true, ...described, newIssues: newIssues(before, described.issues), changedRoomIds: [...changed] };
}

module.exports = { recomputeEditedPlan, describePlan };
