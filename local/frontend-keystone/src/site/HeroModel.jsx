import React, { useEffect, useRef } from 'react';
import { ArrowCounterClockwise, ArrowLineDown, Minus, Plus } from '@phosphor-icons/react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createStage, reducedMotion } from './three-kit.js';

/* The hero's photoreal model: the same plan as the drawing beside it, baked in
   Blender with the roof and ceilings left off (backend-keystone
   scripts/build-hero-model.js), so you look down into both floors.

   What you see is the bake alone: each surface's colour times its baked light (a
   lightmap, carried in the GLB as the occlusion map on the second UV set, or light
   stored per corner for furniture). No live lights touch the house, so it looks
   the same on every device. When it arrives, the upper floor lifts off the ground
   floor; then the model turns slowly.

   Controls: drag to turn it and tilt it (down to a view from directly above); pinch,
   Ctrl + wheel or the buttons to zoom; the arrow keys and + / - when it has focus.
   A plain mouse wheel still scrolls the page. After one full turn (or the first
   touch), onTurn fires once: the hero then offers the switch back to the floor plan. */

const LIFT = 3.0;         // metres the upper floor rises for a model baked stacked (older bakes)
const LIFT_MS = 1500;
const TURN = (Math.PI * 2) / 16; // radians per second: one turn in 16 s
const PITCH = { min: 0.06, max: 1.53, rest: 0.74 }; // radians above the horizon; 1.53 is from above
const ZOOM = { min: 0.42, max: 1.8 };                 // distance, as a share of the framed distance
const UPPER = /^(Level|Furniture)[ _]2/; // three.js turns "Level 2" into "Level_2"

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function bakedMaterial(THREE, mesh) {
    const m = mesh.material;
    const ex = m?.userData || {};
    const scale = ex.lightmapScale || 4;
    if (/Glass/.test(mesh.name) || /Glass/.test(mesh.parent?.name || '') || (m?.transparent && m.opacity < 0.9)) {
        return new THREE.MeshBasicMaterial({ color: '#CFE1EE', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    }
    if (ex.vertexLight) {
        return new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color.clone().multiplyScalar(scale), vertexColors: true, side: m.side });
    }
    if (m?.aoMap) {
        const lm = m.aoMap;
        lm.colorSpace = THREE.SRGBColorSpace;
        lm.channel = 1;
        lm.needsUpdate = true;
        return new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color, lightMap: lm, lightMapIntensity: scale, side: m.side });
    }
    return null; // unbaked pieces (the car) keep their material and the stage's light
}

