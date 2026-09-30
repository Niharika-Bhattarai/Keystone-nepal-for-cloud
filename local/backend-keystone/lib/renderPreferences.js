// Shared with the static frontend by scripts/build-frontend.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KeystoneRenderPreferences = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function defaults(survey = {}, plan = {}) {
    const lot = survey.lotContext || 'Suburban standard lot';
    const rural = /rural|acreage/i.test(lot);
    const urban = /\burban\b|tight/i.test(lot);
    const view = /view|waterfront/i.test(lot);
    const style = survey.materials || plan.finishSpec?.styleLabel || 'Craftsman (Wood & Stone)';
    const planFinish = !plan.finishSpec?.styleLabel || plan.finishSpec.styleLabel === style ? plan.finishSpec : null;
    const finishes = /farmhouse/i.test(style) ? ['Board & batten', 'Standing seam metal']
      : /craftsman/i.test(style) ? ['Cedar lap', 'Architectural asphalt']
      : /colonial|traditional/i.test(style) ? ['Brick', 'Architectural asphalt']
      : /mediterranean/i.test(style) ? ['Stucco', 'Clay tile']
      : ['Concrete panel', 'Flat membrane'];
    const result = {
      zipCode: survey.zipCode || (/^\d{5}(?:-\d{4})?$/.test(survey.location || '') ? survey.location : ''),
      lotContext: lot,
      contextDensity: rural ? 'Open rural edge' : urban ? 'Close urban neighbors' : view ? 'View-oriented sparse context' : 'Detached neighboring homes',
      topography: 'Mostly flat site',
      drivewayStyle: /none|no garage/i.test(survey.garage || '') ? 'Minimal hardscape' : rural ? 'Gravel driveway' : 'Concrete driveway',
      landscaping: rural || view ? 'Native plantings' : urban ? 'Minimal / gravel' : 'Foundation plantings + lawn',
      surroundings: /waterfront/i.test(lot) ? 'Ocean or lake waterfront' : rural ? 'Open countryside' : urban ? 'Urban streetscape' : view ? 'Open view corridor' : 'Suburban neighborhood',
      season: 'Summer', timeOfDay: 'Midday', weather: 'Clear sky',
      exteriorSiding: survey.finishOverrides?.exteriorSiding || planFinish?.exterior?.primaryCladding?.label || finishes[0],
      roofMaterial: survey.finishOverrides?.roofMaterial || planFinish?.roofing?.label || finishes[1],
    };
    // Explicit survey selections always beat inferred presentation defaults.
    for (const key of Object.keys(result)) {
      if (typeof survey[key] === 'string' && survey[key].trim()) result[key] = survey[key];
    }
    return result;
  }
  function resolve(survey = {}, saved = {}, plan = {}) {
    const result = defaults(survey || {}, plan || {});
    // v2 saves only intentional edits. Old snapshots contained hardcoded defaults;
    // migrate only values that differ from those defaults.
    const legacy = { zipCode: '', lotContext: '', contextDensity: 'Detached neighboring homes',
      topography: 'Mostly flat site', drivewayStyle: 'Concrete driveway', landscaping: 'Foundation plantings + lawn',
      surroundings: '', season: 'Summer', timeOfDay: 'Midday', weather: 'Clear sky' };
    const edits = saved?.version === 2 ? saved.overrides || {} : saved || {};
    for (const key of Object.keys(result)) {
      if (typeof edits[key] !== 'string') continue;
      if (saved?.version !== 2 && edits[key] === legacy[key]) continue;
      if (key === 'lotContext' && !edits[key]) continue;
      result[key] = edits[key].slice(0, 160);
    }
    return result;
  }
  return { defaults, resolve };
});
