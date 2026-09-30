'use strict';

function renderedPlanDefs() {
  return `
  <linearGradient id="ksRender_linen" x2="0.8" y2="1"><stop stop-color="#faf8f0"/><stop offset=".55" stop-color="#d4cec0"/><stop offset="1" stop-color="#a9a396"/></linearGradient>
  <linearGradient id="ksRender_ceramic" x2="1" y2="1"><stop stop-color="#ffffff"/><stop offset=".7" stop-color="#e5e8e4"/><stop offset="1" stop-color="#aab6b5"/></linearGradient>
  <linearGradient id="ksRender_timber" x2="0" y2="1"><stop stop-color="#a48765"/><stop offset="1" stop-color="#72573f"/></linearGradient>
  <pattern id="ksRender_wood" patternUnits="userSpaceOnUse" width="96" height="24">
    <rect width="96" height="24" fill="#c7b59b"/>
    <path d="M0 0H96V8H0Z M32 16H96V24H32Z" fill="#d2c2a9"/>
    <path d="M0 8H96V16H0Z" fill="#bbab95"/>
    <path d="M0 8H96M0 16H96M0 24H96M32 0V8M70 8V16M20 16V24" stroke="#897860" stroke-opacity=".36" stroke-width=".6"/>
    <path d="M2 3Q28 1 54 4T94 3M2 12Q30 9 57 12T94 11M2 20Q26 23 61 20T94 21" fill="none" stroke="#7f6c53" stroke-opacity=".18" stroke-width=".45"/>
  </pattern>
  <pattern id="ksRender_tile" patternUnits="userSpaceOnUse" width="24" height="24"><rect width="24" height="24" fill="#c1c6c2"/><path d="M0 24V0H24" fill="none" stroke="#f0f0e8" stroke-width="1"/><path d="M3 6L18 17M6 3L22 19" stroke="#89948f" stroke-opacity=".12"/></pattern>
  <pattern id="ksRender_concrete" patternUnits="userSpaceOnUse" width="36" height="36"><rect width="36" height="36" fill="#bdc0ba"/><path d="M0 36V0H36" fill="none" stroke="#8f958e" stroke-opacity=".35"/><circle cx="9" cy="11" r=".8" fill="#989f97"/><circle cx="28" cy="26" r=".5" fill="#e1e2d9"/></pattern>
  <pattern id="ksRender_carpet" patternUnits="userSpaceOnUse" width="4" height="4"><rect width="4" height="4" fill="#cec6b8"/><path d="M0 1H4M1 0V4" stroke="#eee9de" stroke-opacity=".35" stroke-width=".6"/></pattern>
  <filter id="ksRender_wallShadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="3" dy="5" stdDeviation="3" flood-color="#252b2b" flood-opacity=".42"/><feDropShadow dx=".7" dy="1" stdDeviation=".6" flood-color="#34342c" flood-opacity=".4"/></filter>
  <filter id="ksRender_furnitureShadow" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="1.4" dy="2" stdDeviation="1.2" flood-color="#302a22" flood-opacity=".3"/></filter>
  <style>.rendered-labels text { paint-order:stroke; stroke:#f6f2e8; stroke-width:2.5px; stroke-linejoin:round; fill:#343c3d; } .rendered-plan .dl { fill:#e7e8e2; } .rendered-plan .opening-profile-annotation { display:none; }</style>`;
}

function renderedFloorFill(room, finishSpec = {}) {
  const type = String(room.type || '');
  const flooring = finishSpec.interiorFinishes?.flooring || {};
  let material = flooring.public?.material || 'wood';
  if (/bath|powder|laundry|mudroom/.test(type)) material = flooring.wet?.material || 'tile';
  else if (/bedroom/.test(type)) material = flooring.bedroom?.material || 'wood';
  else if (type === 'garage') material = flooring.garage?.material || 'concrete';
  const family = /tile|stone/.test(material) ? 'tile' : /concrete/.test(material) ? 'concrete' : /carpet/.test(material) ? 'carpet' : 'wood';
  return `url(#ksRender_${family})`;
}

function styleFurniture(svg, item) {
  const kind = String(item.kind || '');
  const finish = /bed|sofa|chair/.test(kind) ? 'linen' : /table|desk|dresser|bookcase|bench|console/.test(kind) ? 'timber' : 'ceramic';
  return `<g class="rendered-furniture" filter="url(#ksRender_furnitureShadow)">${svg
    .replaceAll('rgba(255,255,255,0.28)', `url(#ksRender_${finish})`)
    .replaceAll('#8D8C88', '#79766d')
    .replace(/(<(?:rect|ellipse)\b[^>]*?)fill="none"/g, '$1fill="url(#ksRender_ceramic)"')}</g>`;
}

module.exports = { renderedPlanDefs, renderedFloorFill, styleFurniture };
