'use strict';

/**
 * Validates variation profile objects and profile sets for diversity.
 */

function validateProfile(profile) {
  const violations = [];

  if (!profile || typeof profile !== 'object') {
    return { valid: false, violations: ['profile must be a non-null object'] };
  }

  // id
  if (typeof profile.id !== 'string' || profile.id.length === 0) {
    violations.push('id must be a non-empty string');
  } else if (!profile.id.startsWith('variant_')) {
    violations.push(`id must start with 'variant_', got '${profile.id}'`);
  }

  // label
  if (typeof profile.label !== 'string' || profile.label.length === 0) {
    violations.push('label must be a non-empty string');
  }

  // theme
  if (typeof profile.theme !== 'string' || profile.theme.length === 0) {
    violations.push('theme must be a non-empty string');
  }

  // twoStory (optional but validated if present)
  if (profile.twoStory !== undefined && profile.twoStory !== null) {
    const ts = profile.twoStory;
    const tsPrefix = 'twoStory';

    if (typeof ts !== 'object') {
      violations.push(`${tsPrefix} must be an object`);
    } else {
      // targetAspect
      if (typeof ts.targetAspect !== 'number' || ts.targetAspect <= 0) {
        violations.push(`${tsPrefix}.targetAspect must be a positive number`);
      }

      // widthScale
      if (typeof ts.widthScale !== 'number' || ts.widthScale <= 0) {
        violations.push(`${tsPrefix}.widthScale must be a positive number`);
      }

      // depthOffsets
      if (!Array.isArray(ts.depthOffsets)) {
        violations.push(`${tsPrefix}.depthOffsets must be an array`);
      } else if (ts.depthOffsets.some((v) => typeof v !== 'number')) {
        violations.push(`${tsPrefix}.depthOffsets must contain only numbers`);
      }

      // widthOffsets
      if (!Array.isArray(ts.widthOffsets)) {
        violations.push(`${tsPrefix}.widthOffsets must be an array`);
      } else if (ts.widthOffsets.some((v) => typeof v !== 'number')) {
        violations.push(`${tsPrefix}.widthOffsets must contain only numbers`);
      }

      // upperCore
      if (!ts.upperCore || typeof ts.upperCore !== 'object') {
        violations.push(`${tsPrefix}.upperCore must be a non-null object`);
      } else {
        const uc = ts.upperCore;
        const ucPrefix = `${tsPrefix}.upperCore`;

        // leftWingWidth: positive, 8-24 range
        if (typeof uc.leftWingWidth !== 'number' || uc.leftWingWidth <= 0) {
          violations.push(`${ucPrefix}.leftWingWidth must be a positive number`);
        } else if (uc.leftWingWidth < 8 || uc.leftWingWidth > 24) {
          violations.push(`${ucPrefix}.leftWingWidth must be in range 8-24, got ${uc.leftWingWidth}`);
        }

        // landingDepth: positive, 4-12 range
        if (typeof uc.landingDepth !== 'number' || uc.landingDepth <= 0) {
          violations.push(`${ucPrefix}.landingDepth must be a positive number`);
        } else if (uc.landingDepth < 4 || uc.landingDepth > 12) {
          violations.push(`${ucPrefix}.landingDepth must be in range 4-12, got ${uc.landingDepth}`);
        }

        // landingWidth: positive, 6-16 range
        if (typeof uc.landingWidth !== 'number' || uc.landingWidth <= 0) {
          violations.push(`${ucPrefix}.landingWidth must be a positive number`);
        } else if (uc.landingWidth < 6 || uc.landingWidth > 16) {
          violations.push(`${ucPrefix}.landingWidth must be in range 6-16, got ${uc.landingWidth}`);
        }

        // stairRunBias: number, -2 to 2 range
        if (typeof uc.stairRunBias !== 'number') {
          violations.push(`${ucPrefix}.stairRunBias must be a number`);
        } else if (uc.stairRunBias < -2 || uc.stairRunBias > 2) {
          violations.push(`${ucPrefix}.stairRunBias must be in range -2 to 2, got ${uc.stairRunBias}`);
        }
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

function validateProfileSet(profiles) {
  const violations = [];

  if (!Array.isArray(profiles) || profiles.length === 0) {
    return { valid: false, violations: ['profiles must be a non-empty array'] };
  }

  // Validate each individual profile
  for (let i = 0; i < profiles.length; i++) {
    const result = validateProfile(profiles[i]);
    for (const v of result.violations) {
      violations.push(`profiles[${i}]: ${v}`);
    }
  }

  // Diversity check: at least 2 profiles must differ in targetAspect >= 0.1
  // OR differ in leftWingWidth >= 2
  if (profiles.length >= 2) {
    let hasDiversity = false;

    for (let i = 0; i < profiles.length && !hasDiversity; i++) {
      for (let j = i + 1; j < profiles.length && !hasDiversity; j++) {
        const a = profiles[i];
        const b = profiles[j];

        const aTs = a?.twoStory;
        const bTs = b?.twoStory;

        if (aTs && bTs) {
          const aspectDiff = Math.abs((aTs.targetAspect || 0) - (bTs.targetAspect || 0));
          if (aspectDiff >= 0.1) {
            hasDiversity = true;
            break;
          }

          const aLww = aTs.upperCore?.leftWingWidth || 0;
          const bLww = bTs.upperCore?.leftWingWidth || 0;
          if (Math.abs(aLww - bLww) >= 2) {
            hasDiversity = true;
            break;
          }
        }
      }
    }

    if (!hasDiversity) {
      violations.push(
        'profile set lacks diversity: at least 2 profiles must differ in targetAspect by >= 0.1 or leftWingWidth by >= 2'
      );
    }
  }

  return { valid: violations.length === 0, violations };
}

module.exports = { validateProfile, validateProfileSet };
