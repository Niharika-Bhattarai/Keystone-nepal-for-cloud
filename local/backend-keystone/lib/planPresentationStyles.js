'use strict';

// ── planPresentationStyles.js ─────────────────────────────────────────────────
// Shared presentation layer for floor-plan materials and surface treatments.
// Consumed by renderPlanSvg.js (backend SVG) and optionally by the studio preview.
//
// Usage:
//   const { patternIdForRoom, planPresentationDefs, MATERIAL_LEGEND } = require('./planPresentationStyles');
//   const patId = patternIdForRoom('kitchen');  // → 'ksPat_tile'
//   // Embed planPresentationDefs() inside the SVG <defs> block.

const ROOM_MATERIAL = {
  living_room:      'wood',
  dining_room:      'wood',
  primary_bedroom:  'wood',
  bedroom:          'wood',
  guest_bedroom:    'wood',
  study:            'wood',
  library:          'wood',
  loft:             'wood',
  gaming_room:      'wood',
  playroom:         'wood',
  movie_room:       'wood',
  music_room:       'wood',
  wine_cellar:      'wood',
  gym:              'wood',
  office:           'wood',
  kitchen:          'tile',
  bathroom:         'tile',
  primary_bathroom: 'tile',
  powder_room:      'tile',
  laundry:          'tile',
  mudroom:          'tile',
  garage:           'concrete',
  entry:            'stone',
  foyer:            'stone',
  hallway:          'neutral',
  stairs:           'neutral',
  // storage, closet, and unknown types → no pattern (plain fill only)
};

const SVG_PATTERN_ID = {
  wood:     'ksPat_wood',
  tile:     'ksPat_tile',
  concrete: 'ksPat_concrete',
  stone:    'ksPat_stone',
  neutral:  'ksPat_neutral',
};

/**
 * Returns the material type string for a given room type, or null if none.
 * @param {string} type
 * @returns {'wood'|'tile'|'concrete'|'stone'|'neutral'|null}
 */
function materialForRoom(type) {
  return ROOM_MATERIAL[String(type || '').toLowerCase()] || null;
}

/**
 * Returns the SVG pattern id to overlay on a room, or null if the room type
 * has no pattern.
 * @param {string} type
 * @returns {string|null}
 */
function patternIdForRoom(type) {
  const mat = materialForRoom(type);
  return mat ? (SVG_PATTERN_ID[mat] || null) : null;
}

/**
 * Returns the SVG <defs> content (pattern elements only — no wrapping <defs> tag)
 * that must be included once in any SVG that uses these patterns.
 *
 * All patterns use a transparent background so they can be overlaid on top of
 * the existing room fill color without replacing it.
 * @returns {string}
 */
function planPresentationDefs() {
  const wood     = SVG_PATTERN_ID.wood;
  const tile     = SVG_PATTERN_ID.tile;
  const concrete = SVG_PATTERN_ID.concrete;
  const stone    = SVG_PATTERN_ID.stone;
  const neutral  = SVG_PATTERN_ID.neutral;

  return `
    <!-- Wood / Parquet: horizontal plank lines, alternating light/dark seam -->
    <pattern id="${wood}" patternUnits="userSpaceOnUse" width="18" height="9">
      <line x1="0" y1="3" x2="18" y2="3" stroke="rgba(110,65,0,0.10)" stroke-width="0.9"/>
      <line x1="0" y1="6" x2="18" y2="6" stroke="rgba(110,65,0,0.06)" stroke-width="0.6"/>
      <line x1="0" y1="9" x2="18" y2="9" stroke="rgba(110,65,0,0.10)" stroke-width="0.9"/>
      <line x1="9" y1="0" x2="9" y2="3"  stroke="rgba(110,65,0,0.07)" stroke-width="0.6"/>
    </pattern>
    <!-- Tile: square grid lines -->
    <pattern id="${tile}" patternUnits="userSpaceOnUse" width="12" height="12">
      <path d="M12 0L0 0 0 12" fill="none" stroke="rgba(0,0,0,0.11)" stroke-width="0.7"/>
    </pattern>
    <!-- Concrete: faint diagonal hatch -->
    <pattern id="${concrete}" patternUnits="userSpaceOnUse" width="18" height="18" patternTransform="rotate(45)">
      <line x1="0" y1="9" x2="18" y2="9" stroke="rgba(0,0,0,0.07)" stroke-width="0.7"/>
    </pattern>
    <!-- Stone / Entry: offset rectangular block grid -->
    <pattern id="${stone}" patternUnits="userSpaceOnUse" width="20" height="12">
      <line x1="10" y1="0" x2="10" y2="6"  stroke="rgba(0,0,0,0.10)" stroke-width="0.7"/>
      <line x1="0"  y1="6" x2="20" y2="6"  stroke="rgba(0,0,0,0.10)" stroke-width="0.7"/>
      <line x1="5"  y1="6" x2="5"  y2="12" stroke="rgba(0,0,0,0.08)" stroke-width="0.6"/>
      <line x1="15" y1="6" x2="15" y2="12" stroke="rgba(0,0,0,0.08)" stroke-width="0.6"/>
    </pattern>
    <!-- Neutral / Circulation: very faint horizontal stripe -->
    <pattern id="${neutral}" patternUnits="userSpaceOnUse" width="12" height="10">
      <line x1="0" y1="5" x2="12" y2="5" stroke="rgba(0,0,0,0.04)" stroke-width="0.5"/>
    </pattern>
  `;
}

/**
 * Material legend entries for a plan's presentation metadata.
 * Can be attached to planSpec.presentation.materialLegend.
 */
const MATERIAL_LEGEND = [
  { material: 'wood',     label: 'Wood / Parquet',  patternId: SVG_PATTERN_ID.wood },
  { material: 'tile',     label: 'Tile',            patternId: SVG_PATTERN_ID.tile },
  { material: 'concrete', label: 'Concrete',        patternId: SVG_PATTERN_ID.concrete },
  { material: 'stone',    label: 'Stone / Entry',   patternId: SVG_PATTERN_ID.stone },
  { material: 'neutral',  label: 'Neutral',         patternId: SVG_PATTERN_ID.neutral },
];

/**
 * Attach optional, non-breaking presentation metadata to each room in a planSpec.
 * Existing consumers that ignore these fields continue to work unchanged.
 * @param {object} planSpec
 * @returns {object} same planSpec reference (mutated in place)
 */
function attachPresentationMetadata(planSpec) {
  if (!planSpec || !Array.isArray(planSpec.levels)) return planSpec;

  for (const level of planSpec.levels) {
    for (const room of Array.isArray(level?.rooms) ? level.rooms : []) {
      const mat = materialForRoom(room.type);
      if (mat) {
        room.surfaceMaterial = mat;
        room.surfacePattern  = SVG_PATTERN_ID[mat] || null;
      }
    }
  }

  if (!planSpec.presentation) planSpec.presentation = {};
  planSpec.presentation.materialLegend = MATERIAL_LEGEND;
  return planSpec;
}

module.exports = {
  materialForRoom,
  patternIdForRoom,
  planPresentationDefs,
  attachPresentationMetadata,
  MATERIAL_LEGEND,
  SVG_PATTERN_ID,
};
