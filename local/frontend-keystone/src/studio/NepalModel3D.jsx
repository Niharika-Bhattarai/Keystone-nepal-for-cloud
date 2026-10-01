import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EXTERIOR_SCHEMES, INTERIOR_SCHEMES, DEFAULT_EXTERIOR, DEFAULT_INTERIOR, exteriorScheme, interiorScheme, roomPaint,
    subtractIntervals } from './colourSchemes.js';

/* Study massing of a Nepal spatial hypothesis (POST /api/nepal/concepts,
   format: 'json'). Walls are extruded from the engine's solid wall segments, so
   door and window gaps are the reserved openings, not decoration. This is a
   review aid: it is not a floor plan, permit drawing or engineered model, and
   the banner and finding list below keep that visible.

   Axes: engine plan x -> three x, engine plan y -> three -z, height -> three y.
   Millimetres become metres. */

const SLAB_M = 0.15, SILL_M = 0.9, HEAD_M = 2.1, PARAPET_M = 1.0, PLINTH_M = 0.45, BAND_M = 0.22;
const PREFS_KEY = 'keystone-nepal:3d-colours-v1';
const ROOM_COLOURS = {
    livingRoom: 0xdfe8d8, kitchen: 0xf2dfc6, primaryBedroom: 0xd9e2ef, bedroom: 0xe3e8f2,
    guestBedroom: 0xd8e9e6, bathroom: 0xe6e1dc, puja: 0xf3e3a8, primaryAlcove: 0xdde4ee,
    livingAnnex: 0xe1e8da, diningAnnex: 0xefe4d0, utilityFlex: 0xe2e8e4, serviceNiche: 0xe2e8e4,
};

const m = mm => mm / 1000;
// Rectangle a minus rectangle b, as up to four rectangles.
function subtractBox(a, b) {
    if (b.x2 <= a.x1 || b.x1 >= a.x2 || b.y2 <= a.y1 || b.y1 >= a.y2) return [a];
    const out = [];
    if (b.y1 > a.y1) out.push({ ...a, y2: b.y1 });
    if (b.y2 < a.y2) out.push({ ...a, y1: b.y2 });
    const y1 = Math.max(a.y1, b.y1), y2 = Math.min(a.y2, b.y2);
    if (b.x1 > a.x1) out.push({ x1: a.x1, x2: b.x1, y1, y2 });
    if (b.x2 < a.x2) out.push({ x1: b.x2, x2: a.x2, y1, y2 });
    return out;
}

