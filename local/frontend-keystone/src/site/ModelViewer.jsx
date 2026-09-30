import React, { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, ArrowDown, ArrowUp, HouseSimple, Minus, Plus } from '@phosphor-icons/react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Ray } from '@babylonjs/core/Culling/ray';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { CreateScreenshotUsingRenderTargetAsync } from '@babylonjs/core/Misc/screenshotTools';
import '@babylonjs/core/Collisions/collisionCoordinator';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent';
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/loaders/glTF/2.0';
import { attachNav } from './viewerNav';
import { modelGroup, modelGroupVisible } from './modelVisibility';
import { applySurfaceDetail } from './viewerTextures';

/* Viewer for the house model the backend builds (GLB). Babylon is used for
   its built-in first-person collisions and gravity, which is what makes the
   walkthrough work: you cannot walk through walls and you climb the stairs.
   Orbit, a level-by-level cutaway, a high-resolution image and the GLB itself
   are available from the toolbar. The roof is left off: the quick model's roof
   is not good enough to show yet (the photoreal bake has its own).

   Quality is the device's own work, chosen for what it can carry:
   - high (WebGL2, a desktop-class device): ambient occlusion (SSAO2) darkens
     corners, floors under furniture and wall junctions; soft filtered shadows
     at 4096 px; multisample and FXAA anti-aliasing; at most 1.5 device pixels
     per CSS pixel.
   - standard (phones, small GPUs): the lighter shadows and no post-processing.
   While the view moves, frame times are watched: if they run slower than about
   38 frames a second it drops the occlusion first, then the post-processing.
   The sun and the house never move, so the shadow map is drawn once and again
   only when the shown levels change.

   The viewer draws only while something happens. Babylon applies drags, wheel
   steps and camera coasting inside a draw, so it must never wait for the camera
   to move by itself (it did, and then ignored input once it had rested): any
   pointer, wheel, key or gesture on the canvas wakes it; it keeps drawing while
   a pointer is held, the camera coasts or a zoom animates, and in walk mode.
   localStorage 'keystone:quality' = 'high' | 'standard' forces one and never steps down.
   The photoreal model (a server bake) is the next step up. */

function pickQuality(engine) {
  try { const forced = localStorage.getItem('keystone:quality'); if (forced === 'high' || forced === 'standard') return forced; } catch { /* no storage */ }
  const webgl2 = engine.webGLVersion >= 2;
  const small = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  const memory = navigator.deviceMemory ?? 8, cores = navigator.hardwareConcurrency ?? 4;
  return webgl2 && !small && memory >= 4 && cores >= 4 ? 'high' : 'standard';
}

function readGlbExtras(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) return null;
    const len = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, len)));
    return json.scenes?.[0]?.extras || null;
  } catch { return null; }
}

const EYE = 1.62; // meters

