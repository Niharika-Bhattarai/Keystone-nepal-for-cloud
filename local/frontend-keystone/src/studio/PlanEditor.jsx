import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, X as XIcon } from '@phosphor-icons/react';
import { InteractiveCanvas } from './InteractiveCanvas.jsx';
import { safeSvg } from '../lib/safeSvg.js';
import { boxOf, canJoin, formatArea, formatFeet, groupKeyOf, groupName, issueTitle, keeperOf, levelTransform, membersOf,
    openPairs, openPlanPair, pairKey, placementProblem, previewCells, quickResize, roomAt, roomCells, runSections, sharedSegments,
    snapDelta, sortIssues } from '../lib/planEdit.js';

/* The studio's edit mode. The engine's drawing sits on its paper as usual;
   a light layer drawn in the same coordinates carries what a person can take
   hold of: walls and rooms, or the furniture. Dragging a wall is previewed
   here in drafting dimensions; dragging a piece moves the drawn piece
   itself. Letting go sends one edit to POST /api/plan/edit, which applies
   it, redraws the plan and says what, if anything, it broke. Hand edits are
   never refused for size or area; only what cannot be built is. */

const ROOM_TYPES = [
    ['bedroom', 'Bedroom'], ['study', 'Study'], ['library', 'Library'], ['gym', 'Gym'], ['playroom', 'Playroom'],
    ['living_room', 'Living room'], ['dining_room', 'Dining room'], ['kitchen', 'Kitchen'], ['laundry', 'Laundry'],
    ['mudroom', 'Mudroom'], ['storage', 'Storage'], ['loft', 'Loft'], ['bathroom', 'Bathroom'], ['powder_room', 'Powder room'],
    ['hallway', 'Hall'], ['entry', 'Entry'],
];
const FIXED_TYPES = new Set(['stairs', 'garage', 'primary_bedroom', 'primary_bathroom']);
const KEY_STEP_FT = 0.5;
const PIECE_STEP_FT = 0.25;
const HISTORY = 30;
const PICKING_TEXT = {
    swap: (name) => `Choose the room to swap with ${name}.`,
    open: (name) => `Choose a room next to ${name} to open it to.`,
    merge: (name) => `Choose a room next to ${name} to merge it with.`,
};

