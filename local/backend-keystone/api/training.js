'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const { renderPlanSvg }              = require('../lib/renderPlanSvg');
const { placeOpenings }              = require('../lib/placeOpenings');
const { enrichPlanSpec }             = require('../lib/buildingModel');
const { normalizeBrief }             = require('../lib/tile/normalizeBrief');
const { computeFootprintCandidates } = require('../lib/tile/computeFootprint');
const { buildProgramFromBrief }      = require('../lib/tile/buildProgramFromBrief');
const { generateTilePlan }           = require('../lib/tile/generateTilePlan');
const { tilesToPlanSpec }            = require('../lib/tile/tilesToPlanSpec');

// ── Storage ──────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, '../data/training');
const PLANS_FILE  = path.join(DATA_DIR, 'plans.jsonl');
const RATINGS_FILE = path.join(DATA_DIR, 'ratings.jsonl');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function appendLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// ── Brief presets ─────────────────────────────────────────────────────────────
const BRIEF_PRESETS = {
  '2bed_1car_pL2': {
    bedrooms: '2 Bed', bathrooms: '2 Bath', privateBaths: '1', stories: '2 Stories',
    garage: '1 Car Garage', masterLocation: 'Level 2 (Upper)', totalArea: '2400',
    shape: 'Rectangular', openConcept: 'Open Concept (Combined)',
    kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
    frontFacing: 'South',
  },
  '3bed_1car_pL1': {
    bedrooms: '3 Bed', bathrooms: '2 Bath', privateBaths: '1', stories: '2 Stories',
    garage: '1 Car Garage', masterLocation: 'Level 1 (Main)', totalArea: '2800',
    shape: 'Rectangular', openConcept: 'Open Concept (Combined)',
    kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
    frontFacing: 'South',
  },
  '3bed_2car_pL2': {
    bedrooms: '3 Bed', bathrooms: '3 Bath', privateBaths: '1', stories: '2 Stories',
    garage: '2 Car Garage', masterLocation: 'Level 2 (Upper)', totalArea: '3200',
    shape: 'Rectangular', openConcept: 'Open Concept (Combined)',
    kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
    frontFacing: 'South',
  },
  '2bed_no_garage': {
    bedrooms: '2 Bed', bathrooms: '2 Bath', privateBaths: '1', stories: '2 Stories',
    garage: 'None', masterLocation: 'Level 2 (Upper)', totalArea: '2200',
    shape: 'Rectangular', openConcept: 'Open Concept (Combined)',
    kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
    frontFacing: 'South',
  },
  '4bed_2car_pL1': {
    bedrooms: '4 Bed', bathrooms: '3 Bath', privateBaths: '2', stories: '2 Stories',
    garage: '2 Car Garage', masterLocation: 'Level 1 (Main)', totalArea: '3600',
    shape: 'Rectangular', openConcept: 'Open Concept (Combined)',
    kitchenPlacement: 'Rear of House', laundryLocation: 'Level 1 (near garage/mud)',
    frontFacing: 'South',
  },
};

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = {
  stairs: {
    label: 'Stair Quality',
    description: 'Which plan has better stairs? Look for: single-sided access, proper UP/DN label, natural flow between floors, reasonably sized landing.',
    highlightTypes: ['stairs'],
  },
  doors: {
    label: 'Door Placement',
    description: 'Which plan has better doors? Look for: no phantom stair doors, logical swing directions, all rooms accessible, no missing entries.',
    highlightTypes: [],
  },
  hallways: {
    label: 'Hallway Efficiency',
    description: 'Which plan uses hallways more efficiently? Look for: minimal wasted corridor, no oversized hallways, good flow without dead ends.',
    highlightTypes: ['hallway'],
  },
  proportions: {
    label: 'Room Proportions',
    description: 'Which plan has better room proportions? Look for: rooms that aren\'t too narrow/elongated, good bedroom & bathroom sizing, logical adjacency.',
    highlightTypes: ['bedroom', 'primary_bedroom', 'bathroom', 'primary_bathroom'],
  },
  overall: {
    label: 'Overall Quality',
    description: 'Which plan would you rather live in? Consider everything: layout, flow, proportions, and usability.',
    highlightTypes: [],
  },
};

