import DOMPurify from 'dompurify';

/* Every engine drawing reaches the page as markup, so each one passes
 * through here before it is injected.
 *
 * 1. Sanitize. Plans can come back from the public gallery, from a restored
 *    session, or from an edit round-trip, and a label in any of them could
 *    carry markup. DOMPurify keeps the SVG and drops scripts, event handlers
 *    and foreign HTML.
 * 2. Scope ids. Every sheet defines the same pattern and filter ids
 *    (ksRender_wood, ksPat_tile, ...). With two sheets on a page, url(#id)
 *    resolves to the first one in the document; if that one is hidden, the
 *    other sheet's floors render blank. Each call site passes its own scope,
 *    so ids stay unique and stable across renders.
 */

const CONFIG = {
    USE_PROFILES: { svg: true, svgFilters: true },
    // Sheets carry a <style> block for their label fonts, and the draw
    // sequence reads class names and data-* attributes.
    ADD_TAGS: ['style', 'use'],
    ADD_ATTR: ['class', 'href', 'xlink:href', 'dominant-baseline', 'text-anchor', 'letter-spacing'],
};

const cache = new Map();
const CACHE_MAX = 40;

const slug = (s) => String(s || 'svg').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'svg';

export function scopeSvgIds(markup, scope) {
    const pre = `${slug(scope)}_`;
    return markup
        .replace(/(\s)id="([^"]+)"/g, (m, sp, id) => `${sp}id="${pre}${id}"`)
        .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${pre}${id})`)
        .replace(/(\s(?:xlink:)?href)="#([^"]+)"/g, (m, attr, id) => `${attr}="#${pre}${id}"`);
}

export function sanitizeSvg(markup) {
    return DOMPurify.sanitize(String(markup || ''), CONFIG);
}

/** Sanitized, id-scoped markup for dangerouslySetInnerHTML / innerHTML. */
export function safeSvg(markup, scope = 'svg') {
    if (!markup) return '';
    const key = `${scope}\u0000${markup.length}\u0000${markup}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const out = scopeSvgIds(sanitizeSvg(markup), scope);
    cache.set(key, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return out;
}
