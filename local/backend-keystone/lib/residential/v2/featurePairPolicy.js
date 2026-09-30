'use strict';

function isSocialFeaturePair(types) {
  return types.length === 2 && types.includes('gaming_room') && types.includes('playroom');
}

// A measured concept-layout family, not a claim of universal physical feasibility.
function supportsSocialFeaturePair({ featureTypes, featureCount = featureTypes.length,
  stories, bedrooms, bathrooms, primaryLevel, garageType, shape, area }) {
  return featureCount === 2 && isSocialFeaturePair(featureTypes) && stories === 2 &&
    bedrooms === 3 && bathrooms === 3 && primaryLevel === 2 &&
    garageType === 'ONE_CAR' && shape === 'RECTANGULAR' && area >= 3200;
}

module.exports = { isSocialFeaturePair, supportsSocialFeaturePair };
