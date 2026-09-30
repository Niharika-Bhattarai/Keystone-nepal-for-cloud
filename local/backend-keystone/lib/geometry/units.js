'use strict';

/* Units and tolerances for the finished-face geometry (execution plan P04).
 *
 * The rest of the engine works in feet on a 2 ft planning grid, and rooms are
 * nominal rectangles whose edges are shared boundaries with no thickness. That
 * is fine for allocating space and wrong for any claim about clear width: a
 * "36 inch stair" or a "wide doorway" measured between zero-thickness lines is
 * not a measurement of anything a person could walk through.
 *
 * Everything here is feet. Inches appear only at the boundary, because wall
 * assemblies and code minimums are quoted in inches and converting them by
 * hand at each call site is how 3.5 in studs become 3.5 ft walls.
 */

const INCHES_PER_FOOT = 12;

const inches = (value) => Number(value) / INCHES_PER_FOOT;
const toInches = (feetValue) => Number(feetValue) * INCHES_PER_FOOT;

/* Coordinates are produced by repeated addition on a 2 ft grid, so exact
 * equality is unreliable once offsets are applied. One sixteenth of an inch is
 * finer than anything the drawings represent and far coarser than float noise. */
const EPSILON_FT = inches(1 / 16);

const nearlyEqual = (a, b, epsilon = EPSILON_FT) => Math.abs(Number(a) - Number(b)) <= epsilon;
const nearlyZero = (value, epsilon = EPSILON_FT) => Math.abs(Number(value)) <= epsilon;

/* Assembly thicknesses, nominal stud plus finishes both faces.
 *
 * These are conventional light-frame residential assemblies, not a project
 * specification. They exist so the model reserves a plausible physical
 * thickness instead of zero; a real project replaces them with its own
 * catalogue before any structural verification can be claimed. */
const WALL_ASSEMBLIES = Object.freeze({
  // 2x6 stud, sheathing, cladding, one layer inside.
  exterior: Object.freeze({ id: 'exterior', thicknessFt: inches(7.25), description: '2x6 exterior wall with sheathing and cladding' }),
  // 2x4 stud, one layer of gypsum each face.
  interior: Object.freeze({ id: 'interior', thicknessFt: inches(4.5), description: '2x4 partition, gypsum both faces' }),
  // 2x6 stud to take drainage and vent pipe.
  plumbing: Object.freeze({ id: 'plumbing', thicknessFt: inches(6.5), description: '2x6 plumbing wall, gypsum both faces' }),
  // A geometric allowance only. Thickness does not establish a fire rating.
  garage: Object.freeze({ id: 'garage', thicknessFt: inches(5.5), description: 'assumed garage separation thickness; rated assembly unspecified' }),
});

/* Room types whose walls are expected to carry drainage. A bathroom against a
 * bathroom still only needs one wall, and it is the thicker of the two. */
const PLUMBING_ROOM_TYPES = Object.freeze(new Set([
  'bathroom', 'primary_bathroom', 'powder_room', 'ensuite', 'kitchen', 'laundry', 'utility',
]));

const GARAGE_ROOM_TYPES = Object.freeze(new Set(['garage']));

const roundFt = (value, places = 4) => {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
};

module.exports = {
  INCHES_PER_FOOT,
  EPSILON_FT,
  WALL_ASSEMBLIES,
  PLUMBING_ROOM_TYPES,
  GARAGE_ROOM_TYPES,
  inches,
  toInches,
  nearlyEqual,
  nearlyZero,
  roundFt,
};