function parseDrawing(markup) {
    if (!markup || typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(safeSvg(markup, 'plan-edit'), 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
    return { viewBox: svg.getAttribute('viewBox'), width: Number(svg.getAttribute('width')) || 0,
        height: Number(svg.getAttribute('height')) || 0, inner: svg.innerHTML };
}

const nameOf = (room) => room?.label || String(room?.type || 'Room').replace(/_/g, ' ');
// A room in a sentence: "the kitchen", but "Bedroom 3", which reads as a name.
const called = (room) => (/\d$/.test(nameOf(room)) ? nameOf(room) : `the ${nameOf(room).toLowerCase()}`);
const Called = (room) => { const text = called(room); return text[0].toUpperCase() + text.slice(1); };
const levelNum = (l) => Number(l?.level) || 1;

// A drafting dimension across one room: the line, a slash at each end, the
// length. `unit` is drawing units per screen pixel, so it reads the same at
// any zoom.
function Dimension({ x1, y1, x2, y2, text, unit = 1 }) {
    const horizontal = Math.abs(y2 - y1) < 1e-6;
    const tick = 8 * unit;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return (
        <g className="pe-dim">
            <line x1={x1} y1={y1} x2={x2} y2={y2}/>
            <line x1={x1 - tick / 2} y1={y1 + tick / 2} x2={x1 + tick / 2} y2={y1 - tick / 2}/>
            <line x1={x2 - tick / 2} y1={y2 + tick / 2} x2={x2 + tick / 2} y2={y2 - tick / 2}/>
            <text x={mx} y={horizontal ? my - 7 * unit : my} dx={horizontal ? 0 : 9 * unit} textAnchor={horizontal ? 'middle' : 'start'}
                dominantBaseline={horizontal ? 'auto' : 'middle'} className="mono" style={{ fontSize: 13 * unit, strokeWidth: 4 * unit }}>{text}</text>
        </g>
    );
}

export default function PlanEditor({ planSpec, authFetch, onPlanChange }) {
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState('loading');
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState('');
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [mode, setMode] = useState('rooms');
    const [selected, setSelected] = useState(null);
    const [wallCard, setWallCard] = useState(null);
    const [piece, setPiece] = useState(null);
    const [drag, setDrag] = useState(null);
    const [pieceDrag, setPieceDrag] = useState(null);
    const [picking, setPicking] = useState(null);
    const [popup, setPopup] = useState(null);
    const [popupPos, setPopupPos] = useState(null);
    const [showChecks, setShowChecks] = useState(false);
    const emitted = useRef(null);
    const base = useRef(null);
    const request = useRef(0);
    const svgRef = useRef(null);
    const stageRef = useRef(null);
    const dragRef = useRef(null);
    const pieceRef = useRef(null);
    const press = useRef(null);
    const keyNudge = useRef(null);
    const pieceNudge = useRef(null);

    const post = useCallback(async (plan, ops) => {
        const res = await authFetch('/api/plan/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ planSpec: plan, ops }) });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    }, [authFetch]);

    const toSession = (data) => ({ planSpec: data.planSpec, svg: data.svg, layout: data.layout, wallRuns: data.wallRuns || [],
        areas: data.areas, issues: data.issues || [] });

    // Entering edit mode, or a different plan arriving from outside (another
    // option, a restored project): describe it and start a fresh history.
    useEffect(() => {
        if (!planSpec || planSpec === emitted.current) return;
        const id = ++request.current;
        setStatus('loading'); setLoadError(''); setSelected(null); setPiece(null); setWallCard(null); setPopup(null); setPicking(null);
        post(planSpec, []).then(({ res, data }) => {
            if (id !== request.current) return;
            if (!res.ok || !data.success) {
                setLoadError(res.status === 401 || res.status === 403 ? 'Sign in to edit this plan by hand.' : (data.message || 'This plan could not be opened for editing.'));
                setStatus('error');
                return;
            }
            const next = toSession(data);
            base.current = next;
            setSession(next); setPast([]); setFuture([]); setStatus('ready');
        }).catch(() => { if (id === request.current) { setLoadError('The studio could not reach the server. Check the connection and try again.'); setStatus('error'); } });
    }, [planSpec, post]);

    const show = useCallback((next) => {
        setSession(next);
        emitted.current = next.planSpec;
        onPlanChange?.(next.planSpec, next.svg);
    }, [onPlanChange]);

    // Pieces being dragged move in the drawing itself: each drawn piece is
    // its own <g data-item>, outside React's hands.
    const offsetPieces = useCallback((ids, dxUnits, dyUnits) => {
        const svg = svgRef.current;
        if (!svg) return;
        for (const id of ids) {
            for (const el of svg.querySelectorAll(`[data-item="${CSS.escape(String(id))}"]`)) {
                if (dxUnits || dyUnits) el.setAttribute('transform', `translate(${dxUnits} ${dyUnits})`);
                else el.removeAttribute('transform');
            }
        }
    }, []);

    const commit = useCallback(async (ops, after) => {
        if (!session || status === 'saving') return false;
        const id = ++request.current;
        setStatus('saving'); setNotice(''); setPopup(null);
        // A moved piece stays where it was dropped until the new drawing
        // replaces it; a refused move, or a drawing that did not change,
        // puts it back.
        let redrawn = false;
        try {
            const { res, data } = await post(session.planSpec, ops);
            if (id !== request.current) return false;
            if (!res.ok || !data.success) {
                setNotice(data.message || 'That edit could not be applied. The plan is unchanged.');
                setStatus('ready');
                return false;
            }
            redrawn = data.svg !== session.svg;
            setPast((p) => [...p.slice(-(HISTORY - 1)), session]);
            setFuture([]);
            show(toSession(data));
            after?.();
            const warnings = (data.newIssues || []).filter((i) => i.severity === 'warn');
            if (warnings.length) setPopup({ issues: warnings, roomId: warnings.find((i) => i.roomId)?.roomId || null });
            setStatus('ready');
            return true;
        } catch {
            if (id === request.current) { setNotice('The studio could not reach the server. The plan is unchanged; try the edit again.'); setStatus('ready'); }
            return false;
        } finally {
            if (id === request.current) {
                setDrag(null);
                if (pieceRef.current && !redrawn) offsetPieces(pieceRef.current.ids, 0, 0);
                pieceRef.current = null;
                setPieceDrag(null);
            }
        }
    }, [session, status, post, show, offsetPieces]);

    const undo = useCallback(() => {
        if (!past.length || status === 'saving') return;
        setFuture((f) => [session, ...f]);
        setPast((p) => p.slice(0, -1));
        show(past[past.length - 1]);
        setPopup(null); setNotice(''); setWallCard(null);
    }, [past, session, status, show]);

    const redo = useCallback(() => {
        if (!future.length || status === 'saving') return;
        setPast((p) => [...p, session]);
        setFuture((f) => f.slice(1));
        show(future[0]);
        setPopup(null); setNotice(''); setWallCard(null);
    }, [future, session, status, show]);

    const undoAll = useCallback(() => {
        if (!base.current || session === base.current || status === 'saving') return;
        setPast((p) => [...p.slice(-(HISTORY - 1)), session]);
        setFuture([]);
        show(base.current);
        setPopup(null); setNotice(''); setSelected(null); setPiece(null); setWallCard(null);
    }, [session, status, show]);

    const levels = session?.planSpec?.levels || [];
    const levelById = useMemo(() => new Map(levels.map((l) => [levelNum(l), l])), [levels]);
    const rooms = useMemo(() => levels.flatMap((l) => (l.rooms || []).map((room) => ({ room, level: levelNum(l) }))), [levels]);
    const roomById = useMemo(() => new Map(rooms.map((r) => [String(r.room.id), r])), [rooms]);
    const pieces = useMemo(() => levels.flatMap((l) => (l.furniture || []).map((item) => ({ item, level: levelNum(l) }))), [levels]);
    const pieceById = useMemo(() => new Map(pieces.map((p) => [String(p.item.id), p])), [pieces]);

    const turnPiece = useCallback((id) => commit([{ op: 'turnFurniture', itemId: id }]), [commit]);
    const removePiece = useCallback((id) => commit([{ op: 'removeFurniture', itemId: id }], () => setPiece(null)), [commit]);

    // Keyboard: undo and redo, Escape backs out of whatever is open, and a
    // selected piece turns with R and goes with Delete. Heard before the
    // studio window, so an Escape that closes something here does not also
    // close the studio; with nothing open it still does.
    useEffect(() => {
        const onKey = (e) => {
            if (e.target.closest?.('input, select, textarea')) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
            else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
            else if (e.key === 'Escape') {
                if (drag) { dragRef.current = null; setDrag(null); }
                else if (pieceDrag) { if (pieceRef.current) offsetPieces(pieceRef.current.ids, 0, 0); pieceRef.current = null; setPieceDrag(null); }
                else if (picking) setPicking(null);
                else if (popup) setPopup(null);
                else if (showChecks) setShowChecks(false);
                else if (selected || piece || wallCard || notice) { setSelected(null); setPiece(null); setWallCard(null); setNotice(''); }
                else return;
                e.stopPropagation();
            } else if (mode === 'furniture' && piece && !mod && status === 'ready' && !e.target.closest?.('[data-piece]')) {
                if (e.key === 'r' || e.key === 'R') { e.preventDefault(); turnPiece(piece); }
                else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePiece(piece); }
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [undo, redo, drag, pieceDrag, picking, popup, showChecks, selected, piece, wallCard, notice, mode, status, turnPiece, removePiece, offsetPieces]);

    const drawing = useMemo(() => parseDrawing(session?.svg), [session?.svg]);
    const issuesByRoom = useMemo(() => {
        const out = new Map();
        for (const i of session?.issues || []) if (i.roomId && i.severity !== 'info') out.set(i.roomId, [...(out.get(i.roomId) || []), i]);
        return out;
    }, [session?.issues]);

    // Drawing units per screen pixel at the current zoom.
    const screenUnit = () => {
        const a = svgRef.current?.getScreenCTM()?.a;
        return a ? 1 / a : 1;
    };
    const svgPoint = (e) => {
        const svg = svgRef.current;
        const ctm = svg?.getScreenCTM();
        if (!ctm) return null;
        return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    };

    const switchMode = (next) => {
        if (next === mode) return;
        setMode(next); setSelected(null); setPiece(null); setWallCard(null); setPicking(null); setNotice('');
    };

    // A wall: drag it (when it can move), or press and let go to see what can
    // be done with it; arrow keys move it a step at a time.
    const openWallCard = (run, point) => {
        const level = levelById.get(run.level);
        const sections = runSections(run, level);
        if (!sections.length) return;
        const tr = levelTransform(session.layout, run.level);
        const along = point && tr ? (run.axis === 'x' ? tr.ftY(point.y) : tr.ftX(point.x)) : null;
        const index = along === null ? 0 : Math.max(0, sections.findIndex((s) => along >= s.from - 1e-6 && along <= s.to + 1e-6));
        setWallCard({ runId: run.id, level: run.level, index });
        setSelected(null); setPopup(null); setNotice('');
    };
    const startDrag = (e, run) => {
        if (status === 'saving') return;
        e.stopPropagation();
        const p = svgPoint(e);
        if (!p) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { run, start: p, cx: e.clientX, cy: e.clientY };
        if (run.movable) setDrag({ run, delta: 0, unit: screenUnit() });
        setPopup(null); setNotice('');
    };
    const moveDrag = (e) => {
        const d = dragRef.current;
        if (!d || !d.run.movable) return;
        const p = svgPoint(e);
        const t = levelTransform(session.layout, d.run.level);
        if (!p || !t) return;
        const raw = t.toFt(d.run.axis === 'x' ? p.x - d.start.x : p.y - d.start.y);
        setDrag((prev) => ({ run: d.run, delta: snapDelta(raw, d.run), unit: prev?.unit || screenUnit() }));
    };
    const endDrag = (e) => {
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        if (drag?.delta && d.run.movable) { commit([{ op: 'moveWall', runId: d.run.id, delta: drag.delta }]); return; }
        setDrag(null);
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 5) openWallCard(d.run, d.start);
    };
    const nudge = (e, run) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWallCard(run, null); return; }
        if (!run.movable) return;
        const keys = run.axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
        const dir = keys[e.key];
        if (!dir) return;
        e.preventDefault();
        const pending = keyNudge.current?.run.id === run.id ? keyNudge.current.delta : 0;
        const delta = Math.min(run.maxDelta, Math.max(run.minDelta, pending + dir * KEY_STEP_FT));
        clearTimeout(keyNudge.current?.timer);
        setDrag({ run, delta, unit: screenUnit() });
        // Held keys add up; the wall moves once the key rests.
        keyNudge.current = { run, delta, timer: setTimeout(() => {
            keyNudge.current = null;
            if (delta) commit([{ op: 'moveWall', runId: run.id, delta }]); else setDrag(null);
        }, 450) };
    };

    // A piece of furniture: drag it, or arrow keys a step at a time.
    const membersFor = (id) => {
        const entry = pieceById.get(String(id));
        if (!entry) return [];
        return membersOf(levelById.get(entry.level)?.furniture, entry.item);
    };
    const pieceMove = (id, dx, dy) => {
        const entry = pieceById.get(String(id));
        const members = membersFor(id);
        const tr = entry && levelTransform(session.layout, entry.level);
        if (!tr || !members.length) return null;
        offsetPieces(members.map((m) => m.id), tr.len(dx), tr.len(dy));
        const box = boxOf(members);
        const cx = box.x + dx + box.w / 2, cy = box.y + dy + box.h / 2;
        const target = roomAt(levelById.get(entry.level), cx, cy);
        let problem = placementProblem(members, target);
        // Over the other floor's drawing: pieces stay on their own floor.
        const px = tr.x(cx), py = tr.y(cy);
        if (!target && (session.layout.levels || []).some((l) => Number(l.level) !== entry.level &&
            px >= l.originX && px <= l.originX + l.width * l.pxPerFt && py >= l.originY && py <= l.originY + l.height * l.pxPerFt)) {
            problem = `The ${groupName(members).toLowerCase()} stays on its own floor.`;
        }
        const next = { id: String(id), ids: members.map((m) => m.id), dx, dy, problem, target };
        pieceRef.current = { ...(pieceRef.current || {}), ...next };
        setPieceDrag(next);
        return next;
    };
    const finishPiece = (id, dx, dy, problem) => {
        if (!dx && !dy) { offsetPieces(membersFor(id).map((m) => m.id), 0, 0); pieceRef.current = null; setPieceDrag(null); return; }
        if (problem) {
            offsetPieces(membersFor(id).map((m) => m.id), 0, 0); pieceRef.current = null; setPieceDrag(null);
            setNotice(problem);
            return;
        }
        commit([{ op: 'moveFurniture', itemId: id, dx, dy }]);
    };
    const startPiece = (e, id) => {
        if (status === 'saving') return;
        e.stopPropagation();
        const p = svgPoint(e);
        if (!p) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pieceRef.current = { id: String(id), ids: membersFor(id).map((m) => m.id), start: p, cx: e.clientX, cy: e.clientY, dx: 0, dy: 0 };
        setPiece(String(id)); setPopup(null); setNotice('');
    };
    const movePiece = (e) => {
        const d = pieceRef.current;
        if (!d?.start) return;
        const p = svgPoint(e);
        const entry = pieceById.get(d.id);
        const tr = entry && levelTransform(session.layout, entry.level);
        if (!p || !tr) return;
        const step = e.shiftKey ? 1 / 12 : PIECE_STEP_FT;
        const snap = (units) => Math.round(tr.toFt(units) / step) * step;
        pieceMove(d.id, snap(p.x - d.start.x), snap(p.y - d.start.y));
    };
    const endPiece = () => {
        const d = pieceRef.current;
        if (!d?.start) return;
        pieceRef.current = { ...d, start: null };
        finishPiece(d.id, d.dx || 0, d.dy || 0, d.problem);
    };
    const pieceKey = (e, id) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPiece(String(id)); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setPiece(String(id)); turnPiece(id); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePiece(id); return; }
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir || status === 'saving') return;
        e.preventDefault();
        setPiece(String(id));
        const step = e.shiftKey ? 1 : PIECE_STEP_FT;
        const pending = pieceNudge.current?.id === String(id) ? pieceNudge.current : { dx: 0, dy: 0 };
        const moved = pieceMove(id, pending.dx + dir[0] * step, pending.dy + dir[1] * step);
        if (!moved) return;
        clearTimeout(pieceNudge.current?.timer);
        pieceNudge.current = { id: String(id), dx: moved.dx, dy: moved.dy, timer: setTimeout(() => {
            pieceNudge.current = null;
            finishPiece(moved.id, moved.dx, moved.dy, moved.problem);
        }, 450) };
    };

    // Selecting a room: a press and release without moving (a drag pans).
    const onPressCapture = (e) => {
        if (e.target.closest?.('[data-edit-handle], .pe-panel, .pe-bar, .pe-popup, .canvas-toolbar, .pe-hint')) { press.current = null; return; }
        const el = e.target.closest?.('[data-room-id]');
        press.current = { roomId: el ? el.getAttribute('data-room-id') : null, x: e.clientX, y: e.clientY };
    };
    const onReleaseCapture = (e) => {
        const p = press.current;
        press.current = null;
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) return;
        if (mode === 'furniture') { setPiece(null); return; }
        chooseRoom(p.roomId);
    };
    const chooseRoom = (roomId) => {
        setWallCard(null);
        if (picking && selected && roomId && roomId !== selected) {
            const a = roomById.get(String(selected))?.room, b = roomById.get(String(roomId))?.room;
            if (picking !== 'swap' && !canJoin(a, b)) {
                setNotice(`${Called(b)} does not share a wall with ${called(a)}. Choose a room next to it.`);
                return;
            }
            const kind = picking;
            setPicking(null);
            if (kind === 'swap') commit([{ op: 'swapRooms', a: selected, b: roomId }]);
            else if (kind === 'open') commit([{ op: 'openWall', a: selected, b: roomId }]);
            else commit([{ op: 'mergeRooms', a: selected, b: roomId }], () => setSelected(String(keeperOf(a, b).id)));
            return;
        }
        setPicking(null);
        setSelected(roomId);
    };

    // A card never covers what it is about: when the selection sits where the
    // card docks (top left), the card docks top right instead.
    const [cardRight, setCardRight] = useState(false);
    useLayoutEffect(() => {
        const stage = stageRef.current, svg = svgRef.current;
        if (!stage || !svg) return;
        const target = mode === 'furniture' ? svg.querySelector('.pe-piece-sel')
            : wallCard ? svg.querySelector('.pe-section')
                : selected ? svg.querySelector(`[data-room-id="${CSS.escape(String(selected))}"]`) : null;
        if (!target) { setCardRight(false); return; }
        const s = stage.getBoundingClientRect(), r = target.getBoundingClientRect();
        const reach = Math.min(360, s.width - 24) + 24;
        setCardRight(r.left - s.left < reach && r.top - s.top < 320 && s.right - r.right > reach);
    }, [selected, piece, wallCard, mode, session]);

    // The popup sits beside the room it is about, inside the stage.
    useLayoutEffect(() => {
        if (!popup || !stageRef.current) { setPopupPos(null); return; }
        const stage = stageRef.current.getBoundingClientRect();
        const el = popup.roomId ? svgRef.current?.querySelector(`[data-room-id="${CSS.escape(popup.roomId)}"]`) : null;
        const r = el?.getBoundingClientRect();
        const width = Math.min(340, stage.width - 24);
        if (!r) { setPopupPos({ left: stage.width / 2 - width / 2, top: 64, width }); return; }
        const right = r.right - stage.left + 12;
        const left = right + width < stage.width - 12 ? right : Math.max(12, r.left - stage.left - width - 12);
        const top = Math.min(Math.max(64, r.top - stage.top), Math.max(64, stage.height - 220));
        setPopupPos({ left, top, width });
    }, [popup, session]);

    if (status === 'loading' && !session) {
        return <div className="pe-state" role="status" aria-live="polite"><p>Preparing the plan for editing…</p></div>;
    }
    if (status === 'error' && !session) {
        return <div className="pe-state" role="alert"><p>{loadError}</p></div>;
    }
    if (!session || !drawing) return null;

    const t = (level) => levelTransform(session.layout, level);
    const selectedRoom = selected ? roomById.get(String(selected)) : null;
    const preview = drag ? previewCells(session.planSpec, drag.run, drag.delta) : [];
    const areas = session.areas;
    const findings = sortIssues(session.issues).filter((i) => i.severity !== 'block');
    const moving = drag && drag.delta !== 0;
    const busy = status === 'saving';
    const furnishing = mode === 'furniture';
    const pickFrom = picking && selectedRoom ? selectedRoom.room : null;

    // Rooms either side of the wall being moved, for the bar's live readout.
    const liveSizes = moving ? [...new Map(preview.map((c) => [c.roomId, c])).values()].slice(0, 3)
        .map((c) => `${nameOf(roomById.get(c.roomId)?.room)} ${formatFeet(drag.run.axis === 'x' ? c.w : c.h)}`) : [];

    const runLine = (run) => {
        const tr = t(run.level);
        if (!tr) return null;
        return run.axis === 'x'
            ? { x1: tr.x(run.at), y1: tr.y(run.from), x2: tr.x(run.at), y2: tr.y(run.to) }
            : { x1: tr.x(run.from), y1: tr.y(run.at), x2: tr.x(run.to), y2: tr.y(run.at) };
    };
    const segLine = (seg, tr) => (seg.axis === 'x'
        ? { x1: tr.x(seg.at), y1: tr.y(seg.from), x2: tr.x(seg.at), y2: tr.y(seg.to) }
        : { x1: tr.x(seg.from), y1: tr.y(seg.at), x2: tr.x(seg.to), y2: tr.y(seg.at) });
    const roomsOn = (run) => [...new Set(run.moves.map((m) => nameOf(roomById.get(m.roomId)?.room)))].join(', ');

    // The wall card's run and the section of it that was pressed.
    const cardRun = wallCard ? session.wallRuns.find((r) => r.id === wallCard.runId) : null;
    const cardSections = cardRun ? runSections(cardRun, levelById.get(cardRun.level)) : [];
    const cardSection = cardSections[Math.min(wallCard?.index || 0, cardSections.length - 1)] || null;

    // The selected piece, its group, and its place for the selection outline.
    const pieceEntry = piece ? pieceById.get(String(piece)) : null;
    const pieceMembers = pieceEntry ? membersFor(piece) : [];
    const pieceRoom = pieceEntry ? roomById.get(String(pieceEntry.item.roomId))?.room : null;
    const liveMove = pieceDrag && pieceDrag.id === String(piece) ? pieceDrag : null;

    // One stop per group on the keyboard; every drawn piece is a place to grab it.
    const leads = new Set();
    const seenGroups = new Set();
    for (const { item } of pieces) {
        const key = `${item.roomId}|${groupKeyOf(item)}`;
        if (!seenGroups.has(key)) { seenGroups.add(key); leads.add(String(item.id)); }
    }

    let hint = null;
    if (!notice && status === 'ready' && !popup && !drag && !pieceDrag && !picking) {
        if (furnishing && !piece) hint = 'Drag a piece to move it, or select it to turn or remove it.';
        if (!furnishing && !selectedRoom && !wallCard) hint = 'Drag a wall to resize the rooms beside it. Click a wall to take it out, or select a room.';
    }

    return (
        <div className={'plan-editor' + (furnishing ? ' is-furnishing' : '')} onPointerDownCapture={onPressCapture} onPointerUpCapture={onReleaseCapture}>
            <div className="pe-bar" role="toolbar" aria-label="Edit plan">
                <div className="pe-mode" role="group" aria-label="What to edit">
                    <button type="button" aria-pressed={!furnishing} onClick={() => switchMode('rooms')}>Walls and rooms</button>
                    <button type="button" aria-pressed={furnishing} onClick={() => switchMode('furniture')}>Furniture</button>
                </div>
                <p className="pe-area" aria-live="polite">
                    {moving ? <span className="mono">{liveSizes.join(' · ')}</span>
                        : pieceDrag ? (pieceDrag.problem
                            ? <span className="pe-area-bad">{pieceDrag.problem}</span>
                            : <span><span className="mono">{formatFeet(Math.abs(pieceDrag.dx))} {pieceDrag.dx < 0 ? 'left' : 'right'}, {formatFeet(Math.abs(pieceDrag.dy))} {pieceDrag.dy < 0 ? 'up' : 'down'}</span>
                                {pieceDrag.target ? <span className="pe-area-diff"> · in {called(pieceDrag.target)}</span> : null}</span>)
                        : <>
                            <span className="mono">{formatArea(areas.finished)}</span> finished
                            {areas.requested ? <span className="pe-area-diff">
                                {areas.difference === 0 ? ', as you asked' : `, ${formatArea(Math.abs(areas.difference))} ${areas.difference > 0 ? 'more' : 'less'} than your ${areas.requested.toLocaleString('en-US')}`}
                            </span> : null}
                        </>}
                </p>
                {busy && <span className="pe-saving" role="status">Checking the plan…</span>}
                <div className="pe-bar-actions">
                    {findings.length > 0 && <button type="button" className="pe-chip" aria-expanded={showChecks} onClick={() => setShowChecks((v) => !v)}>
                        <span className="pe-dot" aria-hidden="true"/>{findings.length} {findings.length === 1 ? 'finding' : 'findings'}
                    </button>}
                    <button type="button" className="pe-icon" onClick={undo} disabled={!past.length || busy} aria-label="Undo" title="Undo (Ctrl+Z)">
                        <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true"/>
                    </button>
                    <button type="button" className="pe-icon" onClick={redo} disabled={!future.length || busy} aria-label="Redo" title="Redo (Ctrl+Y)">
                        <ArrowClockwise size={18} weight="bold" aria-hidden="true"/>
                    </button>
                    <button type="button" className="pe-link" onClick={undoAll} disabled={!base.current || session === base.current || busy}>Undo all edits</button>
                </div>
            </div>

            <div className="pe-stage" ref={stageRef}>
                <InteractiveCanvas viewKey={`edit|${drawing.width}x${drawing.height}`}>
                    <svg ref={svgRef} className={'pe-svg' + (picking ? ' is-picking' : '')} xmlns="http://www.w3.org/2000/svg"
                        width={drawing.width} height={drawing.height} viewBox={drawing.viewBox} role="group" aria-label="Floor plan, editable">
                        <g dangerouslySetInnerHTML={{ __html: drawing.inner }}/>
                        <g className="pe-layer">
                            <g role={furnishing ? undefined : 'listbox'} aria-label={furnishing ? undefined : 'Rooms'} aria-hidden={furnishing || undefined}>
                            {rooms.map(({ room, level }) => {
                                const tr = t(level);
                                if (!tr || room.type === 'outdoor') return null;
                                const id = String(room.id);
                                const flagged = issuesByRoom.has(id);
                                const eligible = pickFrom && id !== String(pickFrom.id)
                                    ? (picking === 'swap' ? !['stairs', 'garage'].includes(room.type) && level === selectedRoom.level : canJoin(pickFrom, room))
                                    : null;
                                return (
                                    <g key={id} className={'pe-room' + (selected === id ? ' is-selected' : '') + (flagged ? ' is-flagged' : '')
                                        + (eligible === true ? ' is-eligible' : eligible === false ? ' is-ineligible' : '')}
                                        data-room-id={id} tabIndex={furnishing ? -1 : 0} role={furnishing ? undefined : 'option'} aria-selected={furnishing ? undefined : selected === id}
                                        aria-label={`${nameOf(room)}${flagged ? ', has findings' : ''}`}
                                        onKeyDown={(e) => { if (!furnishing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); chooseRoom(id); } }}>
                                        {roomCells(room).map((c, i) => (
                                            <rect key={i} x={tr.x(c.x)} y={tr.y(c.y)} width={tr.len(c.w)} height={tr.len(c.h)}/>
                                        ))}
                                    </g>
                                );
                            })}
                            </g>
                            {[...issuesByRoom.keys()].map((id) => {
                                const entry = roomById.get(id);
                                const tr = entry && t(entry.level);
                                if (!tr) return null;
                                const c = roomCells(entry.room).reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
                                return <circle key={`flag-${id}`} className="pe-flag" cx={tr.x(c.x + c.w) - 14} cy={tr.y(c.y) + 14} r={6} aria-hidden="true"/>;
                            })}

                            {/* Walls a person took out: a dashed line where the wall stood. */}
                            {!furnishing && levels.flatMap((l) => {
                                const tr = t(levelNum(l));
                                if (!tr) return [];
                                const byId = new Map((l.rooms || []).map((r) => [String(r.id), r]));
                                return [...openPairs(l)].flatMap((key) => {
                                    const [a, b] = key.split('|').map((id) => byId.get(id));
                                    if (!a || !b) return [];
                                    return sharedSegments(a, b).map((seg, i) => <line key={`${key}:${i}`} className="pe-open" {...segLine(seg, tr)} aria-hidden="true"/>);
                                });
                            })}

                            {!furnishing && session.wallRuns.filter((r) => r.reason !== 'stairs').map((run) => {
                                const line = runLine(run);
                                if (!line) return null;
                                const mx = (line.x1 + line.x2) / 2, my = (line.y1 + line.y2) / 2;
                                const grip = 14;
                                const active = drag?.run.id === run.id || wallCard?.runId === run.id;
                                const touchesSelected = selected && run.rooms.includes(String(selected));
                                const label = `Wall between ${roomsOn(run)}.`;
                                return (
                                    <g key={run.id} className={'pe-wall' + (run.movable ? '' : ' is-fixed') + (active ? ' is-active' : '') + (touchesSelected ? ' is-near' : '') + (run.axis === 'x' ? ' is-vertical' : ' is-horizontal')}
                                        data-edit-handle="wall" tabIndex={0}
                                        {...(run.movable
                                            ? { role: 'slider', 'aria-label': `${label} Drag it, or use the arrow keys, to move it. Enter for more.`,
                                                'aria-valuemin': run.minDelta, 'aria-valuemax': run.maxDelta, 'aria-valuenow': drag?.run.id === run.id ? drag.delta : 0,
                                                'aria-valuetext': drag?.run.id === run.id ? formatFeet(drag.delta) : 'unmoved' }
                                            : { role: 'button', 'aria-label': `${label} Press Enter to take it out or merge the rooms.` })}
                                        onPointerDown={(e) => startDrag(e, run)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                                        onKeyDown={(e) => nudge(e, run)}>
                                        <line className="pe-wall-hit" {...line}/>
                                        <line className="pe-wall-line" {...line}/>
                                        {run.movable && (run.axis === 'x'
                                            ? <line className="pe-wall-grip" x1={mx} y1={my - grip} x2={mx} y2={my + grip}/>
                                            : <line className="pe-wall-grip" x1={mx - grip} y1={my} x2={mx + grip} y2={my}/>)}
                                    </g>
                                );
                            })}
                            {cardSection && cardRun && (() => {
                                const tr = t(cardRun.level);
                                const seg = { axis: cardRun.axis, at: cardRun.at, from: cardSection.from, to: cardSection.to };
                                return tr ? <line className="pe-section" {...segLine(seg, tr)} aria-hidden="true"/> : null;
                            })()}

                            {moving && (() => {
                                const tr = t(drag.run.level);
                                const old = runLine(drag.run);
                                const shift = tr.len(drag.delta);
                                const live = drag.run.axis === 'x'
                                    ? { ...old, x1: old.x1 + shift, x2: old.x2 + shift }
                                    : { ...old, y1: old.y1 + shift, y2: old.y2 + shift };
                                const seen = new Set();
                                return (
                                    <g className="pe-preview" aria-hidden="true">
                                        {preview.map((c, i) => <rect key={i} className="pe-ghost" x={tr.x(c.x)} y={tr.y(c.y)} width={tr.len(c.w)} height={tr.len(c.h)}/>)}
                                        <line className="pe-wall-old" {...old}/>
                                        <line className="pe-wall-live" {...live}/>
                                        {preview.filter((c) => !seen.has(c.roomId) && seen.add(c.roomId)).map((c, i) => drag.run.axis === 'x'
                                            ? <Dimension key={i} unit={drag.unit} x1={tr.x(c.x)} x2={tr.x(c.x + c.w)} y1={tr.y(c.y + c.h / 2)} y2={tr.y(c.y + c.h / 2)} text={formatFeet(c.w)}/>
                                            : <Dimension key={i} unit={drag.unit} x1={tr.x(c.x + c.w / 2)} x2={tr.x(c.x + c.w / 2)} y1={tr.y(c.y)} y2={tr.y(c.y + c.h)} text={formatFeet(c.h)}/>)}
                                    </g>
                                );
                            })()}

                            {furnishing && (
                                <g role="listbox" aria-label="Furniture">
                                    {[...pieces].sort((a, b) => b.item.w * b.item.h - a.item.w * a.item.h).map(({ item, level }) => {
                                        const tr = t(level);
                                        if (!tr) return null;
                                        const id = String(item.id);
                                        const lead = leads.has(id);
                                        const inSelection = pieceMembers.some((m) => String(m.id) === id);
                                        const name = groupName(membersOf(levelById.get(level)?.furniture, item));
                                        return (
                                            <rect key={id} className={'pe-piece' + (inSelection ? ' is-selected' : '')} data-edit-handle="piece" data-piece={id}
                                                x={tr.x(item.x)} y={tr.y(item.y)} width={tr.len(item.w)} height={tr.len(item.h)}
                                                tabIndex={lead ? 0 : -1} role="option" aria-selected={inSelection} aria-label={`${name}. Drag or use the arrow keys to move it; R turns it, Delete removes it.`}
                                                onPointerDown={(e) => startPiece(e, id)} onPointerMove={movePiece} onPointerUp={endPiece}
                                                onPointerCancel={() => { if (pieceRef.current) offsetPieces(pieceRef.current.ids, 0, 0); pieceRef.current = null; setPieceDrag(null); }}
                                                onKeyDown={(e) => pieceKey(e, id)}/>
                                        );
                                    })}
                                    {pieceEntry && pieceMembers.length > 0 && (() => {
                                        const tr = t(pieceEntry.level);
                                        const box = boxOf(pieceMembers);
                                        const dx = liveMove ? liveMove.dx : 0, dy = liveMove ? liveMove.dy : 0;
                                        const pad = 4 * screenUnit();
                                        return <rect className={'pe-piece-sel' + (liveMove?.problem ? ' is-bad' : '')} aria-hidden="true"
                                            x={tr.x(box.x + dx) - pad} y={tr.y(box.y + dy) - pad} width={tr.len(box.w) + pad * 2} height={tr.len(box.h) + pad * 2}/>;
                                    })()}
                                </g>
                            )}
                        </g>
                    </svg>
                </InteractiveCanvas>

                {hint && <p className="pe-hint">{hint}</p>}
                {picking && selectedRoom && (
                    <div className="pe-hint is-picking" role="status">
                        {PICKING_TEXT[picking](called(selectedRoom.room))}
                        <button type="button" className="pe-link" onClick={() => setPicking(null)}>Cancel</button>
                    </div>
                )}
                {notice && <div className="pe-notice" role="alert"><p>{notice}</p>
                    <button type="button" className="pe-icon" onClick={() => setNotice('')} aria-label="Dismiss"><XIcon size={16} weight="bold" aria-hidden="true"/></button></div>}

                {!furnishing && selectedRoom && !picking && (
                    <RoomPanel right={cardRight} entry={selectedRoom} level={levelById.get(selectedRoom.level)} areas={areas} issues={issuesByRoom.get(String(selected)) || []}
                        wallRuns={session.wallRuns} busy={busy} onClose={() => setSelected(null)}
                        onEdit={(ops) => commit(ops)} onPick={(kind) => { setNotice(''); setPicking(kind); }}/>
                )}
                {!furnishing && cardSection && (
                    <WallPanel right={cardRight} planSpec={session.planSpec} sections={cardSections} index={Math.min(wallCard.index, cardSections.length - 1)} level={levelById.get(cardRun.level)}
                        busy={busy} onSection={(index) => setWallCard((w) => ({ ...w, index }))} onClose={() => setWallCard(null)}
                        onEdit={(op, after) => commit([op], () => { setWallCard(null); after?.(); })} onSelectRoom={(id) => { setWallCard(null); setSelected(id); }}/>
                )}
                {furnishing && pieceEntry && pieceMembers.length > 0 && !pieceDrag && (
                    <PiecePanel right={cardRight} members={pieceMembers} room={pieceRoom} busy={busy} onClose={() => setPiece(null)}
                        onTurn={() => turnPiece(piece)} onRemove={() => removePiece(piece)}
                        onReset={pieceRoom?.furnitureEdited ? () => commit([{ op: 'resetFurniture', roomId: pieceRoom.id }], () => setPiece(null)) : null}/>
                )}

                {showChecks && findings.length > 0 && (
                    <div className="pe-panel pe-checks" role="dialog" aria-label="Plan check">
                        <div className="pe-panel-head"><h3>Plan check</h3>
                            <button type="button" className="pe-icon" onClick={() => setShowChecks(false)} aria-label="Close plan check"><XIcon size={16} weight="bold" aria-hidden="true"/></button></div>
                        <ul>
                            {findings.map((i, n) => (
                                <li key={n} className={i.severity === 'info' ? 'is-note' : ''}>
                                    <button type="button" onClick={() => { if (i.roomId) { switchMode('rooms'); setSelected(i.roomId); } }} disabled={!i.roomId}>
                                        <strong>{issueTitle(i, rooms.map((r) => r.room))}</strong>
                                        <span>{i.message}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {popup && popupPos && (
                    <div className="pe-popup" role="alertdialog" aria-labelledby="pe-popup-title" style={{ left: popupPos.left, top: popupPos.top, width: popupPos.width }}>
                        <h3 id="pe-popup-title">{issueTitle(popup.issues[0], rooms.map((r) => r.room))}</h3>
                        {popup.issues.length === 1
                            ? <p className="pe-popup-text">{popup.issues[0].message}</p>
                            : <ul>{popup.issues.slice(0, 3).map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
                        {popup.issues.length > 3 && <p className="pe-more">and {popup.issues.length - 3} more in the plan check.</p>}
                        <p className="pe-popup-note">You can keep this change or undo it.</p>
                        <div className="pe-popup-actions">
                            <button type="button" className="studio-btn studio-btn-quiet" onClick={undo}>Undo</button>
                            <button type="button" className="studio-btn studio-btn-primary" onClick={() => setPopup(null)} autoFocus>Keep it</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function RoomPanel({ right, entry, level, areas, issues, wallRuns, busy, onClose, onEdit, onPick }) {
    const { room } = entry;
    const id = String(room.id);
    const fixed = FIXED_TYPES.has(room.type);
    const info = areas.rooms.find((r) => r.roomId === id);
    const rect = !(room.parts?.length > 1);
    const action = (axis, ft) => quickResize(wallRuns, id, axis, ft);
    const quick = [['Wider', 'wide', 1], ['Narrower', 'wide', -1], ['Deeper', 'deep', 1], ['Shallower', 'deep', -1]];
    const others = (level?.rooms || []).filter((r) => r !== room);
    const joinable = others.some((r) => canJoin(room, r));
    const open = [...openPairs(level)].filter((k) => k.split('|').includes(id))
        .map((k) => others.find((r) => String(r.id) === k.split('|').find((x) => x !== id))).filter(Boolean);
    const locked = room.type === 'stairs' || room.type === 'garage';
    return (
        <div className={'pe-panel pe-room-panel' + (right ? ' is-right' : '')} role="dialog" aria-label={nameOf(room)}>
            <div className="pe-panel-head">
                <h3>{nameOf(room)}</h3>
                <button type="button" className="pe-icon" onClick={onClose} aria-label="Close"><XIcon size={16} weight="bold" aria-hidden="true"/></button>
            </div>
            <p className="pe-size mono">
                {rect ? `${formatFeet(room.w)} × ${formatFeet(room.h)} · ` : ''}{formatArea(info?.area ?? room.w * room.h)}
            </p>
            {issues.length > 0 && <ul className="pe-issues">{issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
            {room.type === 'stairs'
                ? <p className="pe-note">The stair is fitted to the storey height and stacked with the floor above, so it stays where it is.</p>
                : <>
                    <div className="pe-quick" role="group" aria-label="Resize by one foot">
                        {quick.map(([label, axis, ft]) => {
                            const op = action(axis, ft);
                            return <button key={label} type="button" className="pe-chip" disabled={busy || !op} onClick={() => onEdit([op])}
                                title={op ? `${label} by 1 ft` : 'No wall on that side can move'}>{label}</button>;
                        })}
                    </div>
                    <div className="pe-row">
                        {room.type !== 'garage' && <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy} onClick={() => onPick('swap')}>Swap with…</button>}
                        {!fixed && (
                            <label className="pe-field">
                                <span className="sr-only">Room type</span>
                                <select aria-label="Room type" value={ROOM_TYPES.some(([v]) => v === room.type) ? room.type : ''} disabled={busy}
                                    onChange={(e) => e.target.value && onEdit([{ op: 'changeRoomType', roomId: id, type: e.target.value }])}>
                                    {!ROOM_TYPES.some(([v]) => v === room.type) && <option value="">{nameOf(room)}</option>}
                                    {ROOM_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                                </select>
                            </label>
                        )}
                    </div>
                    {!locked && (
                        <div className="pe-row">
                            <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy || !joinable} onClick={() => onPick('open')}
                                title={joinable ? 'Take out the wall to a room next to it' : 'No room next to it can open up'}>Open to…</button>
                            <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy || !joinable} onClick={() => onPick('merge')}
                                title={joinable ? 'Make it one room with a room next to it' : 'No room next to it can merge'}>Merge with…</button>
                        </div>
                    )}
                    {open.length > 0 && (
                        <ul className="pe-openings">
                            {open.map((other) => (
                                <li key={other.id}>
                                    <span>Open to {called(other)}</span>
                                    <button type="button" className="pe-link" disabled={busy} onClick={() => onEdit([{ op: 'closeWall', a: id, b: other.id }])}>Put the wall back</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    {room.furnitureEdited && (
                        <p className="pe-note pe-line">
                            <span>You arranged the furniture here.</span>
                            <button type="button" className="pe-link" disabled={busy} onClick={() => onEdit([{ op: 'resetFurniture', roomId: id }])}>Furnish it again</button>
                        </p>
                    )}
                    {fixed && room.type !== 'garage' && <p className="pe-note">{Called(room)} keeps its type; swap it with another room to move it.</p>}
                </>}
        </div>
    );
}

// A wall pressed in the plan: the rooms it divides there, and what can be
// done with it.
function WallPanel({ right, planSpec, sections, index, level, busy, onSection, onClose, onEdit, onSelectRoom }) {
    const s = sections[index];
    const { a, b } = s;
    const isOpen = openPairs(level).has(pairKey(a.id, b.id));
    // Drawn open-plan: no wall stands there to take out.
    const openPlan = !isOpen && openPlanPair(planSpec, a, b);
    const locked = [a, b].find((r) => r.type === 'stairs' || r.type === 'garage');
    const length = s.to - s.from;
    const keeper = keeperOf(a, b);
    const other = keeper === a ? b : a;
    const title = `${isOpen ? 'Opening' : openPlan ? 'Open plan' : 'Wall'} between ${called(a)} and ${called(b)}`;
    return (
        <div className={'pe-panel pe-wall-panel' + (right ? ' is-right' : '')} role="dialog" aria-label={title}>
            <div className="pe-panel-head">
                <h3>{title}</h3>
                <button type="button" className="pe-icon" onClick={onClose} aria-label="Close"><XIcon size={16} weight="bold" aria-hidden="true"/></button>
            </div>
            <p className="pe-size mono">{formatFeet(length)} {isOpen || openPlan ? 'open' : 'long'}</p>
            {sections.length > 1 && (
                <div className="pe-sections" role="group" aria-label="Parts of this wall">
                    {sections.map((sec, i) => (
                        <button key={i} type="button" className="pe-chip" aria-pressed={i === index} onClick={() => onSection(i)}>
                            {nameOf(sec.a)} | {nameOf(sec.b)}
                        </button>
                    ))}
                </div>
            )}
            {locked ? (
                <p className="pe-note">{locked.type === 'garage'
                    ? 'The garage keeps its walls. They separate the cars from the house for fire safety.'
                    : 'The stair keeps its walls: it is fitted to the storey and opens to its landing already.'}</p>
            ) : isOpen ? (
                <>
                    <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy} onClick={() => onEdit({ op: 'closeWall', a: a.id, b: b.id })}>Put the wall back</button>
                    <p className="pe-note">A door goes back in where the plan needs one.</p>
                </>
            ) : openPlan ? (
                <>
                    <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy}
                        onClick={() => onEdit({ op: 'mergeRooms', a: a.id, b: b.id }, () => onSelectRoom(String(keeper.id)))}>Merge into one room</button>
                    <p className="pe-note">These rooms are already open to each other: the plan is drawn open-plan. Merging makes one room: {called(keeper)} takes in {called(other)}.</p>
                </>
            ) : length < 2 ? (
                <p className="pe-note">This stretch is under 2 ft, too short to open up. Choose a longer part of the wall.</p>
            ) : (
                <>
                    <div className="pe-row">
                        <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy} onClick={() => onEdit({ op: 'openWall', a: a.id, b: b.id })}>Take the wall out</button>
                        <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy}
                            onClick={() => onEdit({ op: 'mergeRooms', a: a.id, b: b.id }, () => onSelectRoom(String(keeper.id)))}>Merge into one room</button>
                    </div>
                    <p className="pe-note">
                        Taking it out keeps two rooms, open to each other. Merging makes one room: {called(keeper)} takes in {called(other)}.
                    </p>
                </>
            )}
        </div>
    );
}

// A piece of furniture: its size and room, and what can be done with it.
function PiecePanel({ right, members, room, busy, onClose, onTurn, onRemove, onReset }) {
    const name = groupName(members);
    const box = boxOf(members);
    return (
        <div className={'pe-panel pe-piece-panel' + (right ? ' is-right' : '')} role="dialog" aria-label={name}>
            <div className="pe-panel-head">
                <h3>{name}</h3>
                <button type="button" className="pe-icon" onClick={onClose} aria-label="Close"><XIcon size={16} weight="bold" aria-hidden="true"/></button>
            </div>
            <p className="pe-size mono">{formatFeet(box.w)} × {formatFeet(box.h)}{room ? ` · ${nameOf(room)}` : ''}</p>
            <div className="pe-row">
                <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy} onClick={onTurn}>Turn</button>
                <button type="button" className="studio-btn studio-btn-quiet pe-wide" disabled={busy} onClick={onRemove}>Remove</button>
            </div>
            <p className="pe-note">Drag it to move it. Arrow keys nudge it 3 in; R turns it, Delete removes it.</p>
            {onReset && (
                <p className="pe-note pe-line">
                    <span>You arranged this room.</span>
                    <button type="button" className="pe-link" disabled={busy} onClick={onReset}>Furnish it again</button>
                </p>
            )}
        </div>
    );
}
