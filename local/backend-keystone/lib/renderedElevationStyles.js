'use strict';
const { createHash } = require('node:crypto');
const { getElevationStyleProfile, renderElevations } = require('./renderElevationSvg');

// Apply finishes to the elevation drawing, without changing any architectural
// coordinates. The underlying elevation generator remains shared with CAD/3D.
function renderElevationPresentation(svg, finishSpec = {}, surveyData = {}) {
  if (!svg) return svg;
  const style = getElevationStyleProfile(surveyData);
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const width = viewBox[2], height = viewBox[3], ground = height - 62;
  const material = String(finishSpec.exterior?.primaryCladding?.material || '');
  const roofMaterial = String(finishSpec.roofing?.material || '');
  const wallColor = /brick/.test(material) ? '#ac7967' : /cedar|wood/.test(material) ? '#c6b093'
    : /concrete/.test(material) ? '#c9cdca' : /stone/.test(material) ? '#b7b0a0' : '#e8e5db';
  const roofColor = /clay|terracotta/.test(roofMaterial) ? '#a36349' : /metal|slate/.test(roofMaterial) ? '#525e63' : '#6b6860';
  const oldDefs = [];
  let drawing = svg.replace(/<defs>[\s\S]*?<\/defs>/g, block => { oldDefs.push(block.slice(6, -7)); return ''; });
  let patterns = oldDefs.join('')
    .replaceAll(style.bodyFill, wallColor).replaceAll(style.roofFill, roofColor)
    .replaceAll(style.baseFill, '#aaa599');
  if (/stone/.test(material)) {
    patterns = patterns.replace(/<pattern id="clad-primary"[\s\S]*?<\/pattern>/,
      '<pattern id="clad-primary" patternUnits="userSpaceOnUse" width="56" height="28"><rect width="56" height="28" fill="#b7b0a0"/><path d="M0 0H56M0 14H56M0 28H56M22 0V14M44 0V14M10 14V28M37 14V28" stroke="#e0dcd0" stroke-width="1.2"/><path d="M1 2H20V12H1Z M12 16H35V26H12Z" fill="#a29c8e" opacity=".45"/></pattern>');
  }
  drawing = drawing.replace(/<(rect|path)\b[^>]*>/g, tag => {
    const fill = tag.match(/\bfill="([^"]+)"/)?.[1];
    let className = '', effect = '', replacement = null;
    if (fill === 'url(#clad-primary)' || fill === style.bodyFill) {
      className = 'elevation-wall'; effect = ' filter="url(#elevation-wall-shadow)"';
      if (fill === style.bodyFill) replacement = wallColor;
    } else if (fill === 'url(#roof-tex)' || fill === style.roofFill) {
      className = 'elevation-roof'; effect = ' filter="url(#elevation-roof-shadow)"';
      if (fill === style.roofFill) replacement = roofColor;
    } else if (fill === style.windowFill) {
      className = 'elevation-glazing'; replacement = 'url(#elevation-glass)'; effect = ' filter="url(#elevation-recess)"';
    } else if (fill === style.entryFill || fill === '#f5ecdd') {
      className = 'elevation-door'; replacement = fill === style.entryFill ? 'url(#elevation-timber)' : 'url(#elevation-panel)';
      effect = ' filter="url(#elevation-recess)"';
    } else if (fill === style.overlayFill) {
      className = 'elevation-bay-shading'; replacement = 'url(#elevation-wall-light)';
    }
    if (replacement) tag = tag.replace(`fill="${fill}"`, `fill="${replacement}"`);
    return className ? tag.replace(/^<(rect|path)/, `<$1 class="${className}"${effect}`) : tag;
  });
  const defs = `<defs>${patterns}
    <linearGradient id="elevation-sky" x2="0" y2="1"><stop stop-color="#c6d5da"/><stop offset=".8" stop-color="#edf0e9"/><stop offset="1" stop-color="#f2ede1"/></linearGradient>
    <linearGradient id="elevation-glass" x2=".7" y2="1"><stop stop-color="#3e5966"/><stop offset=".43" stop-color="#8ba9b3"/><stop offset=".45" stop-color="#c6d5d6"/><stop offset=".6" stop-color="#728b92"/><stop offset="1" stop-color="#344a53"/></linearGradient>
    <linearGradient id="elevation-wall-light" x2="1" y2=".15"><stop stop-color="#303b40"/><stop offset=".08" stop-color="#fbf9e9"/><stop offset=".8" stop-color="#fbf9e9"/><stop offset="1" stop-color="#526064"/></linearGradient>
    <linearGradient id="elevation-timber" x2="1" y2="0"><stop stop-color="#5f4b38"/><stop offset=".45" stop-color="#9c8262"/><stop offset="1" stop-color="#655340"/></linearGradient>
    <linearGradient id="elevation-panel" x2="0" y2="1"><stop stop-color="#e9e5db"/><stop offset="1" stop-color="#a9aea8"/></linearGradient>
    <filter id="elevation-wall-shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="3" dy="4" stdDeviation="3" flood-color="#36444a" flood-opacity=".22"/></filter>
    <filter id="elevation-roof-shadow" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feDropShadow dx="1" dy="7" stdDeviation="3" flood-color="#2d3739" flood-opacity=".4"/></filter>
    <filter id="elevation-recess" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-color="#263638" flood-opacity=".45"/></filter>
    <filter id="elevation-ground-shadow" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
  </defs>`;
  drawing = drawing.replace('<svg ', '<svg class="rendered-elevation" ')
    .replace(/(<svg[^>]*>)/, `$1${defs}`)
    .replace('<rect width="100%" height="100%" fill="#f8f2e7"/>',
      `<g class="elevation-backdrop"><rect width="100%" height="100%" fill="url(#elevation-sky)"/><rect x="0" y="${ground}" width="${width}" height="62" fill="#d6d8cc"/><ellipse cx="${width / 2}" cy="${ground + 4}" rx="${Math.max(1, width / 2 - 65)}" ry="6" fill="#515f58" opacity=".3" filter="url(#elevation-ground-shadow)"/></g>`);
  // Inline previews show four SVGs together. Namespaced resources prevent their
  // materials and shadows from resolving to definitions in a different drawing.
  const prefix = `ke_${createHash('sha256').update(drawing).digest('hex').slice(0, 12)}_`;
  return drawing.replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`);
}

function renderElevationPresentations(planSpec, surveyData = {}) {
  // Generate canonical vectors from geometry rather than trusting submitted SVG.
  // Keep the existing elevation's architectural family for saved plans. Changing
  // the presentation must not silently replace their roof geometry.
  const drawingSurvey = { ...surveyData, materials: planSpec.elevations?.meta?.styleId || surveyData.materials };
  const elevations = renderElevations(planSpec, drawingSurvey);
  const result = { ...elevations, meta: { ...elevations.meta, presentationStyle: 'rendered' } };
  for (const key of ['frontSvg', 'rearSvg', 'leftSvg', 'rightSvg']) {
    result[key] = renderElevationPresentation(elevations[key], planSpec.finishSpec, drawingSurvey);
  }
  return result;
}

module.exports = { renderElevationPresentation, renderElevationPresentations };
