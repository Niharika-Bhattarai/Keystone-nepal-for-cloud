/* The Studio's edit mode, the parts that are plain geometry.
 *
 * The server (POST /api/plan/edit) owns the plan: it applies each hand edit,
 * redraws the plan and returns where each floor sits in the drawing
 * (`layout`), the walls that can be dragged (`wallRuns`), areas and findings.
 * While a wall is being dragged the browser only previews it: each run lists
 * exactly which room edges move, so the preview needs no geometry of its own.
 */

export const SNAP_FT = 0.5;

/** 12.5 -> "12′ 6″", 12 -> "12′" */
export function formatFeet(ft) {
    const sign = ft < 0 ? '−' : '';
    const abs = Math.abs(ft);
    const whole = Math.floor(abs + 1e-6);
    const inches = Math.round((abs - whole) * 12);
    if (inches === 12) return `${sign}${whole + 1}′`;
    return inches ? `${sign}${whole}′ ${inches}″` : `${sign}${whole}′`;
}

export const formatArea = (n) => `${Math.round(n).toLocaleString('en-US')} sq ft`;

/** A drawing floor's transform: plan feet to drawing units. */
export function levelTransform(layout, level) {
    const l = layout?.levels?.find((x) => Number(x.level) === Number(level));
    if (!l) return null;
    return {
        x: (ft) => l.originX + ft * l.pxPerFt,
        y: (ft) => l.originY + ft * l.pxPerFt,
        len: (ft) => ft * l.pxPerFt,
        toFt: (units) => units / l.pxPerFt,
        // A point in the drawing back to plan feet.
        ftX: (units) => (units - l.originX) / l.pxPerFt,
        ftY: (units) => (units - l.originY) / l.pxPerFt,
    };
}

/** Snap a dragged distance to six inches, within what the run allows. */
export function snapDelta(rawFt, run) {
    const snapped = Math.round(rawFt / SNAP_FT) * SNAP_FT;
    return Math.min(run.maxDelta, Math.max(run.minDelta, snapped));
}

/** The rectangles of a room: its parts, or the room itself. */
export function roomCells(room) {
    return Array.isArray(room?.parts) && room.parts.length ? room.parts : [room];
}

/** Where each moving rectangle would be if the run moved by `delta`. */
export function previewCells(planSpec, run, delta) {
    const level = planSpec?.levels?.find((l) => (Number(l.level) || 1) === run.level);
    if (!level) return [];
    return run.moves.map((m) => {
        const room = level.rooms.find((r) => String(r.id) === m.roomId);
        if (!room) return null;
        const c = m.part === null || m.part === undefined ? room : room.parts[m.part];
        const cell = { roomId: m.roomId, label: room.label || room.type, edge: m.edge, x: c.x, y: c.y, w: c.w, h: c.h };
        if (m.edge === 'left') { cell.x += delta; cell.w -= delta; }
        else if (m.edge === 'right') cell.w += delta;
        else if (m.edge === 'top') { cell.y += delta; cell.h -= delta; }
        else cell.h += delta;
        return cell;
    }).filter(Boolean);
}

/** The movable wall run carrying each side of a room, if any. */
export function roomSides(wallRuns, roomId) {
    const sides = { left: null, right: null, top: null, bottom: null };
    for (const run of wallRuns || []) {
        if (!run.movable) continue;
        for (const m of run.moves) if (m.roomId === String(roomId) && !sides[m.edge]) sides[m.edge] = run;
    }
    return sides;
}

/**
 * The edit for a quick action on a room: grow or shrink it by `ft` across
 * ('wide') or front to back ('deep'), moving whichever of its two walls on
 * that axis can move. Returns null when neither can.
 */