export default function ModelViewer({ glb, label = '3D model of the house', onReady, allowDownloads = false }) {
  const canvasRef = useRef(null);
  const ctl = useRef(null);
  const [mode, setMode] = useState('orbit');
  const [levelsShown, setLevelsShown] = useState(99);
  const roof = false; // the quick model's roof stays off for now
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [touch] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
  const visibility = useRef({ upTo: levelsShown, roof });
  visibility.current = { upTo: levelsShown, roof };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !glb) return undefined;
    let disposed = false;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, adaptToDeviceRatio: true, antialias: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    // Filmic tone mapping, as in the photoreal viewer, keeps light walls, floors
    // and the ground from clipping to white.
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.0;
    ip.contrast = 1.1;
    scene.collisionsEnabled = true;
    scene.skipPointerMovePicking = true; // nothing listens to hover picks, and each costs a scene pick per mouse move
    scene.gravity = new Vector3(0, -0.15, 0); // per frame; stronger pins the collider below stair risers

    const extras = readGlbExtras(glb);
    setMeta(extras);
    const span = Math.max(extras?.footprint?.width || 13, extras?.footprint?.depth || 10);
    const topY = Math.max(...(extras?.levels || [{ ceilingY: 3 }]).map((l) => l.ceilingY), 3);

    const hemi = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
    hemi.intensity = 0.95;
    hemi.groundColor = new Color3(0.42, 0.43, 0.4);
    const sun = new DirectionalLight('sun', new Vector3(-0.55, -1, 0.35), scene);
    sun.position = new Vector3(span * 1.2, span * 2, -span);
    sun.intensity = 1.9;
    let quality = pickQuality(engine);
    let forced = false;
    try { forced = ['high', 'standard'].includes(localStorage.getItem('keystone:quality')); } catch { /* no storage */ }
    const shadows = new ShadowGenerator(quality === 'high' ? 4096 : 2048, sun);
    const shadowMap = shadows.getShadowMap();
    if (quality === 'high') {
        shadows.usePercentageCloserFiltering = true;
        shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
        shadows.bias = 0.0006; shadows.normalBias = 0.02;
        shadows.darkness = 0.3;
    } else {
        shadows.useBlurExponentialShadowMap = true;
        shadows.blurKernel = 24;
        shadows.darkness = 0.35;
    }

    const ground = CreateGround('ground', { width: span * 12, height: span * 12 }, scene);
    ground.position.y = -0.16;
    const gm = new StandardMaterial('groundMat', scene);
    gm.diffuseColor = new Color3(0.34, 0.4, 0.32); // a muted lawn in sun and shade, so the house and controls read against it
    gm.specularColor = new Color3(0, 0, 0);
    ground.material = gm;
    ground.receiveShadows = true;
    ground.checkCollisions = true;

    const orbit = new ArcRotateCamera('orbit', -Math.PI / 3, 1.05, span * 2.3, new Vector3(0, topY / 2, 0), scene);
    orbit.lowerRadiusLimit = 1.5; // close enough to look into a room
    orbit.upperRadiusLimit = span * 6;
    orbit.upperBetaLimit = Math.PI / 2 - 0.05;
    orbit.wheelDeltaPercentage = 0.02;
    orbit.pinchDeltaPercentage = 0.004;
    orbit.useNaturalPinchZoom = true; // a pinch zooms exactly as far as the fingers spread
    orbit.panningSensibility = 400;
    orbit.minZ = 0.05;
    orbit.attachControl(canvas, true);
    scene.activeCamera = orbit;

    const walk = new UniversalCamera('walk', new Vector3(0, EYE, 0), scene);
    walk.minZ = 0.03;
    walk.fov = 1.1;
    walk.speed = 0.09;
    walk.angularSensibility = 2600;
    walk.inertia = 0.6;
    // Babylon hangs the collider below the eye: an ellipsoid of half-height
    // EYE/2 reaches exactly from the floor to eye level. Its rounded bottom
    // is what lets it glide up stair risers. 0.35 m across keeps the eye a
    // step back from walls (a 3 ft doorway still passes).
    walk.ellipsoid = new Vector3(0.35, EYE / 2, 0.35);
    walk.checkCollisions = true;
    walk.applyGravity = true;
    walk.keysUp.push(87); walk.keysDown.push(83); walk.keysLeft.push(65); walk.keysRight.push(68); // WASD
    const nav = attachNav({ scene, canvas, orbit, walk });

    // High quality: occlusion and anti-aliasing on both cameras (see the note above).
    let ssao = null, post = null;
    const cameras = [orbit, walk];
    if (quality === 'high') engine.setHardwareScalingLevel(1 / Math.min(1.5, window.devicePixelRatio || 1));
    // One step down: the occlusion first (the dearest), then the post-processing.
    const stepDown = () => {
        if (ssao) { ssao.dispose(); ssao = null; quality = 'medium'; }
        else { post?.dispose(); post = null; quality = 'standard'; }
        if (ctl.current) ctl.current.quality = quality;
    };
    if (quality === 'high') {
        try {
            ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.75, blurRatio: 1 }, cameras, true);
            ssao.radius = 0.7; ssao.totalStrength = 1.1; ssao.samples = 16; ssao.base = 0.12; // 0.7 m: contact shading, not a smear under wall cabinets
            ssao.expensiveBlur = true; ssao.maxZ = span * 8; ssao.minZAspect = 0.4;
            post = new DefaultRenderingPipeline('post', true, scene, cameras);
            post.samples = 4; post.fxaaEnabled = true;
            post.imageProcessingEnabled = true;
            post.imageProcessing.toneMappingEnabled = true;
            post.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
            post.imageProcessing.exposure = 0.96; post.imageProcessing.contrast = 1.2;
        } catch { stepDown(); }
    }

    // Draw on demand (see the note above). `wake` keeps drawing for IDLE_MS.
    const IDLE_MS = 600, WARM_MS = 1500;
    let wokeAt = performance.now(), loadedAt = 0, drew = false, settle = 0;
    const held = new Set();
    const wake = () => { wokeAt = performance.now(); };
    orbit.onViewMatrixChangedObservable.add(wake);
    walk.onViewMatrixChangedObservable.add(wake);
    const ro2 = new ResizeObserver(wake); ro2.observe(canvas);
    const onDown = (e) => { held.add(e.pointerId); wake(); };
    const onUp = (e) => { held.delete(e.pointerId); wake(); };
    const onMove = (e) => { if (e.buttons || held.size) wake(); };
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointermove', onMove, { passive: true });
    const inputs = ['wheel', 'keydown', 'keyup', 'gesturestart', 'gesturechange', 'touchstart', 'touchmove'];
    for (const t of inputs) canvas.addEventListener(t, wake, { passive: true });
    const coasting = () => Math.abs(orbit.inertialAlphaOffset) + Math.abs(orbit.inertialBetaOffset) + Math.abs(orbit.inertialRadiusOffset) +
      Math.abs(orbit.inertialPanningX) + Math.abs(orbit.inertialPanningY) > 1e-6;
    // Frame times while moving (not the first frames after a pause, which include the pause).
    const recent = [];
    const tick = () => {
        const now = performance.now();
        const active = !loadedAt || now - loadedAt < WARM_MS || now - wokeAt < IDLE_MS || held.size > 0 ||
          coasting() || nav.busy() || scene.activeCamera !== orbit;
        if (!active) { drew = false; recent.length = 0; return; } // still: nothing to redraw
        if (!drew) settle = 3;
        drew = true;
        if (settle > 0) settle--;
        else if (quality !== 'standard' && !forced && loadedAt) {
            recent.push(engine.getDeltaTime());
            if (recent.length > 45) recent.shift();
            if (recent.length === 45 && recent.reduce((a, b) => a + b, 0) / 45 > 26) { stepDown(); recent.length = 0; settle = 10; }
        }
        scene.render();
    };

    const nodes = new Map(); // node name -> meshes
    let root = null; // glTF -> Babylon handedness flip; extras are in glTF space
    const toWorld = (x, y, z) => (root ? Vector3.TransformCoordinates(new Vector3(x, y, z), root.computeWorldMatrix(true)) : new Vector3(x, y, z));
    let alive = true;
    let running = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) { running = true; wake(); engine.runRenderLoop(tick); }
      else if (!e.isIntersecting && running) { running = false; engine.stopRenderLoop(); }
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    // ---- walking inside -------------------------------------------------------
    // Solid furniture: invisible boxes 2.2 m tall over each piece's footprint, so
    // the walk stops at a bed or a counter instead of riding up onto it (the
    // furniture's own meshes are not solid for that reason). Chairs, rugs, lamps
    // and plants stay walk-through.
    const SOLID = /^(bed|sofa|sectional|loveseat|dining_table|table|coffee_table|counter|kitchen_island|island|dresser|desk|bookcase|bookshelf|shelving|vanity|tub|bathtub|shower|washer|dryer|stacked_washer_dryer|refrigerator|stove|range|console|bench|car|nightstand|toy_storage|treadmill|laundry_counter)/;
    const colliders = [];
    const addColliders = () => {
      for (const f of extras?.furniture || []) {
        if (!SOLID.test(String(f.kind))) continue;
        const [cx, fy, cz] = f.center, [w, d] = f.size;
        const a = toWorld(cx - w / 2, fy, cz - d / 2), b = toWorld(cx + w / 2, fy, cz + d / 2);
        const box = CreateBox('walk-collider', { width: Math.abs(b.x - a.x), depth: Math.abs(b.z - a.z), height: 2.2 }, scene);
        box.position = new Vector3((a.x + b.x) / 2, Math.min(a.y, b.y) + 1.1, (a.z + b.z) / 2);
        box.isVisible = false; box.isPickable = false; box.checkCollisions = true;
        box.freezeWorldMatrix();
        colliders.push({ mesh: box, level: Number(f.level) || 1 });
      }
    };
    const solid = (m) => m.checkCollisions && m.isEnabled();
    const probe = (pos, yaw) => {
      const hit = scene.pickWithRay(new Ray(pos, new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 30), solid);
      return hit?.hit ? hit.distance : 30;
    };
    /* Where the walk starts: the most open spot of the main living spaces on the
       entry level (the living room, kitchen or dining room, their centre or toward
       an edge), off the furniture, facing across the room toward another living
       space; just inside the front door when there is none. Never against a wall
       or facing out of the open front door. */
    const startPose = () => {
      const e = extras?.entry;
      const floorY = e?.floorY || 0, lv = e?.level || 1;
      const eye = (x, z) => toWorld(x, floorY + EYE, z);
      const living = (extras?.rooms || []).filter((r) => r.level === lv && /living|great|family|dining|kitchen/.test(r.type));
      const centres = living.map((r) => eye(r.center[0], r.center[1]));
      const cands = [];
      for (const r of living) for (const [fx, fz] of [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
        const size = r.rect ? [Math.abs(r.rect[1] - r.rect[0]) * 0.3048, Math.abs(r.rect[3] - r.rect[2]) * 0.3048] : [3, 3]; // rect is in feet
        cands.push({ pos: eye(r.center[0] + fx * size[0], r.center[1] + fz * size[1]), inRoom: true });
      }
      if (e) for (const d of [1.2, 1.8, 2.4]) cands.push({ pos: eye(e.position[0] + e.inward[0] * d, e.position[1] + e.inward[1] * d), inRoom: false });
      const inward = e ? eye(e.position[0] + e.inward[0], e.position[1] + e.inward[1]).subtract(eye(e.position[0], e.position[1])) : new Vector3(0, 0, 1);
      const offFurniture = (pos) => colliders.every(({ mesh }) => { const b = mesh.getBoundingInfo().boundingBox; return pos.x < b.minimumWorld.x - 0.5 || pos.x > b.maximumWorld.x + 0.5 || pos.z < b.minimumWorld.z - 0.5 || pos.z > b.maximumWorld.z + 0.5; });
      const N = 32, yaws = [...Array(N).keys()].map((i) => (i / N) * Math.PI * 2);
      let best = null;
      for (const { pos, inRoom } of cands) {
        if (!offFurniture(pos)) continue;
        const dists = yaws.map((yw) => probe(pos, yw));
        const clearance = Math.min(...dists);
        if (clearance < 0.6) continue;
        yaws.forEach((yw, i) => {
          if (!inRoom && Math.sin(yw) * inward.x + Math.cos(yw) * inward.z < -0.2) return; // not out of the front door
          const toward = centres.some((c) => Math.hypot(c.x - pos.x, c.z - pos.z) > 2 && Math.abs(Math.atan2(Math.sin(Math.atan2(c.x - pos.x, c.z - pos.z) - yw), Math.cos(Math.atan2(c.x - pos.x, c.z - pos.z) - yw))) < 0.45);
          // Anything close inside the field of view (about +-40 degrees) spoils the first look.
          // The view is judged across the whole field of view: its average depth (the
          // open plan, not one long sightline through a doorway) and its nearest wall.
          let nearInView = Infinity, depth = 0;
          for (let k = -3; k <= 3; k++) { const dk = dists[(i + k + N) % N]; nearInView = Math.min(nearInView, dk); depth += Math.min(dk, 10) / 7; }
          const score = depth * 1.5 + (toward ? 3 : 0) + Math.min(clearance, 1.5) * 2 + (inRoom ? 1 : 0) - Math.max(0, 2.5 - nearInView) * 3;
          if (!best || score > best.score) best = { score, position: pos, yaw: yw };
        });
      }
      if (best) return best;
      return { position: e ? eye(e.position[0] + e.inward[0] * 1.2, e.position[1] + e.inward[1] * 1.2) : eye(0, 0), yaw: 0 };
    };
    // Double-click (or double-tap) the floor to walk there; Q and E turn.
    let glide = null;
    const turning = new Set();
    const glideTo = (px, py) => {
      const pick = scene.pick(px, py, (m) => solid(m) && m.name !== 'walk-collider');
      const n = pick?.hit ? pick.getNormal(true) : null;
      if (!n || n.y < -0.5) return;
      // The floor: go there. A wall or the side of a step: stop just in front of it.
      const target = n.y >= 0.7 ? pick.pickedPoint.clone() : pick.pickedPoint.add(new Vector3(n.x, 0, n.z).normalize().scale(1.2));
      glide = { target, best: Infinity, since: performance.now() };
      wake();
    };
    scene.onBeforeRenderObservable.add(() => {
      if (scene.activeCamera !== walk) return;
      const turn = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000) * 1.6; // about 90 degrees a second
      if (turning.has('q')) walk.rotation.y -= turn;
      if (turning.has('e')) walk.rotation.y += turn;
      if (!glide) return;
      const to = glide.target.subtract(walk.position); to.y = 0;
      const dist = to.length();
      if (dist < 0.35) { glide = null; return; }
      if (dist < glide.best - 0.02) { glide.best = dist; glide.since = performance.now(); }
      else if (performance.now() - glide.since > 600) { glide = null; return; } // blocked
      to.normalize();
      walk.cameraDirection.addInPlace(to.scale(0.022));
      const want = Math.atan2(to.x, to.z);
      walk.rotation.y += Math.atan2(Math.sin(want - walk.rotation.y), Math.cos(want - walk.rotation.y)) * 0.12;
    });
    const onWalkDbl = (ev) => { if (scene.activeCamera === walk) { const b = canvas.getBoundingClientRect(); glideTo(ev.clientX - b.left, ev.clientY - b.top); } };
    let lastTap = null;
    const onWalkTap = (ev) => {
      if (scene.activeCamera !== walk || ev.pointerType !== 'touch') return;
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) { onWalkDbl(ev); lastTap = null; }
      else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
    };
    const onWalkKey = (ev) => {
      const k = String(ev.key || '').toLowerCase();
      if (ev.type === 'keydown') { glide = null; if (k === 'q' || k === 'e') turning.add(k); } else turning.delete(k);
    };
    canvas.addEventListener('dblclick', onWalkDbl);
    canvas.addEventListener('pointerup', onWalkTap);
    canvas.addEventListener('keydown', onWalkKey);
    canvas.addEventListener('keyup', onWalkKey);

    LoadAssetContainerAsync(new Uint8Array(glb), scene, { pluginExtension: '.glb' }).then((container) => {
      if (!alive) { container.dispose(); return; }
      container.addAllToScene();
      root = container.meshes.find((m) => m.name === '__root__') || null;
      // The house never moves: fix every mesh's world matrix once.
      for (const mesh of container.meshes) { mesh.computeWorldMatrix(true); mesh.freezeWorldMatrix(); }
      // Floors, cladding, counters and paving get their surface detail, drawn here.
      try { applySurfaceDetail(scene, container.materials, { finish: extras?.finish || {}, high: quality !== 'standard' }); } catch { /* plain colours still work */ }
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;
        mesh.receiveShadows = true;
        shadows.addShadowCaster(mesh, false);
        const key = modelGroup(mesh);
        // Walls, floors and stairs are solid in the walkthrough. Furniture is
        // not: the rounded collider would ride up onto low beds and benches.
        mesh.checkCollisions = !/^Furniture/.test(key);
        if (!nodes.has(key)) nodes.set(key, []);
        nodes.get(key).push(mesh);
      }
      addColliders();
      apply(visibility.current.upTo, visibility.current.roof);
      loadedAt = performance.now(); wake();
      // Draw the shadows every frame until everything is ready, then only on change.
      scene.executeWhenReady(() => { shadowMap.refreshRate = 0; wake(); });
      onReady?.();
    }).catch(() => { if (alive) setError('The 3D model could not be shown. Reload the page to try again.'); });

    const apply = (upTo, roofOn) => {
      for (const [name, meshes] of nodes) {
        const visible = modelGroupVisible(name, upTo, roofOn, extras?.levels || []);
        meshes.forEach((m) => { m.setEnabled(visible); });
      }
      for (const c of colliders) c.mesh.setEnabled(c.level <= upTo);
      shadowMap.resetRefreshCounter(); // the shown levels changed: draw the shadows again
      wake();
    };

    const setModeImpl = (m) => {
      if (m === 'walk') {
        orbit.detachControl();
        const { position, yaw } = startPose();
        walk.position = position;
        walk.rotation = new Vector3(0, yaw, 0);
        glide = null;
        scene.activeCamera = walk;
        walk.attachControl(canvas, true);
        canvas.focus();
      } else {
        walk.detachControl();
        scene.activeCamera = orbit;
        orbit.attachControl(canvas, true);
      }
    };

    ctl.current = {
      apply, setMode: setModeImpl,
      nudge: (dir) => { // touch buttons in walk mode
        const f = walk.getDirection(new Vector3(0, 0, 1)); f.y = 0; f.normalize();
        walk.cameraDirection.addInPlace(f.scale(dir * 0.35));
      },
      turn: (a) => { glide = null; walk.rotation.y += a; },
      screenshot: async () => {
        const w = 2400, h = Math.round(2400 * canvas.clientHeight / Math.max(1, canvas.clientWidth));
        return CreateScreenshotUsingRenderTargetAsync(engine, scene.activeCamera, { width: w, height: h }, 'image/png', 4, true);
      },
      scene, walk, nav, quality,
      walkTo: (px, py) => { glideTo(px, py); return glide ? { x: +glide.target.x.toFixed(2), y: +glide.target.y.toFixed(2), z: +glide.target.z.toFixed(2) } : null; }, // test hook
      redraw: wake,
    };
    window.__keystoneModel = ctl.current; // test hook, harmless

    return () => {
      disposed = true; alive = false;
      io.disconnect(); ro.disconnect(); ro2.disconnect(); nav.dispose();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointermove', onMove);
      for (const t of inputs) canvas.removeEventListener(t, wake);
      canvas.removeEventListener('dblclick', onWalkDbl);
      canvas.removeEventListener('pointerup', onWalkTap);
      canvas.removeEventListener('keydown', onWalkKey);
      canvas.removeEventListener('keyup', onWalkKey);
      engine.stopRenderLoop();
      scene.dispose(); engine.dispose();
      if (window.__keystoneModel === ctl.current) delete window.__keystoneModel;
      ctl.current = null;
      void disposed;
    };
  }, [glb, onReady]);

  useEffect(() => { ctl.current?.apply(levelsShown, roof); ctl.current?.redraw(); }, [levelsShown, roof, meta]);
  useEffect(() => { ctl.current?.setMode(mode); }, [mode]);

  const levels = meta?.levels || [];
  const save = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  const shot = async () => {
    if (!allowDownloads || !ctl.current) return;
    setBusy('image');
    try { save(await ctl.current.screenshot(), 'keystone-ai-house.png'); } catch { setError('The image was not saved. Try again.'); }
    setBusy('');
  };
  const downloadGlb = () => { if (!allowDownloads) return; const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' })); save(url, 'keystone-ai-house.glb'); setTimeout(() => URL.revokeObjectURL(url), 4000); };

  return (
    <div className="mv">
      <canvas ref={canvasRef} className="mv-canvas" tabIndex={0} role="img" aria-label={label}/>
      <div className="mv-bar mv-top">
        <div className="studio-seg" role="group" aria-label="Camera">
          <button type="button" aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')}>Orbit</button>
          <button type="button" aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>Walk inside</button>
        </div>
        <div className="studio-seg" role="group" aria-label="Show levels">
          <button type="button" aria-pressed={levelsShown >= 99} onClick={() => setLevelsShown(99)}>Whole house</button>
          {levels.slice(0, -1).map((l) => (
            <button type="button" key={l.level} aria-pressed={levelsShown === l.level} onClick={() => setLevelsShown(l.level)}>Up to level {l.level}</button>
          ))}
        </div>
      </div>
      <div className="mv-bar mv-bottom">
        {mode === 'walk'
          ? <p className="mv-hint">{touch ? 'Drag to look around. Double-tap the floor to walk there.' : 'W A S D to walk, Q E to turn, drag to look. Double-click the floor to walk there.'}</p>
          : <p className="mv-hint">Drag or swipe with two fingers to turn, pinch or scroll to zoom, double-click to fly in.</p>}
        <div className="mv-actions">
          {mode === 'walk' && (
            <span className="mv-pad" aria-label="Walk controls">
              <button type="button" onClick={() => ctl.current?.turn(-0.35)} aria-label="Turn left"><ArrowCounterClockwise size={18} weight="bold" aria-hidden="true"/></button>
              <button type="button" onClick={() => ctl.current?.nudge(1)} aria-label="Step forward"><ArrowUp size={18} weight="bold" aria-hidden="true"/></button>
              <button type="button" onClick={() => ctl.current?.nudge(-1)} aria-label="Step back"><ArrowDown size={18} weight="bold" aria-hidden="true"/></button>
              <button type="button" onClick={() => ctl.current?.turn(0.35)} aria-label="Turn right"><ArrowClockwise size={18} weight="bold" aria-hidden="true"/></button>
            </span>
          )}
          {allowDownloads && <>
            <button type="button" className="studio-btn studio-btn-quiet" onClick={shot} disabled={!!busy}>{busy === 'image' ? 'Rendering' : 'Save image'}</button>
            <button type="button" className="studio-btn studio-btn-quiet" onClick={downloadGlb}>Download 3D model</button>
          </>}
        </div>
      </div>
      {mode === 'orbit' && (
        <div className="mv-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => ctl.current?.nav.zoomIn()} aria-label="Zoom in" title="Zoom in (+)"><Plus size={18} weight="bold" aria-hidden="true"/></button>
          <button type="button" onClick={() => ctl.current?.nav.zoomOut()} aria-label="Zoom out" title="Zoom out (-)"><Minus size={18} weight="bold" aria-hidden="true"/></button>
          <button type="button" onClick={() => ctl.current?.nav.reset()} aria-label="Reset view" title="Reset view (0)"><HouseSimple size={18} weight="bold" aria-hidden="true"/></button>
        </div>
      )}
      {error && <p className="mv-error" role="alert">{error}</p>}
    </div>
  );
}
