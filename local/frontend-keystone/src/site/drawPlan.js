import { cropToDrawing, finishSequence, playSequence, prefersReducedMotion, prepareSequence } from '../lib/planSequence.js';
import { safeSvg } from '../lib/safeSvg.js';

/* Mount an engine plan into a .sheet element and play the draw sequence.
   Returns a cancel function that leaves the drawing finished. */
export async function drawPlan(sheet, url, { scope, label, speed = 3, crop = true, onDone } = {}) {
    sheet._cancel?.();
    sheet._cancel = null;
    const surface = sheet.querySelector('.surface');
    const text = await fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); });
    surface.innerHTML = safeSvg(text, scope || url);
    const svg = surface.querySelector('svg');
    if (!svg) return () => {};
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    if (label) svg.setAttribute('aria-label', label);
    sheet.style.setProperty('--sheet-bg', svg.querySelector('rect')?.getAttribute('fill') || '#FFFFFF');
    const { beats } = prepareSequence(svg);
    if (crop) cropToDrawing(svg);
    if (prefersReducedMotion()) { finishSequence(svg, beats); onDone?.(); return () => {}; }
    sheet.classList.add('seq-dark');
    void svg.getBoundingClientRect();
    const cancel = playSequence(svg, beats, {
        speed,
        onReveal: () => sheet.classList.remove('seq-dark'),
        onDone,
    });
    sheet._cancel = () => { cancel(); sheet.classList.remove('seq-dark'); };
    return sheet._cancel;
}