export function quickResize(wallRuns, roomId, axis, ft) {
    const sides = roomSides(wallRuns, roomId);
    const [far, near] = axis === 'wide' ? ['right', 'left'] : ['bottom', 'top'];
    for (const side of [far, near]) {
        const run = sides[side];
        if (!run) continue;
        // Growing moves the far wall out (+) or the near wall out (−).
        const delta = (side === far ? 1 : -1) * ft;
        if (delta >= run.minDelta - 1e-6 && delta <= run.maxDelta + 1e-6) return { op: 'moveWall', runId: run.id, delta };
    }
    return null;
}

const EPS = 1e-6;
const cellsOf = (room) => roomCells(room).map((p) => ({ x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }));

/**
 * The stretches of line two rooms share, each { axis, at, from, to }: axis
 * 'x' is a vertical line x = at, 'y' a horizontal one (as lib/openEdges.js).
 */
export function sharedSegments(a, b) {
    const out = [];
    for (const p of cellsOf(a)) {
        for (const q of cellsOf(b)) {
            // p's right side on q's left, or q's right side on p's left.
            for (const [at, touching] of [[p.x + p.w, Math.abs(p.x + p.w - q.x) < EPS], [p.x, Math.abs(q.x + q.w - p.x) < EPS]]) {
                const from = Math.max(p.y, q.y), to = Math.min(p.y + p.h, q.y + q.h);
                if (touching && to - from > EPS) out.push({ axis: 'x', at, from, to });
            }
            for (const [at, touching] of [[p.y + p.h, Math.abs(p.y + p.h - q.y) < EPS], [p.y, Math.abs(q.y + q.h - p.y) < EPS]]) {
                const from = Math.max(p.x, q.x), to = Math.min(p.x + p.w, q.x + q.w);
                if (touching && to - from > EPS) out.push({ axis: 'y', at, from, to });
            }
        }
    }
    return out;
}

export const sharedLength = (a, b) => sharedSegments(a, b).reduce((s, seg) => s + seg.to - seg.from, 0);

const LOCKED = new Set(['stairs', 'garage']);
/** Whether two rooms can be opened into each other or merged. */
export const canJoin = (a, b) => Boolean(a && b) && a !== b && !LOCKED.has(a.type) && !LOCKED.has(b.type) && sharedLength(a, b) >= 2 - EPS;

const areaOf = (room) => cellsOf(room).reduce((s, c) => s + c.w * c.h, 0);
/** Which room keeps its name when two merge (as the server decides). */
export function keeperOf(a, b) {
    const rank = (r) => (r.type === 'primary_bedroom' ? 2 : r.type === 'primary_bathroom' ? 1 : 0);
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    return areaOf(b) > areaOf(a) + EPS ? b : a;
}

// An open-plan house draws no wall between these rooms (renderPlanSvg).
const OPEN_PLAN_TYPES = new Set(['kitchen', 'dining_room', 'living_room', 'hallway']);
/** Whether two rooms are open to each other because the plan is open-plan. */
export const openPlanPair = (planSpec, a, b) => Boolean(planSpec?.openConcept) && OPEN_PLAN_TYPES.has(a?.type) && OPEN_PLAN_TYPES.has(b?.type);