function block(group, box, y0, y1, material) {
    const w = m(box.x2 - box.x1), d = m(box.y2 - box.y1), h = y1 - y0;
    if (w <= 0 || d <= 0 || h <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(m(box.x1) + w / 2, y0 + h / 2, -(m(box.y1) + d / 2));
    group.add(mesh);
}

// Paint layer just inside a room, on each of its four sides, with gaps where
// that wall has a door or window so openings stay readable.
function paintRoom(group, room, level, z0, z1, material) {
    const b = room.clearBox || room.box, t = 15, gapsOn = (axis, at) => level.walls.flatMap(w => w.openings)
        .filter(o => axis === 'x' ? o.box.y1 - 300 <= at && o.box.y2 + 300 >= at && o.box.x2 - o.box.x1 > o.box.y2 - o.box.y1
            : o.box.x1 - 300 <= at && o.box.x2 + 300 >= at && o.box.y2 - o.box.y1 > o.box.x2 - o.box.x1)
        .map(o => axis === 'x' ? [o.box.x1, o.box.x2] : [o.box.y1, o.box.y2]);
    for (const [y, inward] of [[b.y1, 1], [b.y2, -1]])
        for (const [a, c] of subtractIntervals(b.x1, b.x2, gapsOn('x', y)))
            block(group, { x1: a, x2: c, y1: inward > 0 ? y : y - t, y2: inward > 0 ? y + t : y }, z0, z1, material);
    for (const [x, inward] of [[b.x1, 1], [b.x2, -1]])
        for (const [a, c] of subtractIntervals(b.y1, b.y2, gapsOn('y', x)))
            block(group, { y1: a, y2: c, x1: inward > 0 ? x : x - t, x2: inward > 0 ? x + t : x }, z0, z1, material);
}

function buildModel(geometry, upToIndex, { exterior, interior, seeThrough = false } = {}) {
    const ext = exteriorScheme(exterior), int = interiorScheme(interior);
    const group = new THREE.Group();
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
    const wallMat = std(0xf4f1ea);
    const extMat = std(ext.wall, seeThrough ? { transparent: true, opacity: 0.18, depthWrite: false } : {});
    const bandMat = std(ext.band, seeThrough ? { transparent: true, opacity: 0.25, depthWrite: false } : {});
    const parapetMat = std(ext.parapet), plinthMat = std(ext.plinth), trimMat = std(ext.trim, { roughness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9cc3d6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
    const slabMat = std(ext.roof);
    // columns are plastered and painted with the walls; grey only when looking inside
    const colMat = seeThrough ? std(0x5b6468, { roughness: 0.8 }) : std(ext.wall);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x9fb4bd, transparent: true, opacity: 0.35 });
    const floorMats = {}, paintMats = {};
    const floorMat = type => floorMats[type] ||= std(ROOM_COLOURS[type] || 0xe7e7e2, { roughness: 1 });
    const paintMat = type => paintMats[type] ||= std(roomPaint(int, type));
    // Looking inside: only the chosen floor, ceiling removed (dolls'-house view).
    const shown = seeThrough ? [geometry.levels[upToIndex]] : geometry.levels.slice(0, upToIndex + 1);
    shown.forEach((level, si) => {
        const li = geometry.levels.indexOf(level);
        const z0 = m(level.elevationMm), top = z0 + m(level.storeyHeightMm);
        for (const slab of level.slabs) block(group, slab, z0 - SLAB_M, z0, slabMat);
        if (li === 0) for (const s of level.slabs) {
            // plinth: the 450 mm raised base under the ground floor
            block(group, { x1: s.x1 - 60, y1: s.y1 - 60, x2: s.x2 + 60, y2: s.y2 + 60 }, z0 - SLAB_M - PLINTH_M, z0 - SLAB_M, plinthMat);
        }
        // floor band: a thin projecting band at each floor line (classic Nepali facade)
        if (li > 0) for (const s of level.slabs)
            block(group, { x1: s.x1 - 40, y1: s.y1 - 40, x2: s.x2 + 40, y2: s.y2 + 40 }, z0 - SLAB_M - 0.05, z0 - SLAB_M + BAND_M - 0.05, bandMat);
        for (const room of level.rooms) {
            block(group, room.clearBox || room.box, z0, z0 + 0.02, floorMat(room.type));
            paintRoom(group, room, level, z0 + 0.02, top - SLAB_M, paintMat(room.type));
        }
        for (const wall of level.walls) {
            const mat = wall.kind === 'exterior' ? extMat : wallMat;
            for (const solid of wall.solidBoxes) block(group, solid, z0, top - SLAB_M, mat);
            for (const opening of wall.openings) {
                if (opening.kind === 'window') block(group, opening.box, z0, z0 + SILL_M, mat);
                block(group, opening.box, z0 + HEAD_M, top - SLAB_M, mat);
                if (wall.kind !== 'exterior') continue;
                const o = opening.box, horiz = o.x2 - o.x1 >= o.y2 - o.y1, f = 60;
                const bottom = opening.kind === 'window' ? z0 + SILL_M : z0;
                // frame on the outer face, glass in windows, a timber leaf for doors
                const jambs = horiz ? [{ ...o, x2: o.x1 + f }, { ...o, x1: o.x2 - f }] : [{ ...o, y2: o.y1 + f }, { ...o, y1: o.y2 - f }];
                for (const j of jambs) block(group, j, bottom, z0 + HEAD_M, trimMat);
                block(group, o, z0 + HEAD_M - 0.06, z0 + HEAD_M, trimMat);
                if (opening.kind === 'window') {
                    block(group, o, bottom, bottom + 0.05, trimMat);
                    const mid = horiz ? { ...o, y1: (o.y1 + o.y2) / 2 - 10, y2: (o.y1 + o.y2) / 2 + 10 } : { ...o, x1: (o.x1 + o.x2) / 2 - 10, x2: (o.x1 + o.x2) / 2 + 10 };
                    block(group, mid, bottom + 0.05, z0 + HEAD_M - 0.06, glassMat);
                }
            }
        }
        if (!level.walls.length) {
            // Terrace floor without placed rooms: 1 m parapet line only (enclosure unverified).
            for (const s of level.slabs) {
                const t = 229;
                for (const edge of [{ ...s, y2: s.y1 + t }, { ...s, y1: s.y2 - t }, { ...s, x2: s.x1 + t }, { ...s, x1: s.x2 - t }])
                    block(group, edge, z0, z0 + PARAPET_M, parapetMat);
            }
        }
        for (const c of geometry.columns) {
            const inside = level.slabs.some(s => c.xMm > s.x1 && c.xMm < s.x2 && c.yMm > s.y1 && c.yMm < s.y2);
            if (!inside) continue;
            const h = c.widthMm / 2;
            block(group, { x1: c.xMm - h, y1: c.yMm - h, x2: c.xMm + h, y2: c.yMm + h }, z0, top - SLAB_M, colMat);
        }
        if (geometry.core.levelIds.includes(level.id)) block(group, geometry.core.box, z0 + 0.03, top - SLAB_M, coreMat);
        // roof and open terrace: the part of this level not built over (or all of
        // it on the top shown level), with a parapet only on its open edges
        if (seeThrough) return;// no roof over the floor being looked into
        const upper = si === shown.length - 1 ? [] : (geometry.levels[li + 1]?.slabs || []);
        const t = 229;
        for (const r of level.slabs.flatMap(s => upper.reduce((parts, u) => parts.flatMap(p => subtractBox(p, u)), [s]))) {
            block(group, r, top - SLAB_M, top, slabMat);
            const edges = [[{ ...r, y2: r.y1 + t }, { x: (r.x1 + r.x2) / 2, y: r.y1 - 5 }], [{ ...r, y1: r.y2 - t }, { x: (r.x1 + r.x2) / 2, y: r.y2 + 5 }],
                [{ ...r, x2: r.x1 + t }, { x: r.x1 - 5, y: (r.y1 + r.y2) / 2 }], [{ ...r, x1: r.x2 - t }, { x: r.x2 + 5, y: (r.y1 + r.y2) / 2 }]];
            for (const [edge, out] of edges) {
                const inside = b => out.x > b.x1 && out.x < b.x2 && out.y > b.y1 && out.y < b.y2;
                if (upper.some(inside) || level.slabs.some(inside)) continue;// wall of the floor above, or more terrace
                block(group, edge, top, top + PARAPET_M, parapetMat);
                block(group, { x1: edge.x1 - 30, y1: edge.y1 - 30, x2: edge.x2 + 30, y2: edge.y2 + 30 }, top + PARAPET_M, top + PARAPET_M + 0.08, bandMat);
            }
        }
    });
    return group;
}

function northArrow(geometry) {
    // Bearing is counterclockwise from engine +x; three's -z is engine +y.
    const a = (geometry.northBearingDegrees ?? 0) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const s = geometry.site;
    const origin = new THREE.Vector3(m(s.x2) + 1.2, 0.05, -m(s.y1));
    return new THREE.ArrowHelper(dir, origin, 2.5, 0xb3261e, 0.7, 0.4);
}

function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
}