// ── Plan metrics extraction ───────────────────────────────────────────────────
function extractMetrics(planSpec) {
  const levels = Array.isArray(planSpec?.levels) ? planSpec.levels : [];
  let totalSqFt = 0;
  let hallwaySqFt = 0;
  let stairCount = 0;
  let doorCount = 0;
  const roomTypes = {};

  for (const level of levels) {
    for (const room of (level?.rooms || [])) {
      const t = String(room?.type || '').toLowerCase();
      const sqft = (Number(room?.w) || 0) * (Number(room?.h) || 0);
      totalSqFt += sqft;
      if (t === 'hallway') hallwaySqFt += sqft;
      if (t === 'stairs') stairCount++;
      roomTypes[t] = (roomTypes[t] || 0) + 1;
    }
    doorCount += (level?.doors || []).length;
  }

  const hallwayRatio = totalSqFt > 0 ? hallwaySqFt / totalSqFt : 0;
  const levelCount = levels.length;

  return { totalSqFt, hallwaySqFt, hallwayRatio, stairCount, doorCount, roomTypes, levelCount };
}

// ── Single plan generation ────────────────────────────────────────────────────
function generateOnePlan(brief, footprint, surveyData) {
  const program  = buildProgramFromBrief(brief, footprint);
  const tilePlan = generateTilePlan(program, footprint, brief);
  let planSpec   = tilesToPlanSpec(tilePlan, footprint);
  planSpec = enrichPlanSpec(planSpec, { brief, footprint, archetype: brief.archetype, surveyData });
  planSpec = placeOpenings(planSpec, surveyData);
  planSpec = enrichPlanSpec(planSpec, { brief, footprint, archetype: brief.archetype, surveyData });
  return planSpec;
}

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Route handler ─────────────────────────────────────────────────────────────
module.exports = function trainingHandler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlPath = req.path || req.url || '';

  // ── GET /api/training/meta ─────────────────────────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/meta')) {
    return res.json({ briefPresets: BRIEF_PRESETS, themes: THEMES });
  }

  // ── POST /api/training/batch ──────────────────────────────────────────────
  // Generate N plans from a brief preset and store them.
  if (req.method === 'POST' && urlPath.endsWith('/batch')) {
    const { briefType, count = 20 } = req.body || {};
    const survey = BRIEF_PRESETS[briefType];
    if (!survey) {
      return res.status(400).json({ error: `Unknown briefType: ${briefType}. Valid: ${Object.keys(BRIEF_PRESETS).join(', ')}` });
    }

    const brief      = normalizeBrief(survey);
    const maxCount   = Math.min(Number(count) || 20, 100);
    const candidates = computeFootprintCandidates(brief, 2, 100);

    const generated  = [];
    const errors     = [];

    for (const footprint of candidates) {
      if (generated.length >= maxCount) break;
      try {
        const planSpec = generateOnePlan(brief, footprint, survey);
        const svg      = renderPlanSvg(planSpec);
        const id       = crypto.randomUUID();
        const metrics  = extractMetrics(planSpec);
        const record   = {
          id,
          briefType,
          brief: { bedrooms: brief.bedrooms, bathrooms: brief.bathrooms, stories: brief.stories, hasGarage: brief.hasGarage, primaryLevel: brief.primaryLevel, totalAreaSqFt: brief.totalAreaSqFt },
          footprint: { widthFt: footprint.widthFt, heightFt: footprint.heightFt, aspectRatio: footprint.aspectRatio, totalAreaSqFt: footprint.totalAreaSqFt },
          planSpec,
          svg,
          metrics,
          createdAt: new Date().toISOString(),
        };
        appendLine(PLANS_FILE, record);
        generated.push({ id, briefType, footprint: record.footprint, metrics });
      } catch (err) {
        errors.push(String(err?.message || err));
      }
    }

    return res.json({ generated: generated.length, errors: errors.length, plans: generated });
  }

  // ── GET /api/training/pair?theme=stairs&briefType=... ─────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/pair')) {
    const theme     = req.query?.theme || 'overall';
    const briefType = req.query?.briefType;

    const allPlans  = readLines(PLANS_FILE);
    let pool = briefType ? allPlans.filter((p) => p.briefType === briefType) : allPlans;

    if (pool.length < 2) {
      return res.status(404).json({ error: 'Not enough plans. Generate more plans first.', poolSize: pool.length });
    }

    // Load existing ratings for this theme to find the least-compared pairs
    const ratings   = readLines(RATINGS_FILE).filter((r) => r.theme === theme);
    const compared  = new Set(ratings.map((r) => [r.planAId, r.planBId].sort().join('|')));

    // Prefer pairs that haven't been compared yet
    let a, b;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    outer: for (let i = 0; i < shuffled.length; i++) {
      for (let j = i + 1; j < shuffled.length; j++) {
        const key = [shuffled[i].id, shuffled[j].id].sort().join('|');
        if (!compared.has(key)) { a = shuffled[i]; b = shuffled[j]; break outer; }
      }
    }
    // Fall back to any random pair if all have been compared
    if (!a) { a = shuffled[0]; b = shuffled[1]; }

    return res.json({
      theme,
      themeInfo: THEMES[theme] || THEMES.overall,
      briefType: a.briefType,
      planA: { id: a.id, footprint: a.footprint, metrics: a.metrics, svg: a.svg, planSpec: a.planSpec || null },
      planB: { id: b.id, footprint: b.footprint, metrics: b.metrics, svg: b.svg, planSpec: b.planSpec || null },
    });
  }

  // ── POST /api/training/rate ────────────────────────────────────────────────
  if (req.method === 'POST' && urlPath.endsWith('/rate')) {
    const { theme, briefType, planAId, planBId, winner } = req.body || {};
    if (!planAId || !planBId || !winner || !theme) {
      return res.status(400).json({ error: 'Required: theme, planAId, planBId, winner (a|b|tie|skip)' });
    }
    if (!['a', 'b', 'tie', 'skip'].includes(winner)) {
      return res.status(400).json({ error: 'winner must be: a, b, tie, or skip' });
    }
    if (winner !== 'skip') {
      const record = {
        id: crypto.randomUUID(),
        theme,
        briefType: briefType || null,
        planAId,
        planBId,
        winner,
        timestamp: new Date().toISOString(),
      };
      appendLine(RATINGS_FILE, record);
    }
    return res.json({ ok: true });
  }

  // Save annotated room changes from the interactive editor for ML training
  if (req.method === 'POST' && urlPath.endsWith('/annotate')) {
    const { planId, changes, timestamp } = req.body || {};
    if (!planId || !Array.isArray(changes) || changes.length === 0) {
      return res.status(400).json({ error: 'Required: planId, changes (non-empty array), timestamp' });
    }
    // Validate each change
    for (const change of changes) {
      if (!change.action || !change.id || !change.before || !change.after || !change.reason) {
        return res.status(400).json({ error: 'Each change must have: action, id, before, after, reason' });
      }
      if (!['move', 'resize', 'resize_and_move'].includes(change.action)) {
        return res.status(400).json({ error: 'action must be: move, resize, or resize_and_move' });
      }
    }
    // Store the annotation record
    const annotationRecord = {
      id: crypto.randomUUID(),
      planId,
      changes,
      timestamp,
      createdAt: new Date().toISOString(),
    };
    // Append to annotations file (create if doesn't exist)
    const ANNOTATIONS_FILE = path.join(__dirname, '../data/annotations.jsonl');
    try {
      const dir = path.dirname(ANNOTATIONS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(ANNOTATIONS_FILE, JSON.stringify(annotationRecord) + '\n');
    } catch (err) {
      console.error('[training] Error saving annotation:', err);
      return res.status(500).json({ error: 'Failed to save annotation' });
    }
    return res.json({ ok: true, annotationId: annotationRecord.id });
  }

  // GET /api/training/stats
  if (req.method === 'GET' && urlPath.endsWith('/stats')) {
    const plans   = readLines(PLANS_FILE);
    const ratings = readLines(RATINGS_FILE);
    const plansByType   = {};
    for (const p of plans) {
      plansByType[p.briefType] = (plansByType[p.briefType] || 0) + 1;
    }
    const ratingsByTheme = {};
    for (const r of ratings) {
      ratingsByTheme[r.theme] = (ratingsByTheme[r.theme] || 0) + 1;
    }
    return res.json({
      totalPlans:   plans.length,
      totalRatings: ratings.length,
      plansByType,
      ratingsByTheme,
      themes: Object.keys(THEMES),
      briefTypes: Object.keys(BRIEF_PRESETS),
    });
  }

  return res.status(404).json({ error: 'Unknown training endpoint' });
};
