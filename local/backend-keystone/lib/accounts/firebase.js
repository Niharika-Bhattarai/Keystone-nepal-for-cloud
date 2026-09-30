'use strict';

// firebase-admin, initialised once. On Cloud Run the default service account
// is used; locally set GOOGLE_APPLICATION_CREDENTIALS. The project comes from
// FIREBASE_PROJECT_ID, else the GCP project.

let instance = null;

function app() {
  if (instance) return instance;
  const admin = require('firebase-admin/app');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  instance = admin.getApps()[0] || admin.initializeApp(projectId ? { projectId } : {});
  return instance;
}

module.exports = { app };
