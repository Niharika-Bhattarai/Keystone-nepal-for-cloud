import React, { useEffect, useRef } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStage, reducedMotion } from './three-kit.js';

/* A study model built from the engine's real plan geometry: rooms become
   floors, room edges become walls, and walls are cut where the plan puts
   doors (full height gap below a header) and windows (sill, glass, head).
   It is a preview, not a BIM model: no roof, no stair treads, 9 ft storeys.

   Accepts the compact story format ({ levels: [{ w, h, rooms: [{ t, x, y,
   w, h }], doors, windows }] }) or a planSpec straight from the studio. */

const FLOOR = {
    kitchen: '#D9BE92', dining_room: '#C9A46E', living_room: '#C9A46E', family_room: '#C9A46E', great_room: '#C9A46E',
    garage: '#A9AFB5', stairs: '#B8905C', hallway: '#D6C7AA', entry: '#BDB3A3', foyer: '#BDB3A3',
    bathroom: '#A9C4D1', primary_bathroom: '#A9C4D1', powder_room: '#A9C4D1', half_bath: '#A9C4D1', laundry: '#A9C4D1', mudroom: '#BDB3A3',
    bedroom: '#D2B489', primary_bedroom: '#D2B489', study: '#C9A46E', office: '#C9A46E', storage: '#CFC6B6', closet: '#CFC6B6',
};

export function toHouseGeometry(plan) {
    const levels = (plan?.levels || []).map((l) => ({
        w: Number(l.w ?? l.width) || 0,
        h: Number(l.h ?? l.height) || 0,
        rooms: (l.rooms || []).map((r) => ({ t: String(r.t ?? r.type ?? ''), x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 })),
        doors: (l.doors || []).map((d) => ({ x: +d.x || 0, y: +d.y || 0, dir: d.dir, w: Number(d.w ?? d.width) || 3 })),
        windows: (l.windows || []).map((d) => ({ x: +d.x || 0, y: +d.y || 0, dir: d.dir || d.orientation, w: Number(d.w ?? d.width) || 3 })),
    })).filter((l) => l.w > 0 && l.h > 0 && l.rooms.length);
    return { levels };
}