export default function HeroModel({ src, run = 0, active = true, onState, onTurn, label = 'Photoreal 3D model of the same plan, roof off, upper floor lifted' }) {
    const ref = useRef(null);
    const api = useRef(null);
    const activeRef = useRef(active);
    activeRef.current = active;

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        let stage;
        try { stage = createStage(canvas, { fov: 24, exposure: 1 }); } catch { onState?.('error'); return undefined; }
        const { THREE, scene, camera } = stage;
        scene.environmentIntensity = 0.8;
        scene.add(new THREE.HemisphereLight('#f4f7fb', '#8f8472', 0.8));
        let alive = true;
        const still = reducedMotion();
        const pivot = new THREE.Group();
        scene.add(pivot);
        const upper = [];
        // Offsets of the upper floor from where it was loaded: closed (floors together)
        // and open (lifted). A cutaway bake is exported open, with the lift in its extras.
        let range = { closed: 0, open: LIFT };
        let lift = { start: 0 };
        let radius = 10, lastT = 0, idleAt = 0, turned = 0, told = false;
        const target = new THREE.Vector3();
        // Where the camera is (yaw, pitch, zoom) eases towards where it is asked to be.
        const view = { yaw: -0.62, pitch: PITCH.rest, zoom: 1 };
        const goal = { ...view };
        const clampGoal = () => {
            goal.pitch = Math.min(PITCH.max, Math.max(PITCH.min, goal.pitch));
            goal.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, goal.zoom));
        };
        const tell = () => { if (!told) { told = true; onTurn?.(); } };
        const touched = () => { idleAt = performance.now(); tell(); };

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        onState?.('loading');
        loader.load(src, (gltf) => {
            if (!alive) return;
            const model = gltf.scene;
            model.traverse((o) => {
                if (!o.isMesh) return;
                const baked = bakedMaterial(THREE, o);
                if (baked) { o.material.dispose?.(); o.material = baked; }
            });
            for (const child of model.children) if (UPPER.test(child.name)) upper.push(child);
            const baked = Number(model.userData?.keystoneLift) || 0;
            range = baked > 0 ? { closed: -baked, open: 0 } : { closed: 0, open: LIFT };
            // Centre the house on the pivot at ground level.
            const box = new THREE.Box3().setFromObject(model);
            const c = box.getCenter(new THREE.Vector3());
            model.position.set(-c.x, -box.min.y, -c.z);
            pivot.add(model);
            // A soft contact shadow so the house sits on the page.
            const g = document.createElement('canvas'); g.width = g.height = 128;
            const x = g.getContext('2d'); const grd = x.createRadialGradient(64, 64, 8, 64, 64, 64);
            grd.addColorStop(0, 'rgba(15,20,32,0.42)'); grd.addColorStop(1, 'rgba(15,20,32,0)');
            x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
            const size = box.getSize(new THREE.Vector3());
            const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 1.5, size.z * 1.5),
                new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(g), transparent: true, depthWrite: false }));
            shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.02;
            pivot.add(shadow);
            // Frame the lifted house by its bounding sphere, whatever the pane's shape.
            const h = size.y + (baked > 0 ? 0 : LIFT);
            radius = 0.5 * Math.hypot(size.x, h, size.z);
            target.set(0, h * 0.5, 0);
            lift = { start: performance.now() + 250 };
            onState?.('ready');
        }, undefined, () => { if (alive) onState?.('error'); });

        const setUpper = (y) => { for (const n of upper) { n.userData.y0 ??= n.position.y; n.position.y = n.userData.y0 + y; } };
        api.current = {
            replay() { lift = { start: performance.now() + 150 }; },
            zoom(f) { goal.zoom *= f; clampGoal(); touched(); },
            top() { goal.pitch = goal.pitch > 1.3 ? PITCH.rest : PITCH.max; touched(); },
            reset() { goal.pitch = PITCH.rest; goal.zoom = 1; touched(); },
        };

        // One pointer turns (and, with a mouse or pen, tilts); two pointers pinch to zoom
        // and tilt together. On touch the page keeps vertical scrolling (touch-action: pan-y).
        const pts = new Map();
        let pinch = null;
        const spread = () => {
            const [a, b] = [...pts.values()];
            return { d: Math.hypot(a.x - b.x, a.y - b.y), y: (a.y + b.y) / 2 };
        };
        const down = (e) => {
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
            canvas.setPointerCapture?.(e.pointerId);
            pinch = pts.size === 2 ? spread() : null;
            touched();
        };
        const move = (e) => {
            const p = pts.get(e.pointerId);
            if (!p) return;
            const dx = e.clientX - p.x, dy = e.clientY - p.y;
            p.x = e.clientX; p.y = e.clientY;
            if (pts.size === 1) {
                goal.yaw -= dx * 0.008;
                if (p.type !== 'touch') goal.pitch += dy * 0.006;
            } else if (pts.size === 2 && pinch) {
                const now = spread();
                if (now.d > 0 && pinch.d > 0) goal.zoom *= pinch.d / now.d;
                goal.pitch += (now.y - pinch.y) * 0.006;
                pinch = now;
            }
            clampGoal();
            idleAt = performance.now();
        };
        const up = (e) => { pts.delete(e.pointerId); pinch = pts.size === 2 ? spread() : null; idleAt = performance.now(); };
        // Ctrl + wheel (a trackpad pinch arrives as one) zooms; a plain wheel scrolls the page.
        const wheel = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            goal.zoom *= Math.exp(e.deltaY * 0.01); clampGoal(); touched();
        };
        const key = (e) => {
            const k = e.key;
            if (k === 'ArrowLeft') goal.yaw += 0.2;
            else if (k === 'ArrowRight') goal.yaw -= 0.2;
            else if (k === 'ArrowUp') goal.pitch += 0.12;
            else if (k === 'ArrowDown') goal.pitch -= 0.12;
            else if (k === '+' || k === '=') goal.zoom /= 1.2;
            else if (k === '-' || k === '_') goal.zoom *= 1.2;
            else return;
            e.preventDefault(); clampGoal(); touched();
        };
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('lostpointercapture', up);
        canvas.addEventListener('wheel', wheel, { passive: false });
        canvas.addEventListener('keydown', key);

        stage.onFrame(() => {
            const now = performance.now();
            const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0; lastT = now;
            if (lift.start) {
                const t = Math.min(1, Math.max(0, (now - lift.start) / LIFT_MS));
                setUpper(still ? range.open : range.closed + (range.open - range.closed) * easeOut(t));
            }
            const shown = activeRef.current, settled = lift.start && now > lift.start + LIFT_MS;
            if (shown && settled && still) tell();
            if (shown && settled && !still && !pts.size && now - idleAt > 2500) {
                goal.yaw += TURN * dt; turned += TURN * dt;
                if (turned >= Math.PI * 2) tell();
            }
            const k = still ? 1 : 1 - Math.pow(0.001, dt || 0.016);
            view.yaw += (goal.yaw - view.yaw) * k;
            view.pitch += (goal.pitch - view.pitch) * k;
            view.zoom += (goal.zoom - view.zoom) * k;
            const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
            const dist = (radius / Math.sin(Math.min(vf, hf) / 2)) * 0.98 * view.zoom;
            const flat = Math.cos(view.pitch) * dist;
            camera.position.set(Math.sin(view.yaw) * flat, target.y + Math.sin(view.pitch) * dist, Math.cos(view.yaw) * flat);
            camera.near = dist / 50; camera.far = dist * 4; camera.updateProjectionMatrix();
            camera.lookAt(target);
        });

        return () => {
            alive = false;
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', up);
            canvas.removeEventListener('lostpointercapture', up);
            canvas.removeEventListener('wheel', wheel);
            canvas.removeEventListener('keydown', key);
            stage.dispose();
        };
    }, [src]); // eslint-disable-line react-hooks/exhaustive-deps -- onState and onTurn are notifications only

    useEffect(() => { if (run) api.current?.replay(); }, [run]);

    const tab = active ? 0 : -1;
    return (
        <>
            <canvas ref={ref} className="pg-hero-model" tabIndex={tab} style={{ touchAction: 'pan-y', cursor: 'grab' }} role="img"
                aria-label={`${label}. Drag to turn and tilt it; with focus, the arrow keys turn and tilt it and plus and minus zoom.`}/>
            <div className="pg-hero-3d-ctl" role="group" aria-label="3D view">
                <button type="button" className="iconbtn glassy" tabIndex={tab} onClick={() => api.current?.zoom(1 / 1.25)} aria-label="Zoom in"><Plus size={16} weight="bold" aria-hidden="true"/></button>
                <button type="button" className="iconbtn glassy" tabIndex={tab} onClick={() => api.current?.zoom(1.25)} aria-label="Zoom out"><Minus size={16} weight="bold" aria-hidden="true"/></button>
                <button type="button" className="iconbtn glassy" tabIndex={tab} onClick={() => api.current?.top()} aria-label="View from above"><ArrowLineDown size={16} weight="bold" aria-hidden="true"/></button>
                <button type="button" className="iconbtn glassy" tabIndex={tab} onClick={() => api.current?.reset()} aria-label="Reset the view"><ArrowCounterClockwise size={16} weight="bold" aria-hidden="true"/></button>
            </div>
        </>
    );
}
