'use strict';

const { listVariationProfiles } = require('./variationProfiles');
const { isSocialFeaturePair } = require('./featurePairPolicy');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function evenFt(value) {
  const rounded = Math.round(num(value, 0) / 2) * 2;
  return Math.max(24, rounded);
}

function even(value, minValue = 2) {
  const rounded = Math.round(num(value, 0) / 2) * 2;
  return Math.max(minValue, rounded);
}

function clampEven(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, even(value, minValue)));
}

function sumRectAreas(rects) {
  return (Array.isArray(rects) ? rects : []).reduce((sum, rect) => {
    const w = Math.max(0, num(rect?.w));
    const h = Math.max(0, num(rect?.h));
    return sum + (w * h);
  }, 0);
}

// The notch corner is part of the envelope, so it has to vary across the
// candidate set. Keying it only off variation names meant every unnamed
// variation fell through to one corner: a one-storey L-shaped brief generated
// 48 footprints that all notched north-east, so every candidate collided with
// the same rooms and two thirds of the L envelope space was unreachable.
// Named variations keep their intended corner; the rest are distributed by a
// stable hash so the ordering stays deterministic across processes.
const L_SHAPE_CORNERS = ['north_east', 'south_east', 'north_west'];

function stableVariationIndex(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildShapeProfile(shape, width, height, variationId = 'variant_a_compact_core') {
  const normalized = String(shape || 'RECTANGULAR').toUpperCase();
  const variation = String(variationId || 'variant_a_compact_core');

  if (normalized === 'L_SHAPE') {
    const notchWidth = clampEven(width * 0.3, 8, Math.max(8, width - 16));
    const notchDepth = clampEven(height * 0.28, 8, Math.max(8, height - 14));
    const corner = variation.includes('daylight')
      ? 'north_west'
      : variation.includes('service')
        ? 'south_east'
        : L_SHAPE_CORNERS[stableVariationIndex(variation) % L_SHAPE_CORNERS.length];
    const voidRect = corner === 'north_west'
      ? { x: 0, y: 0, w: notchWidth, h: notchDepth }
      : corner === 'south_east'
        ? { x: width - notchWidth, y: height - notchDepth, w: notchWidth, h: notchDepth }
        : { x: width - notchWidth, y: 0, w: notchWidth, h: notchDepth };
    const voidRects = [voidRect];
    return {
      shape: 'L_SHAPE',
      profileId: `l_${corner}`,
      voidRects,
      effectiveAreaSqFt: Math.max(0, width * height - sumRectAreas(voidRects)),
    };
  }

  if (normalized === 'T_SHAPE') {
    const notchDepth = clampEven(height * 0.26, 8, Math.max(8, height - 14));
    const stemWidth = clampEven(width * 0.42, 12, Math.max(12, width - 12));
    const baseSide = clampEven((width - stemWidth) / 2, 4, Math.max(4, Math.floor((width - stemWidth) / 2)));
    const orientation = variation.includes('daylight')
      ? 'south'
      : variation.includes('service')
        ? 'north_offset'
        : 'north';

    let leftNotchWidth = baseSide;
    let rightNotchWidth = baseSide;
    if (orientation === 'north_offset') {
      leftNotchWidth = clampEven(baseSide + 4, 4, Math.max(4, width - stemWidth - 4));
      rightNotchWidth = Math.max(4, width - stemWidth - leftNotchWidth);
      rightNotchWidth = even(rightNotchWidth, 4);
      if ((leftNotchWidth + rightNotchWidth + stemWidth) !== width) {
        rightNotchWidth = Math.max(4, width - stemWidth - leftNotchWidth);
      }
    }
    const y = orientation === 'south' ? height - notchDepth : 0;
    const voidRects = [
      { x: 0, y, w: leftNotchWidth, h: notchDepth },
      { x: width - rightNotchWidth, y, w: rightNotchWidth, h: notchDepth },
    ];
    return {
      shape: 'T_SHAPE',
      profileId: `t_${orientation}`,
      voidRects,
      effectiveAreaSqFt: Math.max(0, width * height - sumRectAreas(voidRects)),
    };
  }

  return {
    shape: normalized,
    profileId: 'rectangular',
    voidRects: [],
    effectiveAreaSqFt: width * height,
  };
}

function buildFootprint(widthFt, heightFt, brief, variation = null, shapeProfile = null) {
  const width = evenFt(widthFt);
  const height = evenFt(heightFt);
  const stories = Math.max(1, num(brief?.stories, 1));
  const profile = shapeProfile || buildShapeProfile(String(brief?.shape || 'RECTANGULAR').toUpperCase(), width, height, variation?.id);

  return {
    tileSizeFt: 2,
    stories,
    totalAreaSqFt: num(brief?.totalAreaSqFt),
    conditionedAreaSqFt: num(brief?.conditionedAreaSqFt || brief?.totalAreaSqFt),
    footprintAreaSqFtTarget: num(brief?.footprintAreaSqFtTarget || brief?.totalAreaSqFt),
    areaPerLevelSqFtTarget: num(brief?.footprintAreaSqFtTarget || brief?.totalAreaSqFt) / stories,
    widthTiles: Math.round(width / 2),
    heightTiles: Math.round(height / 2),
    widthFt: width,
    heightFt: height,
    levelAreaSqFtActual: num(profile?.effectiveAreaSqFt, width * height),
    protrusionTiles: 0,
    protrusionFt: 0,
    aspectRatio: width / Math.max(1, height),
    envelopeShape: String(profile?.shape || 'RECTANGULAR'),
    envelopeProfileId: String(profile?.profileId || 'rectangular'),
    envelopeVoidRects: Array.isArray(profile?.voidRects) ? profile.voidRects : [],
    variationId: String(variation?.id || 'variant_a_compact_core'),
    variationLabel: String(variation?.label || 'Compact Core'),
    variationTheme: String(variation?.theme || 'balanced_compact'),
    functionalId: String(variation?.functionalId || 'front_core_compact'),
    functionalLabel: String(variation?.functionalLabel || 'Front Core — Compact'),
  };
}

function dedupeFootprints(footprints) {
  const seen = new Set();
  const out = [];
  for (const footprint of footprints) {
    const key = `${footprint.widthFt}x${footprint.heightFt}:${footprint.variationId || 'default'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(footprint);
  }
  return out;
}

function withinBand(value, min, max) {
  const n = num(value);
  return n >= min && n <= max;
}

function uniqueNumbers(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = evenFt(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.sort((a, b) => a - b);
}

function resolveShapeBias(shape, stories) {
  const normalized = String(shape || 'RECTANGULAR').toUpperCase();
  const isTwoStory = Number(stories || 1) >= 2;

  if (normalized === 'L_SHAPE') {
    return {
      targetAspectDelta: 0.08,
      widthScale: 1.04,
      depthBias: 0,
      widthBias: 1,
      minDepth: isTwoStory ? 28 : 30,
      maxDepthOffset: 1,
      minWidthBoost: 2,
    };
  }

  if (normalized === 'T_SHAPE') {
    return {
      targetAspectDelta: 0.14,
      widthScale: 1.08,
      depthBias: 0,
      widthBias: 2,
      minDepth: isTwoStory ? 28 : 30,
      maxDepthOffset: 1,
      minWidthBoost: 2,
    };
  }

  if (normalized === 'WIDE') {
    return {
      targetAspectDelta: 0.28,
      widthScale: 1.08,
      depthBias: -1,
      widthBias: 2,
      minDepth: isTwoStory ? 26 : 28,
      maxDepthOffset: -1,
      minWidthBoost: 2,
    };
  }

  if (normalized === 'DEEP') {
    return {
      targetAspectDelta: -0.24,
      widthScale: 0.92,
      depthBias: 2,
      widthBias: -2,
      minDepth: isTwoStory ? 30 : 30,
      maxDepthOffset: 2,
      minWidthBoost: 0,
    };
  }

  return {
    targetAspectDelta: 0,
    widthScale: 1,
    depthBias: 0,
    widthBias: 0,
    minDepth: isTwoStory ? 28 : 28,
    maxDepthOffset: 0,
    minWidthBoost: 0,
  };
}

function resolveLotContextBias(lotContext, stories) {
  const normalized = String(lotContext || 'SUBURBAN').toUpperCase();
  const isTwoStory = Number(stories || 1) >= 2;

  if (normalized === 'URBAN') {
    return {
      targetAspectDelta: -0.2,
      widthScale: 0.94,
      depthBias: 2,
      widthBias: -2,
      minDepth: isTwoStory ? 30 : 30,
      maxDepthOffset: 2,
      minWidthBoost: 0,
    };
  }

  if (normalized === 'RURAL') {
    return {
      targetAspectDelta: 0.18,
      widthScale: 1.08,
      depthBias: -1,
      widthBias: 2,
      minDepth: isTwoStory ? 28 : 28,
      maxDepthOffset: 0,
      minWidthBoost: 2,
    };
  }

  if (normalized === 'VIEW' || normalized === 'WATERFRONT') {
    return {
      targetAspectDelta: 0.16,
      widthScale: 1.06,
      depthBias: -1,
      widthBias: 1,
      minDepth: isTwoStory ? 28 : 28,
      maxDepthOffset: 0,
      minWidthBoost: 2,
    };
  }

  return {
    targetAspectDelta: 0,
    widthScale: 1,
    depthBias: 0,
    widthBias: 0,
    minDepth: isTwoStory ? 28 : 28,
    maxDepthOffset: 0,
    minWidthBoost: 0,
  };
}

function combineBiases(...biases) {
  const aggregate = {
    targetAspectDelta: 0,
    widthScale: 1,
    depthBias: 0,
    widthBias: 0,
    minDepth: 28,
    maxDepthOffset: 0,
    minWidthBoost: 0,
  };

  for (const bias of biases) {
    if (!bias) continue;
    aggregate.targetAspectDelta += num(bias.targetAspectDelta, 0);
    aggregate.widthScale *= num(bias.widthScale, 1);
    aggregate.depthBias += num(bias.depthBias, 0);
    aggregate.widthBias += num(bias.widthBias, 0);
    aggregate.minDepth = Math.max(aggregate.minDepth, num(bias.minDepth, aggregate.minDepth));
    aggregate.maxDepthOffset += num(bias.maxDepthOffset, 0);
    aggregate.minWidthBoost += num(bias.minWidthBoost, 0);
  }

  return aggregate;
}

function spreadAround(base, deltas) {
  return uniqueNumbers(deltas.map((delta) => num(base) + num(delta)));
}

function buildCandidateFootprintsV2(brief, interpretation) {
  const stories = Math.max(1, num(brief?.stories, interpretation?.stories || 1));
  const hasGarage = Boolean(brief?.hasGarage);
  const garageType = String(brief?.garageType || '').toUpperCase();
  const hasTwoCarGarage = garageType === 'TWO_CAR';
  const shape = String(brief?.shape || 'RECTANGULAR').toUpperCase();
  const lotContext = String(brief?.lotContext || 'SUBURBAN').toUpperCase();
  const bedrooms = Math.max(1, num(brief?.bedrooms, interpretation?.bedrooms || 1));
  const targetPerLevel = num(brief?.footprintAreaSqFtTarget || brief?.totalAreaSqFt) / stories;
  const targetWidth = Math.sqrt(Math.max(1, targetPerLevel) * (stories === 2 ? 1.55 : 1.35));
  const targetDepth = Math.max(24, targetPerLevel / Math.max(1, targetWidth));
  const shapeBias = resolveShapeBias(shape, stories);
  const lotContextBias = resolveLotContextBias(lotContext, stories);
  const combinedBias = combineBiases(shapeBias, lotContextBias);
  const options = [];
  const variationProfiles = listVariationProfiles(brief, interpretation);
  const socialFeatureBand = brief.garageType === 'ONE_CAR' && brief.shape === 'RECTANGULAR' &&
    isSocialFeaturePair((brief.requestedFeatureItems || []).map(item => item.canonicalType));

  if (shape === 'SQUARE') {
    // Preserve the requested footprint exactly; never label a wide/deep
    // rectangle as square merely to find an accepted layout.
    for (const variation of variationProfiles) {
      for (const side of spreadAround(Math.sqrt(targetPerLevel), [-4, -2, 0, 2, 4])) {
        options.push(buildFootprint(side, side, brief, variation));
      }
    }
  } else if (stories === 2 && num(interpretation?.primaryLevel, 2) === 1) {
    // The main-floor suite (patterns/twoStoryMainPrimary): the ground floor
    // fills the footprint and the upper floor either stops beyond the stair
    // (a storey and a half) or covers it, so each footprint is sized for the
    // extent that brings the whole house nearest the target.
    const { upperExtentAreas, upperExtentsFor, garageStrip } = require('./patterns/twoStoryMainPrimary');
    const target = num(brief.footprintAreaSqFtTarget || brief.totalAreaSqFt);
    const extents = upperExtentsFor({ bedrooms: bedrooms - 1, baths: 1, laundry: false });
    const fitsShape = (w, h) => shape === 'WIDE' ? w >= h * 1.2 : shape === 'DEEP' ? h >= w : true;
    const strip = garageStrip(brief);
    const sized = [];
    for (const variation of variationProfiles) {
      // Deeper than 42 ft the suite and the rooms over the garden grow long.
      for (let depth = 34; depth <= 42; depth += 2) for (let width = 40 + strip; width <= 70 + strip; width += 2) {
        const areas = upperExtentAreas(width - strip, depth);
        const delta = Math.min(...extents.map((extent) => Math.abs(width * depth + areas[extent] - target)));
        if (delta <= target * 0.06) sized.push({ ...buildFootprint(width, depth, brief, variation), mainFloorAreaDeltaSqFt: delta });
      }
    }
    options.push(...(sized.some((f) => fitsShape(f.widthFt, f.heightFt)) ? sized.filter((f) => fitsShape(f.widthFt, f.heightFt)) : sized));
  } else if (stories === 2) {
    const compactTwoBed = !hasGarage && bedrooms === 2 && num(brief.totalAreaSqFt) <= 1600;
    const depthSeed = hasGarage
      ? [28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48]
      : [28, 30, 32, 34, 36, 38, 40, 42, 44, 46];
    const minWidth = (hasTwoCarGarage
      ? 44
      : (bedrooms >= 4 ? 42 : (hasGarage ? 34 : 28))) + num(combinedBias.minWidthBoost, 0);
    const maxWidth = 120;

    for (const variation of variationProfiles) {
      const profile = variation?.twoStory || {};
      const depthOffsets = Array.isArray(profile.depthOffsets) ? profile.depthOffsets : [-4, -2, 0, 2, 4];
      const widthsOffsets = Array.isArray(profile.widthOffsets) ? profile.widthOffsets : [-8, -6, -4, -2, 0, 2, 4, 6, 8];
      const profileTargetDepth = targetDepth + num(profile.depthBias, 0) + num(combinedBias.depthBias, 0);
      const compactMaxDepth = socialFeatureBand ? 38 : (hasTwoCarGarage ? 34 : 32) + num(combinedBias.maxDepthOffset, 0);
      const maxDepth = socialFeatureBand ? 38 : Math.max(compactMaxDepth, Math.min(60, evenFt(Math.sqrt(targetPerLevel))));
      const minDepth = socialFeatureBand ? 34 : compactTwoBed ? 26 : Math.max(24, num(combinedBias.minDepth, 28));
      const depths = uniqueNumbers([...(compactTwoBed ? [26] : []), ...depthSeed, ...spreadAround(profileTargetDepth, depthOffsets)])
        // Lower-floor cores are now inherited exactly upstairs. Deeper search
        // is still bounded and must pass the same fitted-flight validators.
        .filter((depth) => withinBand(depth, minDepth, maxDepth));

      for (const depth of depths) {
        const baseWidth = evenFt(((targetPerLevel / Math.max(1, depth)) * num(profile.widthScale, 1) * num(combinedBias.widthScale, 1)) + num(combinedBias.widthBias, 0));
        // Gross envelope area includes garage/upper void allowances. This
        // bounded search allowance is not the finished-area acceptance gate.
        const minimumWidthFitsArea = hasTwoCarGarage && Math.abs(minWidth * depth - targetPerLevel) <= targetPerLevel * 0.12;
        for (const width of uniqueNumbers([...spreadAround(baseWidth, widthsOffsets), ...(minimumWidthFitsArea ? [minWidth] : [])])) {
          if (!withinBand(width, minWidth, maxWidth)) continue;
          const shapeProfile = buildShapeProfile(shape, width, depth, variation?.id);
          options.push({ ...buildFootprint(width, depth, brief, variation, shapeProfile), expandedDepthSearch: depth > compactMaxDepth });
        }
      }
    }
  } else {
    const depthSeed = hasGarage
      ? [32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60]
      : [30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60];
    const compactGarage = hasGarage && bedrooms <= 3 && num(brief.totalAreaSqFt) <= 1800;
    const minWidth = (compactGarage ? (hasTwoCarGarage ? (bedrooms === 3 ? 48 : 44) : (bedrooms === 3 ? 42 : 38)) : (
      hasTwoCarGarage
        ? (bedrooms >= 5 ? 68 : bedrooms >= 4 ? 62 : bedrooms >= 3 ? 52 : 46)
        : (hasGarage ? (bedrooms >= 5 ? 58 : bedrooms >= 4 ? 54 : bedrooms >= 3 ? 46 : 40) : (bedrooms >= 5 ? (num(brief.totalAreaSqFt)<2800 ? 38 : 52) : bedrooms >= 4 && num(brief.totalAreaSqFt) >= 2200 ? 46 : bedrooms >= 3 ? 38
          // A cottage's two columns start at 24 ft (oneStoryCottage: one
          // bedroom, or two with one bathroom up to 1,500 sq ft). Narrower
          // footprints would only crowd other families' search budget.
          : (bedrooms === 1 || (Number(brief.bathrooms) === 1 && num(brief.totalAreaSqFt) <= 1500)) ? 24 : 30))
    )) + num(combinedBias.minWidthBoost, 0);
    const maxWidth = 130;

    // Phase 3.3: iterate over all variation profiles for one-story too
    for (const variation of variationProfiles) {
      const profile = variation?.oneStory || {};
      const depthOffsets = Array.isArray(profile.depthOffsets) ? profile.depthOffsets : [-6, -4, -2, 0, 2, 4, 6];
      const widthsOffsets = Array.isArray(profile.widthOffsets) ? profile.widthOffsets : [-8, -6, -4, -2, 0, 2, 4, 6, 8];
      const profileTargetDepth = targetDepth + num(profile.depthBias, 0) + num(combinedBias.depthBias, 0);
      const depths = uniqueNumbers([...depthSeed, ...spreadAround(profileTargetDepth, depthOffsets)])
        .filter((depth) => withinBand(depth, Math.max(num(combinedBias.minDepth, hasGarage ? 30 : 28),
          !hasGarage && bedrooms === 5 && num(brief.totalAreaSqFt)<2800 ? 50 : compactGarage ? 40 : hasGarage && [3,4].includes(bedrooms) ? 44 : hasGarage && bedrooms === 2 ? 40 : hasGarage ? 30 : 28), 60 + num(combinedBias.maxDepthOffset, 0)));

      for (const depth of depths) {
        const baseWidth = evenFt(((targetPerLevel / Math.max(1, depth)) * num(profile.widthScale, 1) * num(combinedBias.widthScale, 1)) + num(combinedBias.widthBias, 0));
        // A narrower profile must still try the family's minimum usable
        // width instead of disappearing from the search entirely.
        const publicSpine = !hasGarage && bedrooms <= 3 &&
          (bedrooms === 3 || Number(brief.bathrooms) > 2 || brief.primaryEnsuiteRequested === false);
        const usableWidth = publicSpine ? Math.max(38, minWidth) : minWidth;
        const minimumWidthFitsArea = (hasGarage || publicSpine) && Math.abs(usableWidth * depth - targetPerLevel) <= targetPerLevel * 0.08;
        for (const width of uniqueNumbers([...spreadAround(baseWidth, widthsOffsets), ...(minimumWidthFitsArea ? [usableWidth] : [])])) {
          if (!withinBand(width, minWidth, maxWidth)) continue;
          const shapeProfile = buildShapeProfile(shape, width, depth, variation?.id);
          options.push(buildFootprint(width, depth, brief, variation, shapeProfile));
        }
      }
    }
  }

  // Filter candidates that exceed lot dimensions when provided
  const lotWidth = brief?.lotWidth ? Math.max(20, num(brief.lotWidth)) : null;
  const lotDepth = brief?.lotDepth ? Math.max(20, num(brief.lotDepth)) : null;
  const lotFiltered = (lotWidth || lotDepth)
    ? options.filter((fp) => {
      const rotated = ['east','west'].includes(String(brief.frontFacing).toLowerCase());
      if (lotWidth && num(rotated ? fp.heightFt : fp.widthFt) > lotWidth) return false;
      if (lotDepth && num(rotated ? fp.widthFt : fp.heightFt) > lotDepth) return false;
      return true;
    })
    : options;
  // Lot limits are requirements. Never silently draw a house outside them.
  const candidates = lotFiltered;

  return dedupeFootprints(candidates)
    // Keep candidate search bounded: closest area/ratio candidates first.
    .sort((a, b) => {
      // Preserve the proven compact search before trying deeper reservations.
      if (Boolean(a.expandedDepthSearch) !== Boolean(b.expandedDepthSearch)) return a.expandedDepthSearch ? 1 : -1;
      if (a.mainFloorAreaDeltaSqFt !== undefined && a.mainFloorAreaDeltaSqFt !== b.mainFloorAreaDeltaSqFt) return a.mainFloorAreaDeltaSqFt - b.mainFloorAreaDeltaSqFt;
      const aDelta = Math.abs(num(a.levelAreaSqFtActual) - targetPerLevel);
      const bDelta = Math.abs(num(b.levelAreaSqFtActual) - targetPerLevel);
      if (aDelta !== bDelta) return aDelta - bDelta;
      const aProfile = variationProfiles.find((profile) => profile.id === a.variationId);
      const aTargetAspect = stories === 2
        ? num(aProfile?.twoStory?.targetAspect, 1.55)
        : num(aProfile?.oneStory?.targetAspect, 1.35);
      const bProfile = variationProfiles.find((profile) => profile.id === b.variationId);
      const bTargetAspect = stories === 2
        ? num(bProfile?.twoStory?.targetAspect, 1.55)
        : num(bProfile?.oneStory?.targetAspect, 1.35);
      const aAspect = Math.abs(num(a.aspectRatio) - (aTargetAspect + num(combinedBias.targetAspectDelta, 0)));
      const bAspect = Math.abs(num(b.aspectRatio) - (bTargetAspect + num(combinedBias.targetAspectDelta, 0)));
      return aAspect - bAspect;
    })
    .filter((candidate, index, sorted) => {
      // Give every layout family a search budget. A single close-area profile
      // must not crowd the other two out before geometry is even attempted.
      return sorted.slice(0, index).filter(other => other.variationId === candidate.variationId && Boolean(other.expandedDepthSearch) === Boolean(candidate.expandedDepthSearch)).length < (stories === 2 ? 18 : 16);
    });
}

module.exports = {
  buildCandidateFootprintsV2,
};
