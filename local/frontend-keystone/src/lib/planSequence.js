/* The draw sequence.
 *
 * One implementation, used by the landing hero and by the studio, so a
 * generated plan arrives the same way in both places: white line-work
 * assembling on black, then the colour blooming in once the drawing is
 * finished.
 *
 * Two things about the engine's SVG shape this design.
 *
 * 1. It already emits semantic layers - `exterior-outline`,
 *    `rendered-walls`, `rendered-labels`, `stair-*` - and the outline and
 *    wall layers are genuinely stroked `<line>` elements, so they can be
 *    drawn with stroke-dashoffset rather than faded in. Nothing else can:
 *    floors and furniture are fills.
 * 2. It emits no room identity on furniture and no grouping per storey.
 *    Zone comes from `data-zone`, stamped by scripts/build-demo-plans.js
 *    for the baked hero plans and derived here from the room labels for
 *    live studio output. Storey is derived from geometry: the sheets sit
 *    side by side, so a vertical split separates them.
 *
 * Visibility is driven by inline style rather than a ladder of CSS
 * classes, because the beat list is built per plan - a bungalow has no
 * stairs and no second storey - and enumerated `.s1...sN` rules cannot
 * follow a list whose length changes.
 */

const BATH = /BATH|POWDER|\bWC\b|ENSUITE|EN-SUITE/i;
const BED = /BEDROOM|NURSERY/i;
const LABEL_SCALE = 1.5;

const centre = (el) => {
    try {
        const b = el.getBBox();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    } catch { return null; }
};

/** Room labels are set with a stroke halo, so the halo grows with the type. */
export function scaleRoomLabels(svg, scale = LABEL_SCALE) {
    svg.querySelectorAll('.rendered-labels text').forEach((t) => {
        let fs = parseFloat(t.getAttribute('font-size'));
        if (!fs || !Number.isFinite(fs)) fs = parseFloat(getComputedStyle(t).fontSize);
        if (!fs || !Number.isFinite(fs)) return;
        t.setAttribute('font-size', (fs * scale).toFixed(2));
        const sw = parseFloat(getComputedStyle(t).strokeWidth);
        if (sw && Number.isFinite(sw)) t.style.strokeWidth = `${(sw * scale).toFixed(2)}px`;
    });
}

/** Where the storeys divide, or null when the plan is single-storey. */
function storeySplit(svg) {
    const labels = [...svg.querySelectorAll('text')]
        .filter((t) => /^LEVEL\s*\d/i.test((t.textContent || '').trim()))
        .map((t) => ({ t, x: parseFloat(t.getAttribute('x')) }))
        .filter((l) => Number.isFinite(l.x))
        .sort((a, b) => a.x - b.x);
    if (labels.length < 2) return null;
    // The label sits at its sheet's left edge, so the divide is just left
    // of the second one.
    return labels[1].x - 40;
}

function zoneOf(el, labels) {
    const c = centre(el);
    if (!c || !labels.length) return 'common';
    let best = null;
    let bestD = Infinity;
    for (const l of labels) {
        const d = (l.x - c.x) ** 2 + (l.y - c.y) ** 2;
        if (d < bestD) { bestD = d; best = l; }
    }
    const name = best ? best.name : '';
    return BATH.test(name) ? 'bath' : BED.test(name) ? 'bed' : 'common';
}

/**
 * Tag every drawable with the beat that reveals it, and return the beat
 * list for this particular plan. Beats that would reveal nothing are
 * dropped, so a bungalow never holds on an empty stairs step.
 */
