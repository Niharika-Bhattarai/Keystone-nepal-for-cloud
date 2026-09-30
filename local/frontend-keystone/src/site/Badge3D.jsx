import React, { useEffect, useRef } from 'react';
import { createStage, reducedMotion } from './three-kit.js';
import { MARK } from '../data/keystoneMark.js';

/* The Keystone AI mark as an object: a glass slab carrying the arch in ceramic,
   locked by a brass keystone. Drag to turn it; otherwise it drifts. */
export default function Badge3D({ distance = 96 }) {
    const ref = useRef(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return undefined;
        let stage;
        try { stage = createStage(canvas); } catch { return undefined; }
        const { THREE, scene, camera } = stage;

        const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(-8, 14, 12); scene.add(key);
        const rim = new THREE.DirectionalLight('#9CC4E8', 1.6); rim.position.set(10, 4, -10); scene.add(rim);
        const g = new THREE.Group(); scene.add(g);

        const rounded = (w, h, r) => {
            const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
            s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
            s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
            s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
            return s;
        };
        const slab = new THREE.ExtrudeGeometry(rounded(30, 30, 8), { depth: 3, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 6, curveSegments: 24 });
        slab.translate(0, 0, -3);
        g.add(new THREE.Mesh(slab, new THREE.MeshPhysicalMaterial({
            color: '#D6E7F4', roughness: 0.06, transmission: 1, thickness: 3, ior: 1.45, iridescence: 0.25,
            clearcoat: 1, clearcoatRoughness: 0.05, attenuationColor: '#6FA3CC', attenuationDistance: 14,
        })));

        // The Keystone AI mark as an object: ceramic stones on the glass slab and a
        // brass keystone that drops into the crown when the badge first appears.
        // Same 32-unit geometry as the flat mark (src/data/keystoneMark.js).
        const ceramic = new THREE.MeshPhysicalMaterial({ color: '#FBFAF7', roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
        const brass = new THREE.MeshPhysicalMaterial({ color: '#C9A15A', metalness: 0.85, roughness: 0.28, clearcoat: 0.4 });
        const H = 5.5;
        const stone = (points, mat) => {
            const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x - 16, 16 - y)));
            return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.22, bevelSegments: 3 }), mat);
        };
        for (const pts of MARK.piers) g.add(stone(pts, ceramic));
        for (const v of MARK.voussoirs) g.add(stone(v.points, ceramic));
        const keystone = stone(MARK.key, brass);
        g.add(keystone);
        let keyY = reducedMotion() ? 0 : MARK.keyDrop * 1.6, keyV = 0;

        g.rotation.x = -0.5;
        let drag = false, lx = 0, ly = 0, spin = 0, tilt = 0, hover = 0, t = 0;
        const still = reducedMotion();
        const down = (e) => { drag = true; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture?.(e.pointerId); };
        const move = (e) => {
            if (drag) { spin += (e.clientX - lx) * 0.01; tilt += (e.clientY - ly) * 0.004; lx = e.clientX; ly = e.clientY; }
            else { const b = canvas.getBoundingClientRect(); hover = ((e.clientX - b.left) / b.width - 0.5) * 0.5; }
        };
        const up = () => { drag = false; };
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('lostpointercapture', up);

        stage.onFrame(() => {
            camera.position.set(0, 0, distance * Math.max(1, 1 / camera.aspect));
            camera.lookAt(0, 0, 0);
            if (!still) t += 0.01;
            // The keystone falls into the crown and settles (a light spring).
            if (keyY !== 0 || keyV !== 0) { keyV = (keyV - keyY * 0.08) * 0.78; keyY += keyV; if (Math.abs(keyY) < 0.01 && Math.abs(keyV) < 0.01) { keyY = 0; keyV = 0; } keystone.position.y = keyY; }
            g.rotation.y += ((Math.sin(t * 0.6) * 0.45 + hover + spin) - g.rotation.y) * 0.06;
            g.rotation.x += ((-0.55 + Math.sin(t * 0.4) * 0.08 + tilt) - g.rotation.x) * 0.06;
        });

        return () => {
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', up);
            canvas.removeEventListener('lostpointercapture', up);
            stage.dispose();
        };
    }, [distance]);

    return <canvas ref={ref} style={{ touchAction: 'pan-y', cursor: 'grab' }} aria-label="The Keystone AI mark in 3D. Drag to turn it." role="img"/>;
}
