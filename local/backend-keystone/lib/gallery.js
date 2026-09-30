// lib/gallery.js
// Persistent gallery backed by Google Cloud Storage.
// Stores the last 10 generated plans as a single JSON blob in a GCS bucket.
// Survives Cloud Run restarts and instance recycling.
//
// Required env var: GCS_BUCKET_NAME  (e.g. "keystone_gallery")
// On Cloud Run: uses the service account automatically — no key file needed.
// Local dev:    set GOOGLE_APPLICATION_CREDENTIALS to a service account key JSON.

const { Storage } = require('@google-cloud/storage');

const MAX_ENTRIES  = 10;
const GALLERY_BLOB = 'gallery.json';  // single file stored in the bucket

const bucketName = process.env.GCS_BUCKET_NAME;
if (!bucketName) {
  console.warn('[gallery] GCS_BUCKET_NAME not set — falling back to in-memory only');
}

const storage = bucketName ? new Storage() : null;
const bucket  = storage ? storage.bucket(bucketName) : null;

// In-memory cache — GCS is only hit on cold-start load and on each write
let cache = null;  // null = not yet loaded from GCS

// ─── internal helpers ────────────────────────────────────────────────────────

async function loadFromGCS() {
  if (!bucket) return [];
  try {
    const file = bucket.file(GALLERY_BLOB);
    const [exists] = await file.exists();
    if (!exists) return [];
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf8'));
  } catch (err) {
    console.error('[gallery] GCS load error:', err.message);
    return [];
  }
}

async function saveToGCS(entries) {
  if (!bucket) return;
  try {
    const file = bucket.file(GALLERY_BLOB);
    await file.save(JSON.stringify(entries), {
      contentType: 'application/json',
      resumable: false,
    });
  } catch (err) {
    console.error('[gallery] GCS save error:', err.message);
  }
}

async function getCache() {
  if (cache === null) {
    cache = await loadFromGCS();
  }
  return cache;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function makeLabel(surveyData, planSpec) {
  const beds    = surveyData?.bedrooms  || '?';
  const baths   = surveyData?.bathrooms || '?';
  const sqft    = planSpec?.totalAreaSqFt ? `${planSpec.totalAreaSqFt.toLocaleString()} sqft` : '';
  const stories = planSpec?.stories || surveyData?.stories || '';
  return [beds, baths, sqft, stories].filter(Boolean).join(' · ');
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Add a new plan to the gallery. Returns the new entry id. */
async function addPlan(surveyData, planSpec, svg) {
  const entry = {
    id:          makeId(),
    createdAt:   Date.now(),
    surveyData,
    planSpec,
    svg,
    renderImage: null,
    label:       makeLabel(surveyData, planSpec),
  };

  const entries = await getCache();
  entries.unshift(entry);                              // newest first
  if (entries.length > MAX_ENTRIES) entries.splice(MAX_ENTRIES);
  cache = entries;

  saveToGCS(entries).catch(() => {});                 // fire-and-forget, never blocks response

  return entry.id;
}

/** Attach a 3D render image (base64 data-URI) to an existing gallery entry. */
async function attachRender(id, imageDataUri) {
  const entries = await getCache();
  const entry   = entries.find(e => e.id === id);
  if (entry) {
    entry.renderImage = imageDataUri;
    cache = entries;
    saveToGCS(entries).catch(() => {});               // fire-and-forget
  }
}

/** Return the full gallery array, safe for JSON serialisation. */
async function getGallery() {
  const entries = await getCache();
  return entries.map(e => ({
    id:          e.id,
    createdAt:   e.createdAt,
    label:       e.label,
    // surveyData and planSpec stay server-side: they hold other visitors'
    // locations and free-text wishes, and the gallery is public.
    summary: {
      areaSqFt:   Number(e.planSpec?.totalAreaSqFt) || null,
      stories:    String(e.surveyData?.stories || ''),
      garage:     String(e.surveyData?.garage || ''),
      budgetTier: String(e.surveyData?.budgetTier || ''),
    },
    svg:         e.svg,
    renderImage: e.renderImage,
  }));
}

module.exports = { addPlan, attachRender, getGallery };