export default function NepalModel3D({ geometry }) {
    const canvasRef = useRef(null);
    const stage = useRef(null);
    const [upTo, setUpTo] = useState(geometry.levels.length - 1);
    const [exterior, setExterior] = useState(() => loadPrefs().exterior || DEFAULT_EXTERIOR);
    const [interior, setInterior] = useState(() => loadPrefs().interior || DEFAULT_INTERIOR);
    const [seeThrough, setSeeThrough] = useState(false);
    const [gallery, setGallery] = useState(null);// {kind, items:[{id,name,note,src}]}
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        try { localStorage.setItem(PREFS_KEY, JSON.stringify({ exterior, interior })); } catch { /* private browser */ }
    }, [exterior, interior]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf3f4f1);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a80, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(-10, 25, 12);
        scene.add(sun);
        const s = geometry.site;
        const cx = m(s.x1 + s.x2) / 2, cz = -m(s.y1 + s.y2) / 2, span = Math.max(m(s.x2 - s.x1), m(s.y2 - s.y1));
        const plot = new THREE.Mesh(new THREE.PlaneGeometry(m(s.x2 - s.x1), m(s.y2 - s.y1)),
            new THREE.MeshStandardMaterial({ color: 0xdfe3d6, roughness: 1 }));
        plot.rotation.x = -Math.PI / 2;
        plot.position.set(cx, -SLAB_M - PLINTH_M - 0.01, cz);
        scene.add(plot);
        scene.add(northArrow(geometry));
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
        const topM = Math.max(...geometry.levels.map(l => m(l.elevationMm + l.storeyHeightMm)));
        // Frame the whole plot and building even in the narrow studio side panel;
        // the camera looks from the front (road side) corner.
        const views = {
            exterior: () => ({ pos: [cx + span * 1.2, topM * 0.6 + span * 0.55, cz + span * 1.75], target: [cx, topM / 2.2, cz] }),
            // above the chosen floor, looking down into its rooms
            interior: index => { const z = m(geometry.levels[index]?.elevationMm || 0);
                return { pos: [cx + span * 0.35, z + span * 1.25, cz + span * 0.85], target: [cx, z, cz - span * 0.05] }; },
        };
        camera.position.set(...views.exterior().pos);
        const controls = new OrbitControls(camera, canvas);
        controls.target.set(...views.exterior().target);
        controls.update();
        const model = { current: null };
        let raf = 0;
        const fit = () => {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()))) {
                renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
            }
        };
        const draw = () => { raf = 0; fit(); renderer.render(scene, camera); };
        const request = () => { if (!raf) raf = requestAnimationFrame(draw); };
        controls.addEventListener('change', request);
        const ro = new ResizeObserver(request);
        ro.observe(canvas);
        const swap = group => {
            if (model.current) { scene.remove(model.current); model.current.traverse(o => o.geometry?.dispose()); }
            model.current = group; scene.add(group);
        };
        let current = null;
        stage.current = {
            show(index, opts) { current = { index, opts }; swap(buildModel(geometry, index, opts)); request(); },
            view(name, level = 0) { const v = views[name](level); camera.position.set(...v.pos); controls.target.set(...v.target); controls.update(); request(); },
            // Render each scheme from a fixed camera and return thumbnails (data URLs).
            snapshot(list, view, level = 0) {
                const keep = { pos: camera.position.clone(), target: controls.target.clone() };
                const v = views[view](level);
                camera.position.set(...v.pos); controls.target.set(...v.target); controls.update(); fit();
                const shots = list.map(({ index, opts }) => { swap(buildModel(geometry, index, opts)); renderer.render(scene, camera);
                    return canvas.toDataURL('image/jpeg', 0.85); });
                camera.position.copy(keep.pos); controls.target.copy(keep.target); controls.update();
                if (current) swap(buildModel(geometry, current.index, current.opts));
                request();
                return shots;
            },
        };
        return () => {
            cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
            scene.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(mt => mt.dispose()); });
            renderer.dispose();
            stage.current = null;
        };
    }, [geometry]);

    useEffect(() => { stage.current?.show(upTo, { exterior, interior, seeThrough }); }, [geometry, upTo, exterior, interior, seeThrough]);

    const openGallery = kind => {
        setBusy(true);
        // let the "rendering…" state paint before the synchronous renders
        setTimeout(() => {
            const schemes = kind === 'exterior' ? EXTERIOR_SCHEMES : INTERIOR_SCHEMES;
            const list = schemes.map(sc => ({ index: kind === 'exterior' ? geometry.levels.length - 1 : upTo,
                opts: kind === 'exterior' ? { exterior: sc.id, interior, seeThrough: false } : { exterior, interior: sc.id, seeThrough: true } }));
            const shots = stage.current?.snapshot(list, kind, upTo) || [];
            setGallery({ kind, items: schemes.map((sc, i) => ({ ...sc, src: shots[i] })) });
            setBusy(false);
        }, 30);
    };
    const pick = (kind, id) => {
        if (kind === 'exterior') { setExterior(id); setSeeThrough(false); stage.current?.view('exterior'); }
        else { setInterior(id); setSeeThrough(true); stage.current?.view('interior', upTo); }
    };

    const counts = geometry.findings.reduce((acc, f) => ((acc[f.code] = (acc[f.code] || 0) + 1), acc), {});
    const ext = exteriorScheme(exterior), int = interiorScheme(interior);
    const swatch = c => <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, background: c, border: '1px solid #0002', verticalAlign: 'middle', marginRight: 2 }}/>;
    return <div style={{ marginTop: 12 }}>
        <p role="note" style={{ fontSize: 12, padding: 8, borderRadius: 6, background: 'var(--control-bg, #fff6e5)', border: '1px solid var(--control-edge)' }}>
            Study massing of <strong>{geometry.id}</strong>. Not a floor plan, permit drawing or engineered model.
            Still unverified: {geometry.unverified.join(', ')}.
        </p>
        <canvas ref={canvasRef} data-testid="nepal-3d" aria-label={`3D study massing of ${geometry.id}`}
            style={{ width: '100%', height: 360, display: 'block', borderRadius: 8, touchAction: 'none' }}/>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, margin: '10px 0' }}>
            <label style={{ display: 'grid', gap: 5 }}>{seeThrough ? 'Floor to look into' : 'Show floors up to'}
                <select value={upTo} onChange={e => { setUpTo(Number(e.target.value)); if (seeThrough) stage.current?.view('interior', Number(e.target.value)); }}>
                    {geometry.levels.map((l, i) => <option key={l.id} value={i}>{l.id}</option>)}
                </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={seeThrough} onChange={e => { setSeeThrough(e.target.checked); stage.current?.view(e.target.checked ? 'interior' : 'exterior', upTo); }}/>
                Look inside the chosen floor (ceiling off)
            </label>
            <label style={{ display: 'grid', gap: 5 }}>Outside colours
                <select value={exterior} onChange={e => pick('exterior', e.target.value)}>
                    {EXTERIOR_SCHEMES.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
            </label>
            <label style={{ display: 'grid', gap: 5 }}>Inside wall colours
                <select value={interior} onChange={e => pick('interior', e.target.value)}>
                    {INTERIOR_SCHEMES.map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                </select>
            </label>
        </div>
        <p style={{ fontSize: 12, margin: '0 0 8px' }}>
            {swatch(ext.wall)}{swatch(ext.band)}{swatch(ext.trim)} {ext.note}. Inside: {int.note}.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="studio-btn" disabled={busy} onClick={() => openGallery('exterior')}>{busy ? 'Rendering…' : 'Compare all outside colours'}</button>
            <button type="button" className="studio-btn" disabled={busy} onClick={() => openGallery('interior')}>{busy ? 'Rendering…' : 'Compare all inside colours'}</button>
        </div>
        {gallery && <div role="region" aria-label={`${gallery.kind} colour gallery`} style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <strong>{gallery.kind === 'exterior' ? 'Outside colour schemes' : `Inside colour schemes (${geometry.levels[upTo].id})`} — click one to use it</strong>
                <button type="button" className="studio-btn" onClick={() => setGallery(null)}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 6 }}>
                {gallery.items.map(item => {
                    const chosen = (gallery.kind === 'exterior' ? exterior : interior) === item.id;
                    return <button key={item.id} type="button" onClick={() => pick(gallery.kind, item.id)} aria-pressed={chosen}
                        style={{ padding: 4, textAlign: 'left', borderRadius: 6, cursor: 'pointer', background: 'var(--chip-bg, #fff)',
                            border: chosen ? '2px solid #1f6f43' : '1px solid var(--control-edge)' }}>
                        {item.src && <img src={item.src} alt={`${item.name} colour scheme`} style={{ width: '100%', display: 'block', borderRadius: 4 }}/>}
                        <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{item.name}{chosen ? ' ✓' : ''}</div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>{item.note}</div>
                    </button>;
                })}
            </div>
        </div>}
        <details><summary style={{ fontSize: 12 }}>Findings on this hypothesis ({geometry.findings.length})</summary>
            <ul style={{ fontSize: 12 }}>{Object.entries(counts).map(([code, n]) => <li key={code}>{code}{n > 1 ? ` ×${n}` : ''}</li>)}</ul>
        </details>
    </div>;
}