export function prepareSequence(svg, { scaleLabels = true } = {}) {
    if (scaleLabels) scaleRoomLabels(svg);

    const split = storeySplit(svg);

    /* The engine bakes a slate #535f64 ground into its rendered exports,
       because the studio is a dark table. Inverted for the dark build
       that becomes light grey, not black, so the sheet never actually
       goes dark. It is held at white for the build - which inverts to
       black - and put back at the reveal. */
    const bg = svg.querySelector('rect');
    if (bg) {
        bg.dataset.origFill = bg.getAttribute('fill') || '';
        bg.setAttribute('fill', '#FFFFFF');
    }
    const sideOf = (el) => {
        if (split == null) return 0;
        const c = centre(el);
        return c && c.x >= split ? 1 : 0;
    };

    const roomLabels = [...svg.querySelectorAll('text')]
        .map((t) => {
            const c = centre(t);
            return c ? { name: (t.textContent || '').trim(), ...c } : null;
        })
        .filter((l) => l && /^[A-Z][A-Z0-9 ]{2,24}$/.test(l.name) && !/^LEVEL|^TO L\d/.test(l.name));

    const buckets = new Map();
    /* Tag on the way in, not in a pass afterwards. The `claimed` guard
       below reads data-bucket, so deferring the tag made every guard
       return false: elements landed in several buckets at once and the
       final floors sweep overwrote the earlier ones. Stairs and openings
       simply vanished from the sequence as a result. */
    const put = (key, el) => {
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(el);
        el.dataset.bucket = key;
    };

    // Outer shell and partitions: the only layers that can truly draw.
    svg.querySelectorAll('.exterior-outline').forEach((el) => {
        el.dataset.draw = '1';
        put(`shell${sideOf(el)}`, el);
    });
    svg.querySelectorAll('g.rendered-walls').forEach((g) => {
        // The group's drop-shadow filter would re-run for every frame of
        // every child's draw. It is suspended and restored afterwards.
        g.dataset.filter = g.getAttribute('filter') || '';
        g.removeAttribute('filter');
        g.querySelectorAll('line, path, polyline').forEach((el) => {
            if (el.dataset.draw || el.dataset.bucket) return;
            el.dataset.draw = '1';
            put(`walls${sideOf(el)}`, el);
        });
    });

    const claimed = (el) => el.dataset.bucket || el.closest('[data-bucket]');

    svg.querySelectorAll('.stair-run, .stair-riser, .stair-landing, .stair-arrow, .stair-arrow-head, .stair-arrow-label')
        .forEach((el) => { if (!claimed(el) && !el.dataset.draw) put('stairs', el); });

    svg.querySelectorAll('[stroke],[fill]').forEach((el) => {
        if (claimed(el) || el.dataset.draw) return;
        const paint = (el.getAttribute('stroke') || '') + (el.getAttribute('fill') || '');
        if (/5B7C99|5B9CB3/i.test(paint)) put('openings', el);
    });

    svg.querySelectorAll('g.rendered-furniture').forEach((el) => {
        if (claimed(el)) return;
        const z = el.getAttribute('data-zone') || zoneOf(el, roomLabels);
        put(`furniture-${z}`, el);
    });

    svg.querySelectorAll('text').forEach((el) => {
        if (claimed(el) || el.dataset.draw) return;
        put(el.classList.contains('dl') ? 'dimensions' : 'names', el);
    });
    svg.querySelectorAll('.rendered-labels, .opening-profile-annotation').forEach((el) => {
        if (claimed(el) || el.dataset.draw) return;
        put('names', el);
    });

    // Whatever is left is floor, fill and material. The descendant check
    // matters: staging a parent group hides children that already belong
    // to an earlier beat, which makes the whole drawing appear at once.
    svg.querySelectorAll('rect,path,line,polygon,polyline,circle,ellipse,image,g').forEach((el) => {
        if (el === bg || claimed(el) || el.dataset.draw) return;
        if (el.querySelector('[data-bucket], [data-draw]')) return;
        if (el.tagName.toLowerCase() === 'g' && !el.querySelector('*')) return;
        put(`floors${sideOf(el)}`, el);
    });

    // Draw layers start hidden by dash; everything else by opacity.
    for (const [, els] of buckets) {
        els.forEach((el) => {
            if (el.dataset.draw) {
                let len = 0;
                try { len = el.getTotalLength(); } catch { len = 0; }
                if (!len || !Number.isFinite(len)) len = 1200;
                el.style.setProperty('--len', `${len}px`);
                el.style.strokeDasharray = `${len}px`;
                el.style.strokeDashoffset = `${len}px`;
                const stroke = el.getAttribute('stroke');
                if (stroke) el.style.setProperty('--final-stroke', stroke);
            } else {
                el.style.opacity = '0';
            }
        });
    }

    /* The order. For a two-storey the ground floor is completed and its
       stairs drawn before the upper floor starts, because that is the
       order the building is understood in - you cannot read an upper
       floor without knowing where the stairs land. */
    const order = split == null
        ? ['shell0', 'walls0', 'floors0', 'stairs', 'openings',
           'furniture-common', 'furniture-bed', 'furniture-bath', 'names', 'dimensions']
        : ['shell0', 'walls0', 'floors0', 'stairs', 'shell1', 'walls1', 'floors1', 'openings',
           'furniture-common', 'furniture-bed', 'furniture-bath', 'names', 'dimensions'];

    const MS = {
        shell0: 1400, walls0: 1400, floors0: 1000, stairs: 700,
        shell1: 1100, walls1: 1200, floors1: 900, openings: 700,
        'furniture-common': 750, 'furniture-bed': 650, 'furniture-bath': 650,
        names: 800, dimensions: 650,
    };
    const LABELS = {
        shell0: 'outer walls', walls0: 'internal walls', floors0: 'floors',
        stairs: 'stairs', shell1: 'upper outer walls', walls1: 'upper internal walls',
        floors1: 'upper floors', openings: 'doors and windows',
        'furniture-common': 'common space', 'furniture-bed': 'bedrooms',
        'furniture-bath': 'bathrooms', names: 'room names', dimensions: 'dimensions',
    };

    const beats = order
        .filter((k) => (buckets.get(k) || []).length)
        .map((k) => ({ key: k, ms: MS[k], label: LABELS[k], els: buckets.get(k) }));

    return { beats, twoStorey: split != null };
}

