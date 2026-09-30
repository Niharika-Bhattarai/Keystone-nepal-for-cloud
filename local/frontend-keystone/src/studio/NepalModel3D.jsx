import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* Study massing of a Nepal spatial hypothesis (POST /api/nepal/concepts,
   format: 'json'). Walls are extruded from the engine's solid wall segments, so
   door and window gaps are the reserved openings, not decoration. This is a
   review aid: it is not a floor plan, permit drawing or engineered model, and
   the banner and finding list below keep that visible.

   Axes: engine plan x -> three x, engine plan y -> three -z, height -> three y.
   Millimetres become metres. */

const SLAB_M = 0.15, SILL_M = 0.9, HEAD_M = 2.1, PARAPET_M = 1.0;
const ROOM_COLOURS = {
    livingRoom: 0xdfe8d8, kitchen: 0xf2dfc6, primaryBedroom: 0xd9e2ef, bedroom: 0xe3e8f2,
    guestBedroom: 0xd8e9e6, bathroom: 0xe6e1dc, puja: 0xf3e3a8, primaryAlcove: 0xdde4ee,
    livingAnnex: 0xe1e8da, diningAnnex: 0xefe4d0, utilityFlex: 0xe2e8e4, serviceNiche: 0xe2e8e4,
};

const m = mm => mm / 1000;

function block(group, box, y0, y1, material) {
    const w = m(box.x2 - box.x1), d = m(box.y2 - box.y1), h = y1 - y0;
    if (w <= 0 || d <= 0 || h <= 0) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(m(box.x1) + w / 2, y0 + h / 2, -(m(box.y1) + d / 2));
    group.add(mesh);
}

function buildModel(geometry, upToIndex) {
    const group = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
    const extMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.9 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.95 });
    const colMat = new THREE.MeshStandardMaterial({ color: 0x5b6468, roughness: 0.8 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x9fb4bd, transparent: true, opacity: 0.35 });
    const roomMats = {};
    const roomMat = type => roomMats[type] ||= new THREE.MeshStandardMaterial({ color: ROOM_COLOURS[type] || 0xe7e7e2, roughness: 1 });
    geometry.levels.slice(0, upToIndex + 1).forEach(level => {
        const z0 = m(level.elevationMm), top = z0 + m(level.storeyHeightMm);
        for (const slab of level.slabs) block(group, slab, z0 - SLAB_M, z0, slabMat);
        for (const room of level.rooms) block(group, room.clearBox || room.box, z0, z0 + 0.02, roomMat(room.type));
        for (const wall of level.walls) {
            const mat = wall.kind === 'exterior' ? extMat : wallMat;
            for (const solid of wall.solidBoxes) block(group, solid, z0, top - SLAB_M, mat);
            for (const opening of wall.openings) {
                if (opening.kind === 'window') block(group, opening.box, z0, z0 + SILL_M, mat);
                block(group, opening.box, z0 + HEAD_M, top - SLAB_M, mat);
            }
        }
        if (!level.walls.length) {
            // Terrace floor without placed rooms: 1 m parapet line only (enclosure unverified).
            for (const s of level.slabs) {
                const t = 229;
                for (const edge of [{ ...s, y2: s.y1 + t }, { ...s, y1: s.y2 - t }, { ...s, x2: s.x1 + t }, { ...s, x1: s.x2 - t }])
                    block(group, edge, z0, z0 + PARAPET_M, extMat);
            }
        }
        for (const c of geometry.columns) {
            const inside = level.slabs.some(s => c.xMm > s.x1 && c.xMm < s.x2 && c.yMm > s.y1 && c.yMm < s.y2);
            if (!inside) continue;
            const h = c.widthMm / 2;
            block(group, { x1: c.xMm - h, y1: c.yMm - h, x2: c.xMm + h, y2: c.yMm + h }, z0, top - SLAB_M, colMat);
        }
        if (geometry.core.levelIds.includes(level.id)) block(group, geometry.core.box, z0 + 0.03, top - SLAB_M, coreMat);
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

export default function NepalModel3D({ geometry }) {
    const canvasRef = useRef(null);
    const stage = useRef(null);
    const [upTo, setUpTo] = useState(geometry.levels.length - 1);

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
        plot.position.set(cx, -SLAB_M - 0.01, cz);
        scene.add(plot);
        scene.add(northArrow(geometry));
        const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
        const topM = Math.max(...geometry.levels.map(l => m(l.elevationMm + l.storeyHeightMm)));
        // Frame the whole plot and building even in the narrow studio side panel.
        camera.position.set(cx + span * 1.9, topM + span * 1.5, cz + span * 2.2);
        const controls = new OrbitControls(camera, canvas);
        controls.target.set(cx, topM / 2.5, cz);
        controls.update();
        const model = { current: null };
        let raf = 0;
        const draw = () => {
            raf = 0;
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()))) {
                renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
            }
            renderer.render(scene, camera);
        };
        const request = () => { if (!raf) raf = requestAnimationFrame(draw); };
        controls.addEventListener('change', request);
        const ro = new ResizeObserver(request);
        ro.observe(canvas);
        stage.current = {
            show(index) {
                if (model.current) {
                    scene.remove(model.current);
                    model.current.traverse(o => o.geometry?.dispose());
                }
                model.current = buildModel(geometry, index);
                scene.add(model.current);
                request();
            },
        };
        return () => {
            cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
            scene.traverse(o => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach(mt => mt.dispose()); });
            renderer.dispose();
            stage.current = null;
        };
    }, [geometry]);

    useEffect(() => { stage.current?.show(upTo); }, [geometry, upTo]);

    const counts = geometry.findings.reduce((acc, f) => ((acc[f.code] = (acc[f.code] || 0) + 1), acc), {});
    return <div style={{ marginTop: 12 }}>
        <p role="note" style={{ fontSize: 12, padding: 8, borderRadius: 6, background: 'var(--control-bg, #fff6e5)', border: '1px solid var(--control-edge)' }}>
            Study massing of <strong>{geometry.id}</strong>. Not a floor plan, permit drawing or engineered model.
            Still unverified: {geometry.unverified.join(', ')}.
        </p>
        <canvas ref={canvasRef} data-testid="nepal-3d" aria-label={`3D study massing of ${geometry.id}`}
            style={{ width: '100%', height: 360, display: 'block', borderRadius: 8, touchAction: 'none' }}/>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, margin: '10px 0' }}>Show floors up to
            <select value={upTo} onChange={e => setUpTo(Number(e.target.value))}>
                {geometry.levels.map((l, i) => <option key={l.id} value={i}>{l.id}</option>)}
            </select>
        </label>
        <details><summary style={{ fontSize: 12 }}>Findings on this hypothesis ({geometry.findings.length})</summary>
            <ul style={{ fontSize: 12 }}>{Object.entries(counts).map(([code, n]) => <li key={code}>{code}{n > 1 ? ` ×${n}` : ''}</li>)}</ul>
        </details>
    </div>;
}
