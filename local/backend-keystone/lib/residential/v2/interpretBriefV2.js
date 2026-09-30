'use strict';

const { compileSurveyIntent } = require('./surveyIntentCompiler');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function declaredBathroomCount(brief) {
  const raw = String(brief?.raw?.bathrooms || '').trim();
  const match = raw.match(/\d+/);
  if (match) return Math.max(1, num(match[0], 1));
  return Math.max(1, num(brief?.bathrooms, 1));
}

function parseRequestedPrivateBathBedrooms(brief) {
  if (brief?.privateBathCount != null) return brief.privateBathCount;
  const raw = String(brief?.raw?.privateBaths ?? '').trim();
  const rawMatch = raw.match(/\d+/);
  const rawCount = rawMatch ? parseInt(rawMatch[0], 10) : null;
  const rawConfigs = Array.isArray(brief?.raw?.bedroomConfigs) ? brief.raw.bedroomConfigs : null;
  if (rawConfigs && rawConfigs.length) {
    const explicit = rawConfigs.filter((cfg) => cfg?.privateBath === true || String(cfg?.privateBath || '').trim().toLowerCase() === 'yes').length;
    return explicit;
  }

  return Number.isFinite(rawCount) ? rawCount : 1;
}

function interpretBriefV2(brief, support) {
  // Phase 1.2: compile structured intent from the brief
  const intent = compileSurveyIntent(brief);

  // Keep explicit bathroom intent; unsupported topology is a search/support
  // diagnostic, never permission to change the requested bathroom program.
  const bedrooms = Math.max(1, num(brief?.bedrooms, 1));
  const bathrooms = declaredBathroomCount(brief);
  const stories = Math.max(1, num(brief?.stories, 1));
  const requestedPrivateBathBedrooms = parseRequestedPrivateBathBedrooms(brief);
  const primaryEnsuiteCount = brief.primaryEnsuiteRequested === false ? 0 : Math.min(1, requestedPrivateBathBedrooms);
  const secondaryPrivateBathCount = Math.max(0, requestedPrivateBathBedrooms - primaryEnsuiteCount);
  const sharedBathCount = Math.max(0, bathrooms - requestedPrivateBathBedrooms);

  return {
    generatorId: 'architect_v2',
    supportTier: support?.supportTier || 'wave1',
    housePattern: support?.housePattern || null,
    stories,
    bedrooms,
    bathrooms,
    primaryLevel: Math.max(1, num(brief?.primaryLevel, stories === 1 ? 1 : 2)),
    publicCoreType: brief?.openConcept ? 'integrated_open_core' : 'connected_public_core',
    privacyGradient: stories === 2 ? 'public_down_private_up' : 'front_public_back_private',
    servicePolicy: brief?.hasGarage ? 'compact_garage_service_cluster' : 'compact_service_cluster',
    daylightIntent: brief?.naturalLight || 'BALANCED',
    orientationIntent: String(brief?.frontFacing || 'South').toUpperCase(),
    kitchenIntent: brief?.kitchenRear ? 'rear_anchor' : 'front_anchor',
    bathPlan: {
      requestedPrivateBathBedrooms,
      primaryEnsuiteCount,
      secondaryPrivateBathCount,
      sharedBathCount,
      requiresPowder: false,
    },

    // Phase 1.2: new fields from intent compiler
    intent,
    accessibilityPolicy: intent.accessibilityIntent,
    materialPolicy: intent.materialIntent,
    budgetPolicy: intent.budgetIntent,
    featurePolicy: intent.featureIntent,
  };
}

module.exports = {
  interpretBriefV2,
};