export const pairKey = (a, b) => (String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`);

/** The level's openings, as pairKey strings. */
export function openPairs(level) {
    return new Set((level?.openEdges || []).filter((e) => e && e.a != null && e.b != null).map((e) => pairKey(e.a, e.b)));
}

/**
 * The sections of a wall run, one per pair of rooms it divides: { a, b,
 * from, to }, `a` before the line (left or above) and `b` after it.
 */
export function runSections(run, level) {
    const rooms = new Map((level?.rooms || []).map((r) => [String(r.id), r]));
    const sides = { before: [], after: [] };
    for (const m of run.moves) {
        const room = rooms.get(m.roomId);
        if (!room) continue;
        const c = m.part === null || m.part === undefined ? room : room.parts[m.part];
        const [lo, hi] = run.axis === 'x' ? [c.y, c.y + c.h] : [c.x, c.x + c.w];
        (m.edge === 'right' || m.edge === 'bottom' ? sides.before : sides.after).push({ room, lo, hi });
    }
    const out = new Map();
    for (const p of sides.before) {
        for (const q of sides.after) {
            if (p.room === q.room) continue;
            const from = Math.max(p.lo, q.lo), to = Math.min(p.hi, q.hi);
            if (to - from <= EPS) continue;
            const key = pairKey(p.room.id, q.room.id);
            const prev = out.get(key);
            out.set(key, prev ? { ...prev, from: Math.min(prev.from, from), to: Math.max(prev.to, to) } : { a: p.room, b: q.room, from, to });
        }
    }
    return [...out.values()].sort((m, n) => m.from - n.from);
}

/* Furniture, as lib/pinnedFurniture.js groups it: a kitchen run and a dining
   set move as one; a bed takes the nightstands beside it, a desk its chair. */
export function groupKeyOf(item) {
    if (item?.assemblyId) return `a:${item.assemblyId}`;
    if (/^(dining_table|chair_\d+)$/.test(String(item?.kind))) return `d:${item.roomId}`;
    return `i:${item?.id}`;
}
const COMPANIONS = [[/^bed_/, /^nightstand$/], [/^desk$/, /^desk_chair$/]];
const touching = (a, b, gap = 0.5) => a.x <= b.x + b.w + gap && b.x <= a.x + a.w + gap && a.y <= b.y + b.h + gap && b.y <= a.y + a.h + gap;

/** The pieces that move when `item` moves: its group and its companions. */
export function membersOf(furniture, item) {
    const list = furniture || [];
    const group = list.filter((f) => groupKeyOf(f) === groupKeyOf(item));
    const rule = COMPANIONS.find(([lead]) => lead.test(String(item.kind)));
    if (!rule) return group;
    return [...group, ...list.filter((f) => !group.includes(f) && String(f.roomId) === String(item.roomId) &&
        rule[1].test(String(f.kind)) && touching(f, item))];
}

export function boxOf(items) {
    const x = Math.min(...items.map((i) => Number(i.x))), y = Math.min(...items.map((i) => Number(i.y)));
    return { x, y, w: Math.max(...items.map((i) => Number(i.x) + Number(i.w))) - x, h: Math.max(...items.map((i) => Number(i.y) + Number(i.h))) - y };
}

/** The room on a level under a point (plan feet). */
export function roomAt(level, x, y) {
    return (level?.rooms || []).find((room) => cellsOf(room).some((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h)) || null;
}

const PIECE_NAMES = {
    bed_king: 'King bed', bed_queen: 'Queen bed', bed_full: 'Full bed', bed_twin: 'Twin bed', nightstand: 'Nightstand',
    dresser: 'Dresser', sofa: 'Sofa', coffee_table: 'Coffee table', console: 'Console', dining_table: 'Dining table',
    counter: 'Kitchen counter', stove: 'Range', refrigerator: 'Fridge', kitchen_island: 'Island', washer: 'Washer',
    dryer: 'Dryer', stacked_washer_dryer: 'Stacked washer and dryer', laundry_counter: 'Laundry counter', shower: 'Shower',
    tub: 'Bathtub', toilet: 'Toilet', vanity: 'Vanity', desk: 'Desk', desk_chair: 'Desk chair', bookcase: 'Bookcase',
    bench: 'Bench', car: 'Car', closet_storage: 'Closet rod', play_mat: 'Play mat', toy_storage: 'Toy storage',
    exercise_mat: 'Exercise mat', outdoor_table: 'Outdoor table', outdoor_chair: 'Outdoor chair',
};
export function pieceName(kind) {
    const k = String(kind || '');
    if (PIECE_NAMES[k]) return PIECE_NAMES[k];
    if (/^chair_\d+$/.test(k)) return 'Chair';
    const text = k.replace(/_/g, ' ');
    return text ? text[0].toUpperCase() + text.slice(1) : 'Piece';
}
/** "Dining table and chairs", "Queen bed and nightstands", "Sofa". */
export function groupName(items) {
    const kinds = items.map((i) => String(i.kind));
    if (kinds.includes('dining_table') && items.length > 1) return 'Dining table and chairs';
    if (items.some((i) => i.assemblyId) && kinds.includes('counter')) return 'Kitchen counter';
    const lead = pieceName(kinds[0]);
    if (/^bed_/.test(kinds[0]) && kinds.includes('nightstand')) return `${lead} and nightstands`;
    if (kinds[0] === 'desk' && kinds.includes('desk_chair')) return 'Desk and chair';
    return lead;
}

// Where a piece may stand (as lib/planEdit/furnitureOps.js).
const PLACES = [
    { kinds: /^(toilet|shower|tub|vanity)$/, rooms: ['bathroom', 'primary_bathroom', 'powder_room'], where: 'in a bathroom' },
    { kinds: /^(counter|stove|refrigerator)$/, rooms: ['kitchen'], where: 'in the kitchen' },
    { kinds: /^(washer|dryer|stacked_washer_dryer|laundry_counter)$/, rooms: ['laundry', 'mudroom', 'garage'], where: 'in the laundry, mudroom or garage' },
    { kinds: /^closet_storage$/, rooms: ['closet'], where: 'in a closet' },
    { kinds: /^car$/, rooms: ['garage'], where: 'in the garage' },
];
/** Why `items` cannot stand in `room`, or null when they can. */
export function placementProblem(items, room) {
    const name = groupName(items).toLowerCase();
    if (!room) return `Keep the ${name} inside the house.`;
    if (room.type === 'stairs') return `The ${name} cannot stand on the stair.`;
    for (const rule of PLACES) {
        if (items.some((i) => rule.kinds.test(String(i.kind))) && !rule.rooms.includes(room.type)) return `The ${name} stays ${rule.where}.`;
    }
    return null;
}

/** Sort findings: blocking first, then warnings, then notes. */
export function sortIssues(issues) {
    const rank = { block: 0, warn: 1, info: 2 };
    return [...(issues || [])].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
}

/** The room a finding is about, for its heading. */
export function issueTitle(issue, rooms) {
    const room = rooms?.find((r) => String(r.id) === String(issue.roomId));
    const name = room?.label || 'This room';
    switch (issue.code) {
        case 'room_small': return `${name} is now very small`;
        case 'room_narrow': return `${name} is now very narrow`;
        case 'room_slender': return `${name} is now long and slender`;
        case 'kitchen_narrow': return 'The kitchen is now narrow';
        case 'bath_narrow': return `${name} is now narrow`;
        case 'hall_narrow': return `${name} is now narrow`;
        case 'garage_small': return 'The garage is now small';
        case 'no_escape_window': return `${name} has no outside wall`;
        case 'furniture_missing': return `Furniture no longer fits in ${name}`;
        case 'furniture_blocks_door': return `A door is blocked in ${name}`;
        case 'furniture_overlap': return `Furniture overlaps in ${name}`;
        case 'furniture_dropped': return `A piece was taken out of ${name}`;
        case 'furniture_absent': return `${name} is missing a piece`;
        case 'unreachable': return `${name} can no longer be reached`;
        case 'ensuite_cut': return `${name} is cut off from its bedroom`;
        case 'ensuite_shared': return `${name} is no longer private`;
        case 'stair_access': return 'The stair has no landing';
        case 'bedroom_count': return `${issue.measured} of ${issue.needed} bedrooms`;
        case 'bath_count': return `${issue.measured} of ${issue.needed} ${issue.piece === 'powder' ? 'powder rooms' : 'full bathrooms'}`;
        case 'open_wall_beam': return 'The floor above may need a beam';
        default: return name;
    }
}
