// lib/tile/computeFootprint.js
//
// Phase 2 rewrite:
// - tighter footprint aspect-ratio bands, especially for large 1-story homes
// - capacity / program-pressure estimation before candidate generation
// - dynamic minimum dimensions based on requested program
// - avoids near-square large plates that lead to downstream stripe-packing failures

'use strict';

function factorPairs(n) {
  const pairs = [];
  for (let a = 1; a * a <= n; a++) {
    if (n % a === 0) pairs.push([a, n / a]);
  }
  return pairs;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGarageType(brief) {
  if (!brief?.hasGarage) return 'NONE';
  const raw = String(brief?.garageType || 'NONE').toUpperCase();
  if (raw === 'ONE_CAR' || raw === '1_CAR' || raw === '1CAR') return 'ONE_CAR';
  return 'TWO_CAR';
}

function countOptionalFeatures(brief) {
  const directKeys = [
    'study', 'gamingRoom', 'gaming_room', 'gym', 'library', 'movieRoom', 'movie_room',
    'office', 'flexRoom', 'flex_room', 'playroom', 'craftRoom', 'craft_room',
    'musicRoom', 'music_room', 'wineCellar', 'wine_cellar'
  ];

  let count = 0;

  for (const key of directKeys) {
    const value = brief?.[key];
    if (typeof value === 'boolean' && value) count += 1;
    else if (Number.isFinite(Number(value)) && Number(value) > 0) count += Number(value);
  }

  if (Array.isArray(brief?.features)) count += brief.features.length;
  if (Array.isArray(brief?.extraRooms)) count += brief.extraRooms.length;

  for (const [k, v] of Object.entries(brief?.featureCounts || {})) {
    count += Math.max(0, num(v, 0));
  }

  for (const [k, v] of Object.entries(brief || {})) {
    if (!/^num/i.test(k) && !/^count/i.test(k)) continue;
    const lk = k.toLowerCase();
    if (/(study|office|game|gym|library|movie|flex|play|craft|music|wine)/.test(lk)) {
      count += Math.max(0, num(v, 0));
    }
  }

  return count;
}

function estimateProgramPressure(brief, tileSizeFt = 2) {
  const stories = Math.max(1, num(brief?.stories, 1));
  const conditionedAreaSqFt = Math.max(600, num(brief?.conditionedAreaSqFt, num(brief?.totalAreaSqFt, 2000)));
  const totalAreaSqFt = Math.max(800, num(brief?.footprintAreaSqFtTarget, conditionedAreaSqFt));
  const areaPerLevelSqFt = totalAreaSqFt / stories;

  const bedrooms = Math.max(1, num(brief?.bedrooms, num(brief?.bedroomCount, 3)));
  const bathrooms = Math.max(1, num(brief?.bathrooms, num(brief?.bathroomCount, 2)));
  const optionalFeatures = countOptionalFeatures(brief);
  const garageType = normalizeGarageType(brief);

  let requiredSqFt = 0;
  requiredSqFt += bedrooms * 135;
  requiredSqFt += bathrooms * 55;
  requiredSqFt += 320; // living / dining / kitchen baseline
  requiredSqFt += 120; // circulation / storage / entry / laundry / mech
  requiredSqFt += optionalFeatures * 110;
  if (garageType === 'ONE_CAR') requiredSqFt += 280;
  if (garageType === 'TWO_CAR') requiredSqFt += 440;

  // Compare whole-house program demand to whole-house target, then derive
  // per-level pressure separately. The previous code compared whole-house
  // demand to per-level area, which severely overstated required plate size
  // for multi-story homes and biased candidates toward oversized footprints.
  const requiredWholeHouseSqFt = requiredSqFt;
  const requiredPerLevelSqFt = requiredWholeHouseSqFt / stories;
  const pressure = requiredPerLevelSqFt / Math.max(1, areaPerLevelSqFt);
  const requiredCells = Math.ceil(requiredPerLevelSqFt / (tileSizeFt * tileSizeFt));

  const minWidthFt = Math.max(
    garageType === 'TWO_CAR' ? 34 : garageType === 'ONE_CAR' ? 28 : 24,
    20 + bedrooms * 2 + Math.min(8, optionalFeatures * 2)
  );

  const minDepthFt = Math.max(
    24,
    20 + Math.ceil(bathrooms / 2) * 2 + (stories === 1 ? 4 : 0)
  );

  return {
    stories,
    totalAreaSqFt,
    conditionedAreaSqFt,
    areaPerLevelSqFt,
    bedrooms,
    bathrooms,
    optionalFeatures,
    garageType,
    requiredSqFt: requiredWholeHouseSqFt,
    requiredWholeHouseSqFt,
    requiredPerLevelSqFt,
    requiredCells,
    pressure,
    minWidthTiles: Math.ceil(minWidthFt / tileSizeFt),
    minHeightTiles: Math.ceil(minDepthFt / tileSizeFt),
  };
}

function buildFootprint(widthTiles, heightTiles, brief, tileSizeFt) {
  const GARAGE_PROTRUSION_FT = brief.hasGarage ? 8 : 0;
  const protrusionTiles = Math.round(GARAGE_PROTRUSION_FT / tileSizeFt);
  const conditionedAreaSqFt = Number(brief.conditionedAreaSqFt || brief.totalAreaSqFt) || 2000;
  const footprintAreaSqFtTarget = Number(brief.footprintAreaSqFtTarget || brief.totalAreaSqFt) || 2000;

  return {
    tileSizeFt,
    stories: Number(brief.stories) || 1,
    totalAreaSqFt: conditionedAreaSqFt,
    conditionedAreaSqFt,
    footprintAreaSqFtTarget,
    areaPerLevelSqFtTarget:
      footprintAreaSqFtTarget / (Number(brief.stories) || 1),
    widthTiles,
    heightTiles,
    widthFt: widthTiles * tileSizeFt,
    heightFt: heightTiles * tileSizeFt,
    levelAreaSqFtActual: widthTiles * heightTiles * tileSizeFt * tileSizeFt,
    protrusionTiles,
    protrusionFt: GARAGE_PROTRUSION_FT,
    aspectRatio: widthTiles / heightTiles,
  };
}

const SHAPE_PROFILES = {
  WIDE: {
    ratioBand: { min: 1.70, max: 3.40, center: 2.35 },
    idealBand: { min: 2.00, max: 2.75 },
    targets: [2.25, 2.5, 2.8, 1.95, 3.1, 1.8],
    minCandidatesInBand: 4,
  },
  RECTANGULAR: {
    ratioBand: { min: 1.25, max: 2.20, center: 1.65 },
    idealBand: { min: 1.40, max: 1.95 },
    targets: [1.5, 1.7, 1.9, 1.35, 2.1, 1.45],
    minCandidatesInBand: 5,
  },
  SQUARE: {
    ratioBand: { min: 0.95, max: 1.12, center: 1.02 },
    idealBand: { min: 0.98, max: 1.08 },
    targets: [1.0, 1.04, 0.98, 1.08],
    minCandidatesInBand: 4,
  },
  DEEP: {
    ratioBand: { min: 0.58, max: 0.95, center: 0.76 },
    idealBand: { min: 0.64, max: 0.86 },
    targets: [0.74, 0.68, 0.82, 0.62, 0.9],
    minCandidatesInBand: 4,
  },
};

const TARGET_RATIOS_FALLBACK = [1.45, 1.7, 2.0, 1.3, 2.3, 0.9, 0.75];

function resolveEffectiveShape(brief) {
  const rawShape = String(brief?.shape || 'RECTANGULAR').toUpperCase();
  const lot = String(brief?.lotContext || 'SUBURBAN').toUpperCase();

  // If user explicitly chose a non-default shape, always respect it exactly.
  // Lot-context overrides only apply when the user left the default 'RECTANGULAR'.
  if (rawShape !== 'RECTANGULAR') return rawShape;

  if (lot === 'URBAN') return 'DEEP';
  if (lot === 'VIEW' || lot === 'WATERFRONT') return 'WIDE';
  if (lot === 'RURAL') return 'SQUARE';

  return rawShape;
}

function applyProgramProfileAdjustments(profile, brief, tileSizeFt, shape) {
  const p = estimateProgramPressure(brief, tileSizeFt);

  const adjusted = {
    ...profile,
    ratioBand: { ...profile.ratioBand },
    idealBand: { ...profile.idealBand },
    targets: [...profile.targets],
  };

  // DEEP and WIDE shapes encode hard directional constraints (AR < 1.0 or AR > 1.6).
  // Program-pressure overrides push the min AR above 1.0, violating DEEP expectations.
  // Skip all ratio overrides for these shapes — their band is already correct.
  if (shape === 'DEEP' || shape === 'WIDE') return adjusted;

  const isLargeSingleStory =
    p.stories === 1 &&
    (p.areaPerLevelSqFt >= 2200 || p.pressure >= 0.92 || p.optionalFeatures >= 2);

  const isLargeMultiStory =
    p.stories >= 2 && p.areaPerLevelSqFt >= 1400;

  if (isLargeSingleStory) {
    adjusted.ratioBand.min = Math.max(1.35, adjusted.ratioBand.min);
    adjusted.ratioBand.max = Math.min(2.25, adjusted.ratioBand.max);
    adjusted.idealBand.min = Math.max(1.45, adjusted.idealBand.min);
    adjusted.idealBand.max = Math.min(2.05, adjusted.idealBand.max);
    adjusted.targets = [1.5, 1.65, 1.8, 1.95, 2.1, 1.4];
    adjusted.minCandidatesInBand = Math.max(adjusted.minCandidatesInBand, 6);
  } else if (isLargeMultiStory) {
    adjusted.ratioBand.min = Math.max(1.18, adjusted.ratioBand.min);
    adjusted.ratioBand.max = Math.min(2.35, adjusted.ratioBand.max);
    adjusted.idealBand.min = Math.max(1.3, adjusted.idealBand.min);
    adjusted.idealBand.max = Math.min(2.0, adjusted.idealBand.max);
    adjusted.targets = Array.from(new Set([1.4, 1.55, 1.75, 1.95, ...adjusted.targets]));
  }

  if (p.pressure >= 1.0) {
    adjusted.ratioBand.min = Math.max(adjusted.ratioBand.min, 1.45);
    adjusted.idealBand.min = Math.max(adjusted.idealBand.min, 1.55);
    adjusted.targets = Array.from(new Set([1.6, 1.8, 2.0, ...adjusted.targets]));
  }

  return adjusted;
}

function profileWithLot(brief, tileSizeFt = 2) {
  const lot = String(brief?.lotContext || 'SUBURBAN').toUpperCase();
  const shape = resolveEffectiveShape(brief);
  const base = SHAPE_PROFILES[shape] || SHAPE_PROFILES.RECTANGULAR;

  const profile = {
    ...base,
    ratioBand: { ...base.ratioBand },
    idealBand: { ...base.idealBand },
    targets: [...base.targets],
  };

  if (lot === 'URBAN') {
    profile.ratioBand.min = Math.max(0.55, profile.ratioBand.min - 0.05);
    profile.ratioBand.max = Math.min(1.0, profile.ratioBand.max);
    profile.idealBand.max = Math.min(profile.idealBand.max, 0.88);
    profile.targets = [...profile.targets, 0.66, 0.78];
  } else if (lot === 'CORNER') {
    profile.ratioBand.min = Math.max(1.15, profile.ratioBand.min);
    profile.ratioBand.max = Math.min(2.3, Math.max(profile.ratioBand.max, 2.0));
    profile.targets = [...profile.targets, 1.5, 1.85];
  } else if (lot === 'VIEW' || lot === 'WATERFRONT') {
    profile.ratioBand.min = Math.max(1.75, profile.ratioBand.min);
    profile.ratioBand.max = Math.min(3.3, Math.max(profile.ratioBand.max, 3.0));
    profile.idealBand.min = Math.max(2.0, profile.idealBand.min);
    profile.targets = [...profile.targets, 2.2, 2.7];
  } else if (lot === 'RURAL') {
    profile.ratioBand.min = Math.max(0.95, profile.ratioBand.min - 0.04);
    profile.ratioBand.max = Math.min(2.0, profile.ratioBand.max + 0.05);
    profile.targets = [...profile.targets, 1.2, 1.35];
  }

  const withProgram = applyProgramProfileAdjustments(profile, brief, tileSizeFt, shape);

  return {
    shape,
    profile: withProgram,
    pressure: estimateProgramPressure(brief, tileSizeFt),
  };
}

function chooseOrientedDims(a, b, targetRatio) {
  const options = [
    { w: a, h: b, ratio: a / b },
    { w: b, h: a, ratio: b / a },
  ];

  options.sort(
    (x, y) => Math.abs(x.ratio - targetRatio) - Math.abs(y.ratio - targetRatio)
  );

  return options[0];
}

function meetsProgramMinDims(w, h, brief, tileSizeFt = 2) {
  const p = estimateProgramPressure(brief, tileSizeFt);

  let minW = Math.max(6, p.minWidthTiles);
  let minH = Math.max(6, p.minHeightTiles);

  if (p.stories >= 2) {
    minW = Math.max(minW, 10);
    minH = Math.max(minH, 9);
  }

  if (p.garageType === 'TWO_CAR') {
    minW = Math.max(minW, 17);
    minH = Math.max(minH, 10);
  } else if (p.garageType === 'ONE_CAR') {
    minW = Math.max(minW, 14);
    minH = Math.max(minH, 9);
  }

  return w >= minW && h >= minH;
}

function ratioFitCost(ratio, profile) {
  const { ratioBand, idealBand } = profile;

  if (ratio >= idealBand.min && ratio <= idealBand.max) return 0;
  if (ratio >= ratioBand.min && ratio <= ratioBand.max) return 1;

  const d = ratio < ratioBand.min
    ? (ratioBand.min - ratio)
    : (ratio - ratioBand.max);

  return 3 + d * 20;
}

function footprintPenalty(fp, profile, brief, targetCells, tileSizeFt = 2) {
  const p = estimateProgramPressure(brief, tileSizeFt);

  const actualCells = fp.widthTiles * fp.heightTiles;

  const ratioPenalty = ratioFitCost(fp.aspectRatio, profile) * 50;
  const areaPenalty = Math.abs(actualCells - targetCells) * 5;

  const nearSquarePenalty =
    p.stories === 1 &&
    p.areaPerLevelSqFt >= 2200 &&
    fp.aspectRatio < 1.3
      ? 300
      : 0;

  const underCapacityPenalty =
    actualCells < p.requiredCells
      ? (p.requiredCells - actualCells) * 20
      : 0;

  const narrowSidePenalty =
    Math.min(fp.widthTiles, fp.heightTiles) < Math.min(p.minWidthTiles, p.minHeightTiles)
      ? (Math.min(p.minWidthTiles, p.minHeightTiles) - Math.min(fp.widthTiles, fp.heightTiles)) * 25
      : 0;

  return (
    ratioPenalty +
    areaPenalty +
    nearSquarePenalty +
    underCapacityPenalty +
    narrowSidePenalty
  );
}

function findBestForRatio(
  targetCells,
  targetRatio,
  seen,
  brief,
  tileSizeFt,
  maxDelta = 80,
  profile = null
) {
  for (let delta = 0; delta <= maxDelta; delta++) {
    for (const adj of (delta === 0 ? [0] : [delta, -delta])) {
      const cells = targetCells + adj;
      if (cells <= 0) continue;

      let best = null;

      for (const [a, b] of factorPairs(cells)) {
        const chosen = chooseOrientedDims(a, b, targetRatio);
        const ratio = chosen.ratio;

        if (ratio < 0.35 || ratio > 4.25) continue;
        if (!meetsProgramMinDims(chosen.w, chosen.h, brief, tileSizeFt)) continue;

        const key = `${chosen.w}x${chosen.h}`;
        if (seen.has(key)) continue;

        const fp = buildFootprint(chosen.w, chosen.h, brief, tileSizeFt);
        const score = profile
          ? footprintPenalty(fp, profile, brief, targetCells, tileSizeFt)
          : (Math.abs(cells - targetCells) * 8 + Math.abs(ratio - targetRatio) * 25);

        if (!best || score < best.score) {
          best = { ...chosen, score };
        }
      }

      if (best) {
        seen.add(`${best.w}x${best.h}`);
        return buildFootprint(best.w, best.h, brief, tileSizeFt);
      }
    }
  }

  return null;
}

function collectBandCandidates({ targetCells, profile, brief, tileSizeFt, seen, needed }) {
  if (needed <= 0) return [];

  const out = [];
  const pool = [];

  for (let delta = 0; delta <= 120; delta++) {
    for (const adj of (delta === 0 ? [0] : [delta, -delta])) {
      const cells = targetCells + adj;
      if (cells <= 0) continue;

      for (const [a, b] of factorPairs(cells)) {
        const candidates = [
          { w: a, h: b, ratio: a / b },
          { w: b, h: a, ratio: b / a },
        ];

        for (const c of candidates) {
          if (!meetsProgramMinDims(c.w, c.h, brief, tileSizeFt)) continue;
          if (c.ratio < profile.ratioBand.min || c.ratio > profile.ratioBand.max) continue;

          const key = `${c.w}x${c.h}`;
          if (seen.has(key)) continue;

          const fp = buildFootprint(c.w, c.h, brief, tileSizeFt);
          pool.push({
            ...c,
            score: footprintPenalty(fp, profile, brief, targetCells, tileSizeFt),
          });
        }
      }
    }
  }

  pool.sort((a, b) => a.score - b.score);

  for (const p of pool) {
    if (out.length >= needed) break;

    const key = `${p.w}x${p.h}`;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(buildFootprint(p.w, p.h, brief, tileSizeFt));
  }

  return out;
}

function dedupeFootprints(footprints) {
  const seen = new Set();
  const out = [];

  for (const fp of footprints) {
    const key = `${fp.widthTiles}x${fp.heightTiles}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fp);
  }

  return out;
}

function collectExhaustiveCandidates({ targetCells, profile, brief, tileSizeFt, seen, needed }) {
  if (needed <= 0) return [];
  const p = estimateProgramPressure(brief, tileSizeFt);
  const out = [];
  const pool = [];

  const maxWidth = Math.max(p.minWidthTiles + 2, Math.ceil(Math.sqrt((targetCells + 260) * Math.max(1, profile.ratioBand.max))) + 4);
  const maxHeight = Math.max(p.minHeightTiles + 2, Math.ceil((targetCells + 260) / Math.max(1, p.minWidthTiles)) + 4);

  for (let w = p.minWidthTiles; w <= maxWidth; w++) {
    for (let h = p.minHeightTiles; h <= maxHeight; h++) {
      const cells = w * h;
      if (Math.abs(cells - targetCells) > 260) continue;
      const ratio = w / h;
      if (ratio < 0.35 || ratio > 4.25) continue;
      if (!meetsProgramMinDims(w, h, brief, tileSizeFt)) continue;

      const key = `${w}x${h}`;
      if (seen.has(key)) continue;
      const fp = buildFootprint(w, h, brief, tileSizeFt);
      pool.push({
        w, h,
        score: footprintPenalty(fp, profile, brief, targetCells, tileSizeFt),
      });
    }
  }

  pool.sort((a, b) => a.score - b.score);
  for (const candidate of pool) {
    if (out.length >= needed) break;
    const key = `${candidate.w}x${candidate.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(buildFootprint(candidate.w, candidate.h, brief, tileSizeFt));
  }

  return out;
}

function computeFootprintCandidates(brief, tileSizeFt = 2, count = 10) {
  const totalAreaSqFt = Math.max(800, Number(brief.footprintAreaSqFtTarget || brief.totalAreaSqFt) || 2000);
  const stories = Math.max(1, Number(brief.stories) || 1);
  const areaPerLevel = totalAreaSqFt / stories;
  const targetCells = Math.max(100, Math.round(areaPerLevel / (tileSizeFt * tileSizeFt)));

  const { profile, pressure } = profileWithLot(brief, tileSizeFt);
  const seen = new Set();
  let results = [];

  const dynamicTargets = Array.from(
    new Set([
      ...profile.targets,
      profile.idealBand.min,
      profile.ratioBand.center,
      profile.idealBand.max,
    ])
  ).filter((x) => Number.isFinite(x));

  const baseMaxDelta =
    pressure.pressure >= 1
      ? 140
      : pressure.pressure >= 0.9
        ? 110
        : 80;

  for (const targetRatio of dynamicTargets) {
    const fp = findBestForRatio(
      targetCells,
      targetRatio,
      seen,
      brief,
      tileSizeFt,
      baseMaxDelta,
      profile
    );

    if (fp) results.push(fp);
    if (results.length >= count) break;
  }

  if (!results.length) {
    const fallbackRatio = clamp(
      profile.ratioBand.center || 1.6,
      profile.ratioBand.min,
      profile.ratioBand.max
    );

    const rawWidth = Math.sqrt(targetCells * fallbackRatio);
    const wT = Math.max(pressure.minWidthTiles, Math.round(rawWidth));
    const hT = Math.max(pressure.minHeightTiles, Math.ceil(targetCells / Math.max(1, wT)));

    results.push(buildFootprint(wT, hT, brief, tileSizeFt));
    seen.add(`${wT}x${hT}`);
  }

  const inBand = (fp) =>
    fp.aspectRatio >= profile.ratioBand.min &&
    fp.aspectRatio <= profile.ratioBand.max;

  const currentBandCount = results.filter(inBand).length;

  if (currentBandCount < profile.minCandidatesInBand) {
    const injected = collectBandCandidates({
      targetCells,
      profile,
      brief,
      tileSizeFt,
      seen,
      needed: Math.min(count, profile.minCandidatesInBand) - currentBandCount,
    });

    results.push(...injected);
  }

  if (results.length < count) {
    for (const targetRatio of TARGET_RATIOS_FALLBACK) {
      const fp = findBestForRatio(
        targetCells,
        targetRatio,
        seen,
        brief,
        tileSizeFt,
        150,
        profile
      );

      if (fp) results.push(fp);
      if (results.length >= count) break;
    }
  }

  if (results.length < count) {
    const exhaustive = collectExhaustiveCandidates({
      targetCells,
      profile,
      brief,
      tileSizeFt,
      seen,
      needed: count - results.length,
    });
    results.push(...exhaustive);
  }

  results = dedupeFootprints(results).sort((a, b) => {
    const scoreA = footprintPenalty(a, profile, brief, targetCells, tileSizeFt);
    const scoreB = footprintPenalty(b, profile, brief, targetCells, tileSizeFt);

    if (scoreA !== scoreB) return scoreA - scoreB;

    return (
      Math.abs(a.aspectRatio - profile.ratioBand.center) -
      Math.abs(b.aspectRatio - profile.ratioBand.center)
    );
  });

  const sliced = results.slice(0, count);
  const firstInBand = sliced.findIndex(inBand);

  if (firstInBand > 0) {
    const [bestBand] = sliced.splice(firstInBand, 1);
    sliced.unshift(bestBand);
  }

  return sliced;
}

function computeFootprint(brief, tileSizeFt = 2) {
  return computeFootprintCandidates(brief, tileSizeFt, 10)[0];
}

module.exports = {
  computeFootprint,
  computeFootprintCandidates,
  resolveEffectiveShape,
  SHAPE_PROFILES,
  estimateProgramPressure,
};