export default function House3D({ geometry, progress = 1, controls = false, autoRotate = !controls, label = '3D study model of the plan', onApi }) {
    const ref = useRef(null);
    const api = useRef(null);

    useEffect(() => {
        const canvas = ref.current;
        const geo = toHouseGeometry(geometry);
        if (!canvas || !geo.levels.length) return undefined;
        let stage;
        try { stage = createStage(canvas, { shadows: true, exposure: 0.95 }); } catch { return undefined; }
        const { THREE, scene, camera, renderer } = stage;
        scene.environmentIntensity = 0.35;
        scene.add(new THREE.HemisphereLight('#f4f7fb', '#8f8472', 0.55));
        const sun = new THREE.DirectionalLight('#fff1dc', 2.8);
        sun.position.set(-45, 50, 25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60 }); sun.shadow.bias = -0.0005;
        scene.add(sun);

        const W = geo.levels[0].w, D = geo.levels[0].h, H = 9;
        const wallMat = new THREE.MeshStandardMaterial({ color: '#EFEBE3', roughness: 0.9 });
        const edgeMat = new THREE.LineBasicMaterial({ color: '#243042', transparent: true, opacity: 0.32 });
        const glassMat = new THREE.MeshPhysicalMaterial({ color: '#A9CBE0', roughness: 0.08, transmission: 0.55, transparent: true, opacity: 0.55, thickness: 0.2 });
        const levels = [];

        geo.levels.forEach((L) => {
            const group = new THREE.Group(), walls = new THREE.Group();
            group.add(walls);
            L.rooms.forEach((r) => {
                const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, r.w - 0.05), 0.25, Math.max(0.1, r.h - 0.05)),
                    new THREE.MeshStandardMaterial({ color: FLOOR[r.t] || '#E6DFD2', roughness: 0.9 }));
                m.position.set(r.x + r.w / 2 - W / 2, 0.125, r.y + r.h / 2 - D / 2);
                m.receiveShadow = true;
                group.add(m);
            });
            const lines = { h: new Map(), v: new Map() };
            const add = (map, k, a, b) => { const key = Math.round(k * 100) / 100; if (!map.has(key)) map.set(key, []); map.get(key).push([Math.min(a, b), Math.max(a, b)]); };
            L.rooms.forEach((r) => { add(lines.h, r.y, r.x, r.x + r.w); add(lines.h, r.y + r.h, r.x, r.x + r.w); add(lines.v, r.x, r.y, r.y + r.h); add(lines.v, r.x + r.w, r.y, r.y + r.h); });
            const merge = (arr) => { arr.sort((a, b) => a[0] - b[0]); const out = []; for (const s of arr) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + 0.01) l[1] = Math.max(l[1], s[1]); else out.push([...s]); } return out; };
            const cuts = (dir, k) => {
                const hit = (o) => (o.dir === 'horizontal') === (dir === 'h') && Math.abs((dir === 'h' ? o.y : o.x) - k) < 0.01;
                const span = (o, kind) => { const m = dir === 'h' ? o.x : o.y; return { a: m - o.w / 2, b: m + o.w / 2, kind }; };
                return [...L.doors.filter(hit).map((o) => span(o, 'door')), ...L.windows.filter(hit).map((o) => span(o, 'win'))].sort((x, y) => x.a - y.a);
            };
            const box = (dir, k, a, b, y0, y1, ext, mat) => {
                const len = b - a; if (len < 0.05 || y1 - y0 < 0.01) return;
                const t = ext ? 0.7 : 0.35;
                const g = dir === 'h' ? new THREE.BoxGeometry(len, y1 - y0, t) : new THREE.BoxGeometry(t, y1 - y0, len);
                const m = new THREE.Mesh(g, mat);
                const mid = (a + b) / 2;
                if (dir === 'h') m.position.set(mid - W / 2, (y0 + y1) / 2, k - D / 2); else m.position.set(k - W / 2, (y0 + y1) / 2, mid - D / 2);
                m.castShadow = mat === wallMat; m.receiveShadow = true;
                if (mat === wallMat) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat));
                walls.add(m);
            };
            for (const dir of ['h', 'v']) for (const [k, arr] of lines[dir]) {
                const ext = dir === 'h' ? (k === 0 || k === L.h) : (k === 0 || k === L.w);
                for (const [a, b] of merge(arr)) {
                    let cur = a;
                    for (const c of cuts(dir, k)) {
                        if (c.b <= a || c.a >= b) continue;
                        box(dir, k, cur, Math.max(cur, c.a), 0, H, ext, wallMat);
                        const ca = Math.max(a, c.a), cb = Math.min(b, c.b);
                        if (c.kind === 'door') box(dir, k, ca, cb, 7, H, ext, wallMat);
                        else { box(dir, k, ca, cb, 0, 3, ext, wallMat); box(dir, k, ca, cb, 7, H, ext, wallMat); box(dir, k, ca, cb, 3, 7, false, glassMat); }
                        cur = Math.max(cur, c.b);
                    }
                    box(dir, k, cur, b, 0, H, ext, wallMat);
                }
            }
            group.userData.walls = walls;
            scene.add(group);
            levels.push(group);
        });
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.ShadowMaterial({ opacity: 0.16 }));
        ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

        const span = Math.max(W, D);
        let orbit = null;
        if (controls) {
            orbit = new OrbitControls(camera, renderer.domElement);
            orbit.enableDamping = true;
            orbit.target.set(0, 10, 0);
            orbit.minDistance = span * 1.1; orbit.maxDistance = span * 6;
            orbit.maxPolarAngle = Math.PI * 0.47;
            camera.position.set(span * 2.2, span * 1.75, span * 2.4);
            orbit.update();
        }

        const still = reducedMotion();
        let prog = still ? 1 : progress, angle = 0.9;
        const place = () => {
            const rise = Math.min(1, prog * 1.6);
            const lift = Math.max(0, Math.min(1, (prog - 0.35) / 0.45));
            levels.forEach((g, i) => {
                g.userData.walls.scale.y = Math.max(0.001, i === 0 ? rise : Math.min(1, lift * 1.2));
                g.visible = i === 0 || lift > 0;
                g.position.y = i === 0 ? 0 : (H + 7) * i + (1 - lift) * 14;
            });
        };
        place();

        api.current = { setProgress(p) { prog = still ? 1 : Math.max(0, Math.min(1, p)); place(); angle = 0.55 + prog * 0.9; } };
        onApi?.(api.current);
        stage.onFrame(() => {
            if (orbit) { orbit.update(); return; }
            if (autoRotate && !still) angle += 0.0016;
            const R = span * 2.8 * Math.max(1, 1.05 / camera.aspect);
            camera.position.set(Math.cos(angle) * R, R * 0.62, Math.sin(angle) * R);
            camera.lookAt(0, 10, 0);
        });

        return () => { orbit?.dispose(); api.current = null; stage.dispose(); };
    }, [geometry, controls, autoRotate]);

    useEffect(() => { api.current?.setProgress(progress); }, [progress]);

    return <canvas ref={ref} role="img" aria-label={label} style={{ touchAction: controls ? 'none' : 'auto' }}/>;
}
