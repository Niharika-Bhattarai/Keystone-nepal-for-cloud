'use strict';
/**
 * WCAG contrast gate for the Keystone token system.
 *
 *   node scripts/check-contrast.js
 *
 * The system is monochrome plus exactly one signal colour on white paper,
 * with two exceptions this file exists to police:
 *
 * 1. The capabilities block is the single dark surface on the marketing
 *    pages. The signal colour (#AD3300) is tuned for white and manages
 *    only 3.4:1 there, so that block substitutes the studio's brighter
 *    ember. Changing either colour has to be checked on BOTH grounds.
 *
 * 2. Borders are not all the same. WCAG 1.4.11 requires 3:1 for the
 *    boundary of a UI *control* when that boundary is what identifies it
 *    as a control. A structural hairline between rows is not a control
 *    boundary and is not held to 3:1. Two tokens, only one of them gated.
 *
 * An earlier version modelled glass panels composited over a four-field
 * aurora wash. Both are gone; elevation is now rules and space.
 */

const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

let failures = 0;

function check(label, fgHex, bgRgb, threshold) {
  const r = ratio(hex(fgHex), bgRgb);
  const pass = r >= threshold;
  if (!pass) failures++;
  console.log(
    `  ${pass ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (need ${threshold})  ${label}  [${fgHex} on ${toHex(bgRgb)}]`
  );
}

/** Reported for information. Structural, not a control boundary. */
function note(label, fgHex, bgRgb) {
  const r = ratio(hex(fgHex), bgRgb);
  console.log(`  ....  ${r.toFixed(2).padStart(5)}:1  (not gated)  ${label}  [${fgHex} on ${toHex(bgRgb)}]`);
}

// ============================================================== MARKETING

const PAPER = hex('#FFFFFF');
const BAND = hex('#F4F4F1');
const BLACKTOP = hex('#121212');

console.log('\nPAPER - text on the page');
check('ink', '#0B0B0B', PAPER, 4.5);
check('graphite (ink-soft)', '#4A4A4A', PAPER, 4.5);
check('signal (accent)', '#AD3300', PAPER, 4.5);
check('signal pressed', '#8C2900', PAPER, 4.5);

console.log('\nBAND - the one recessed tone, full-bleed only');
check('ink on band', '#0B0B0B', BAND, 4.5);
check('graphite on band', '#4A4A4A', BAND, 4.5);
check('signal on band', '#AD3300', BAND, 4.5);

console.log('\nCONTROLS (gated at 3:1 per 1.4.11)');
check('control boundary', '#8A8A85', PAPER, 3);
check('focus ring', '#AD3300', PAPER, 3);
check('paper on signal (button fill)', '#FFFFFF', hex('#AD3300'), 4.5);

console.log('\nSTRUCTURE (not gated)');
note('hairline rule', '#DEDEDA', PAPER);

console.log('\nBLACKTOP - the capabilities block');
check('white', '#FFFFFF', BLACKTOP, 4.5);
check('body grey', '#B9B9B4', BLACKTOP, 4.5);
check('accent-on-dark', '#FF7A45', BLACKTOP, 4.5);
note('signal would be, hence the substitution', '#AD3300', BLACKTOP);

// ================================================================= STUDIO

const INK_BASE = hex('#0E1117');
const WHITE = [255, 255, 255];
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
const DARK_GLASS = over(WHITE, 0.07, INK_BASE);

console.log('\nSTUDIO - text on base');
/* These are the values src/styles/tokens.css actually ships. They drifted
   once already: the gate went on testing #9AA3AE and #FF7A45 after
   --d-muted and --d-accent had been lifted to #A7B0BB and #FF9468, so it
   was reporting on colours the studio no longer used. */
check('paper (--d-text)', '#F2EFE9', INK_BASE, 4.5);
check('muted (--d-muted)', '#A7B0BB', INK_BASE, 4.5);
check('accent (--d-accent)', '#FF9468', INK_BASE, 4.5);

console.log('\nSTUDIO - text on a raised panel');
check('paper (--d-text)', '#F2EFE9', DARK_GLASS, 4.5);
check('muted (--d-muted)', '#A7B0BB', DARK_GLASS, 4.5);
check('accent (--d-accent)', '#FF9468', DARK_GLASS, 4.5);

console.log('\nSTUDIO - controls (gated at 3:1)');
check('input / button border', '#6A7482', INK_BASE, 3);
check('input / button border on panel', '#6A7482', DARK_GLASS, 3);
check('focus ring', '#FF7A45', INK_BASE, 3);
/* --d-accent is lightened so the accent clears 4.5:1 as TEXT. A fill has
   no such constraint, so filled controls use --d-accent-fill, the same
   ember as the hero button. Both the ink on it and its own edge - which
   is what identifies the control - are gated. */
check('ink on accent fill (--d-accent-fill)', '#1A0D06', hex('#FF7A45'), 4.5);
check('accent fill edge on base', '#FF7A45', INK_BASE, 3);
check('accent fill edge on panel', '#FF7A45', DARK_GLASS, 3);

console.log(`\n${failures === 0 ? 'ALL GATED PAIRS PASS' : failures + ' FAILURES'}\n`);
process.exitCode = failures ? 1 : 0;
