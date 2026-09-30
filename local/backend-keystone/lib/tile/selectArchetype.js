'use strict';

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const ARCHETYPES = {
  compact_single_story: {
    id: 'compact_single_story',
    label: 'Compact Single-Story',
    defaultStories: 1,
    stair: { enabled: false, coreWidthFt: 0, landingSide: 'hall' },
    facade: { glazingBias: 'balanced', entryBias: 'front' },
  },
  suburban_two_story_family: {
    id: 'suburban_two_story_family',
    label: 'Suburban Two-Story Family Home',
    defaultStories: 2,
    stair: { enabled: true, coreWidthFt: 6, landingSide: 'hall' },
    facade: { glazingBias: 'balanced', entryBias: 'front' },
  },
  wide_view_lot_luxury: {
    id: 'wide_view_lot_luxury',
    label: 'Wide View-Lot / Luxury',
    defaultStories: 2,
    stair: { enabled: true, coreWidthFt: 6, landingSide: 'hall' },
    facade: { glazingBias: 'view', entryBias: 'front' },
  },
  urban_infill_deep_lot: {
    id: 'urban_infill_deep_lot',
    label: 'Urban Infill / Deep Lot',
    defaultStories: 2,
    stair: { enabled: true, coreWidthFt: 6, landingSide: 'hall' },
    facade: { glazingBias: 'privacy', entryBias: 'front' },
  },
};

function selectArchetype(brief = {}) {
  const stories = Math.max(1, num(brief.stories, 1));
  const area = Math.max(0, num(brief.totalAreaSqFt, 0));
  const lotContext = String(brief.lotContext || '').toUpperCase();
  const shape = String(brief.shape || '').toUpperCase();
  const budgetTier = String(brief.budgetTier || '').toUpperCase();
  const hasGarage = Boolean(brief.hasGarage);
  const accessibility = brief.accessibility || {};

  let id = 'suburban_two_story_family';

  if (stories <= 1 || accessibility.singleLevel || area <= 1400) {
    id = 'compact_single_story';
  } else if (
    lotContext === 'URBAN' ||
    shape === 'DEEP' ||
    (!hasGarage && area <= 2200 && stories >= 2)
  ) {
    id = 'urban_infill_deep_lot';
  } else if (
    lotContext === 'VIEW' ||
    lotContext === 'WATERFRONT' ||
    budgetTier === 'LUXURY' ||
    shape === 'WIDE' ||
    area >= 3200
  ) {
    id = 'wide_view_lot_luxury';
  }

  const preset = ARCHETYPES[id];
  return {
    ...preset,
    stories,
    lotContext,
    shape,
    budgetTier,
    areaSqFt: area,
  };
}

module.exports = {
  ARCHETYPES,
  selectArchetype,
};
