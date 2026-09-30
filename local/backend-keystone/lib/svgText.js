'use strict';

// Escape a value for use as SVG/XML text or a double-quoted attribute.
// Plan labels can come from a client-supplied planSpec (refine, /api/plan/svg),
// and rendered sheets are injected into pages as markup, so every string that
// reaches an SVG template must pass through here.
function escXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { escXml };
