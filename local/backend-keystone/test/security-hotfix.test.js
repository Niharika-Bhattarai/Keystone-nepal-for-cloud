'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { renderPlanSvg } = require('../lib/renderPlanSvg');
const { escXml } = require('../lib/svgText');
const { sanitizePlanInput } = require('../lib/sanitizePlanInput');
const { rateLimit } = require('../lib/rateLimit');
const { CSP } = require('../lib/securityHeaders');

const level = (label) => ({
  level: 1,
  width: 40,
  height: 30,
  rooms: [
    { id: 'living', type: 'living_room', label, x: 0, y: 0, w: 20, h: 30 },
    { id: 'kitchen', type: 'kitchen', x: 20, y: 0, w: 20, h: 30 },
  ],
  doors: [],
  windows: [],
});

// The payload that executed in a browser before the fix: it closes the
// <text> element and adds an <img> whose handler survives uppercasing.
const PAYLOAD = '</text><img src=x onerror="&#X61;&#X6C;&#X65;&#X72;&#X74;(1)">';

test('escXml escapes markup characters', () => {
  assert.equal(escXml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escXml(null), '');
  assert.equal(escXml(2), '2');
});

test('renderPlanSvg never emits a room label as markup', () => {
  const svg = renderPlanSvg({ stories: 1, levels: [level(PAYLOAD)] });
  assert.ok(!/<img/i.test(svg), 'label produced an <img> element');
  assert.ok(svg.includes('&lt;/TEXT&gt;&lt;IMG'), 'label should appear escaped');
});

test('renderPlanSvg escapes a string level number in the sheet header', () => {
  const lvl = level('Living');
  lvl.level = '<script>x</script>';
  const svg = renderPlanSvg({ stories: 1, levels: [lvl] });
  assert.ok(!svg.includes('<script>'), 'level number was emitted as markup');
});

test('sanitizePlanInput coerces geometry to numbers and strips markup from labels', () => {
  const input = { levels: [{ level: '1', rooms: [{ x: '"><script>', y: '4', w: 10, h: 12, label: PAYLOAD, type: 'kitchen' }] }] };
  const out = sanitizePlanInput(input);
  const room = out.levels[0].rooms[0];
  assert.equal(room.x, 0);
  assert.equal(room.y, 4);
  assert.equal(out.levels[0].level, 1);
  assert.ok(!/[<>"]/.test(room.label));
  assert.equal(room.type, 'kitchen');
  assert.equal(input.levels[0].rooms[0].x, '"><script>', 'input must not be mutated');
});

test('sanitizePlanInput leaves a normal plan unchanged', () => {
  const plan = { stories: 2, levels: [level('Living')] };
  assert.deepEqual(sanitizePlanInput(plan), plan);
});

test('rateLimit answers 429 once the window is used up', () => {
  const limiter = rateLimit({ name: 't', max: 2, windowMs: 60_000 });
  const req = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} };
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json() { return this; } };
    let passed = false;
    limiter(req, res, () => { passed = true; });
    codes.push(passed ? 200 : res.statusCode);
  }
  assert.deepEqual(codes, [200, 200, 429]);
});

test('public gallery entries do not expose survey data or plan specs', async () => {
  const { addPlan, getGallery } = require('../lib/gallery');
  await addPlan({ location: '90210', freeformWishes: 'private note', stories: '2 Stories' }, { totalAreaSqFt: 2400, levels: [] }, '<svg/>');
  const [entry] = await getGallery();
  assert.equal(entry.surveyData, undefined);
  assert.equal(entry.planSpec, undefined);
  assert.equal(entry.summary.areaSqFt, 2400);
  assert.equal(entry.summary.stories, '2 Stories');
  assert.ok(!JSON.stringify(entry).includes('90210'));
});

test('vercel.json passes every path to this service, so its Content-Security-Policy applies', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../../frontend-keystone/vercel.json'), 'utf8'));
  assert.deepEqual(vercel.rewrites.map((r) => r.source), ['/', '/:path*']);
  assert.match(vercel.rewrites[0].destination, /^https:\/\/keystone-preview-[a-z0-9.-]+\.run\.app\/$/);
  assert.match(vercel.rewrites[1].destination, /^https:\/\/keystone-preview-[a-z0-9.-]+\.run\.app\/:path\*$/);
  // A second, diverging policy from Vercel would be enforced as well; there must be none.
  const all = (vercel.headers || []).flatMap((h) => h.headers || []);
  assert.ok(!all.some((h) => h.key === 'Content-Security-Policy'), 'vercel.json must not add its own policy');
  assert.ok(CSP.includes("frame-ancestors 'none'"));
});

test('sanitizePlanInput leaves survey answers and estimate text alone', () => {
  const plan = {
    stories: 2,
    designSurvey: { stories: '2 Stories', bedrooms: '3 Bed' },
    estimate: { costRange: { lineItems: [{ label: 'Site Preparation & Grading' }] } },
    levels: [level('Living & Dining')],
  };
  const out = sanitizePlanInput(plan);
  assert.equal(out.designSurvey.stories, '2 Stories');
  assert.equal(out.estimate.costRange.lineItems[0].label, 'Site Preparation & Grading');
  assert.equal(out.levels[0].rooms[0].label, 'Living & Dining');
});

test('CSP still lets the access-request form reach Google Forms', () => {
  assert.match(CSP, /form-action[^;]*https:\/\/docs\.google\.com/);
  assert.match(CSP, /frame-src[^;]*https:\/\/docs\.google\.com/);
});