/**
 * Play the prepared sequence. `onReveal` fires when the drawing is
 * complete and the page should return to colour; `onDone` after that.
 * Returns a cancel function that leaves the drawing finished.
 */
export function playSequence(svg, beats, { speed = 2, revealMs = 1100, onReveal, onDone, onBeat } = {}) {
    const timers = [];
    let cancelled = false;

    const finishAll = () => {
        beats.forEach((b) => b.els.forEach(show));
        restoreWallFilters(svg);
        restoreBackground(svg);
    };

    const show = (el) => {
        if (el.dataset.draw) el.style.strokeDashoffset = '0px';
        else el.style.opacity = '1';
    };

    let t = 0;
    beats.forEach((beat, i) => {
        const ms = beat.ms / speed;
        timers.push(setTimeout(() => {
            if (cancelled) return;
            onBeat?.(i, beat);
            beat.els.forEach((el, n) => {
                // Staggering the partitions is what makes them read as
                // drafting rather than one shape expanding.
                if (el.dataset.draw && beat.els.length > 4) {
                    el.style.transitionDelay = `${Math.min(n * 14, 900) / speed}ms`;
                }
                show(el);
            });
        }, t));
        t += ms;
    });

    timers.push(setTimeout(() => { if (!cancelled) restoreWallFilters(svg); }, t));
    timers.push(setTimeout(() => {
        if (cancelled) return;
        restoreBackground(svg);
        onReveal?.();
    }, t));
    timers.push(setTimeout(() => { if (!cancelled) onDone?.(); }, t + revealMs / speed));

    return () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        finishAll();
    };
}

/** Put the engine's own ground back once the drawing is in colour. */
export function restoreBackground(svg) {
    const bg = svg.querySelector('rect');
    if (bg && bg.dataset.origFill) bg.setAttribute('fill', bg.dataset.origFill);
}

export function restoreWallFilters(svg) {
    svg.querySelectorAll('g.rendered-walls').forEach((g) => {
        if (g.dataset.filter) g.setAttribute('filter', g.dataset.filter);
    });
}

/** Land straight on the finished drawing. */
export function finishSequence(svg, beats) {
    beats.forEach((b) => b.els.forEach((el) => {
        if (el.dataset.draw) el.style.strokeDashoffset = '0px';
        else el.style.opacity = '1';
    }));
    restoreWallFilters(svg);
    restoreBackground(svg);
}

export const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Show exactly the first `count` beats and hide the rest. Unlike
 * playSequence this is reversible, so scroll position can drive it in
 * both directions. The ground and wall shadows come back only when the
 * whole drawing is showing.
 */
export function scrubSequence(svg, beats, count) {
    const k = Math.max(0, Math.min(beats.length, count));
    beats.forEach((beat, i) => beat.els.forEach((el) => {
        if (el.dataset.draw) {
            el.style.transitionDelay = '0ms';
            el.style.strokeDashoffset = i < k ? '0px' : (el.style.getPropertyValue('--len') || '1200px');
        } else {
            el.style.opacity = i < k ? '1' : '0';
        }
    }));
    if (k >= beats.length) {
        restoreWallFilters(svg);
        restoreBackground(svg);
    } else {
        const bg = svg.querySelector('rect');
        if (bg) bg.setAttribute('fill', '#FFFFFF');
        svg.querySelectorAll('g.rendered-walls').forEach((g) => g.removeAttribute('filter'));
    }
}

/**
 * Trim the engine's sheet margins so the drawing fills its frame. The
 * ground rect is left out of the measurement. Returns the new aspect
 * ratio, or null when the SVG cannot be measured (not in the document).
 */
export function cropToDrawing(svg, padRatio = 0.02) {
    try {
        const bg = svg.querySelector('rect');
        const prev = bg ? bg.style.display : '';
        if (bg) bg.style.display = 'none';
        const b = svg.getBBox();
        if (bg) bg.style.display = prev;
        if (!(b.width > 10 && b.height > 10)) return null;
        const pad = Math.max(b.width, b.height) * padRatio;
        const w = b.width + pad * 2;
        const h = b.height + pad * 2;
        svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${w} ${h}`);
        return w / h;
    } catch {
        return null;
    }
}
