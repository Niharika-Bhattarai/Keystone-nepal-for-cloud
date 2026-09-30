import React, { useEffect, useRef, useState } from 'react';
import { HouseSimple, Minus, Plus } from '@phosphor-icons/react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { MeshoptCompression } from '@babylonjs/core/Meshes/Compression/meshoptCompression';
import '@babylonjs/core/Collisions/collisionCoordinator';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/loaders/glTF/2.0';
import { attachNav } from './viewerNav';
import { modelGroup, modelGroupVisible } from './modelVisibility';

/* Viewer for the high-end model: a Blender bake with lighting (sun, sky and
   every interior light, with bounced light) stored in lightmaps and vertex
   colours. Baked surfaces are lit by a flat white fill so the bake alone sets
   their brightness; trees and glass get a live sun.

   Walking: W A S D, or click a spot on the floor to glide there (a ring shows
   where you will land). The room list jumps straight into any room; the
   level button takes the stairs. */

const FT = 0.3048;
const EYE = 1.62;
MeshoptCompression.Configuration.decoder.url = '/vendor/meshopt_decoder.js';

export default function HqViewer({ manifest, label = 'Photoreal 3D model of the house' }) {
  const canvasRef = useRef(null);
  const ctl = useRef(null);
  const [mode, setMode] = useState('orbit');
  const [upTo, setUpTo] = useState(99);
  const [roof, setRoof] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [here, setHere] = useState(null); // level the walker is on
  const visibility = useRef({ upTo, roof });
  visibility.current = { upTo, roof };
  const meta = manifest?.meta || {};
  const levels = [...(meta.levels || [])].sort((a, b) => a.floorY - b.floorY);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest?.glb) return undefined;
    let alive = true;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false, adaptToDeviceRatio: true, antialias: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.8, 0.86, 0.91, 1);
    scene.collisionsEnabled = true;
    scene.gravity = new Vector3(0, -0.15, 0);
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05;
    ip.contrast = 1.12;

    const fill = new HemisphericLight('bakeFill', new Vector3(0, 1, 0), scene);
    fill.diffuse = Color3.White(); fill.groundColor = Color3.White(); fill.specular = Color3.Black(); fill.intensity = 1;
    const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene);
    sky.diffuse = new Color3(0.78, 0.84, 0.95); sky.groundColor = new Color3(0.36, 0.4, 0.3); sky.intensity = 0.65; sky.specular = Color3.Black();
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -0.8, 0.4), scene);
    sun.intensity = 2.2;

    const fp = meta.footprint || { width: 40, depth: 30 };
    const span = Math.max(fp.width, fp.depth) * FT;
    const topY = Math.max(3, ...levels.map((l) => l.ceilingY * FT));
    const orbit = new ArcRotateCamera('orbit', -Math.PI / 3, 1.12, span * 1.9, new Vector3(0, topY * 0.4, 0), scene);
    orbit.lowerRadiusLimit = 1.5; orbit.upperRadiusLimit = span * 6; orbit.upperBetaLimit = Math.PI / 2 - 0.04;
    orbit.wheelDeltaPercentage = 0.02; orbit.pinchDeltaPercentage = 0.004; orbit.panningSensibility = 400; orbit.minZ = 0.05;
    orbit.attachControl(canvas, true);
    scene.activeCamera = orbit;

    const walk = new UniversalCamera('walk', new Vector3(0, EYE, 0), scene);
    walk.minZ = 0.03; walk.fov = 1.15; walk.speed = 0.09; walk.angularSensibility = 2600; walk.inertia = 0.6;
    walk.ellipsoid = new Vector3(0.28, EYE / 2, 0.28);
    walk.checkCollisions = true; walk.applyGravity = true;
    walk.keysUp.push(87); walk.keysDown.push(83); walk.keysLeft.push(65); walk.keysRight.push(68);
    const nav = attachNav({ scene, canvas, orbit, walk });

    // where a click on the floor will take you
    const ring = CreateTorus('goto', { diameter: 0.55, thickness: 0.035, tessellation: 48 }, scene);
    const rm = new StandardMaterial('gotoMat', scene);
    rm.emissiveColor = new Color3(1, 1, 1); rm.disableLighting = true; rm.alpha = 0.85;
    ring.material = rm; ring.isPickable = false; ring.setEnabled(false);

    const nodes = new Map();
    const floors = [];
    let root = null;
    const toWorld = (x, y, z) => Vector3.TransformCoordinates(new Vector3(x * FT, y * FT, z * FT), root ? root.computeWorldMatrix(true) : undefined);
    let glide = null;
    scene.onBeforeRenderObservable.add(() => {
      if (!glide) return;
      const t = Math.min(1, (performance.now() - glide.t0) / glide.ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      walk.position = Vector3.Lerp(glide.from, glide.to, e);
      if (glide.look) walk.setTarget(Vector3.Lerp(glide.lookFrom, glide.look, e));
      if (t >= 1) { glide = null; walk.applyGravity = true; }
    });
    const goTo = (to, look) => {
      walk.applyGravity = false;
      const lookFrom = walk.position.add(walk.getDirection(new Vector3(0, 0, 1)));
      glide = { from: walk.position.clone(), to, t0: performance.now(), ms: Math.min(1400, 300 + Vector3.Distance(walk.position, to) * 180), look, lookFrom };
    };

    const levelOf = (y) => {
      let lv = levels[0]?.level ?? 1;
      for (const l of levels) if (y >= l.floorY * FT - 0.3) lv = l.level;
      return lv;
    };

    LoadAssetContainerAsync(manifest.glb, scene, { pluginExtension: '.glb' }).then((container) => {
      if (!alive) { container.dispose(); return; }
      container.addAllToScene();
      root = container.meshes.find((m) => m.name === '__root__') || null;
      const baked = [], live = [], tex = {};
      for (const mesh of container.meshes) {
        if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;
        // film trees keep their leaves only in the photographs; in real time the leaf cards thin out
        if (/tree/i.test(mesh.name) || /tree/i.test(mesh.parent?.name || '')) { mesh.setEnabled(false); continue; }
        const key = modelGroup(mesh);
        if (!nodes.has(key)) nodes.set(key, []);
        nodes.get(key).push(mesh);
        mesh.checkCollisions = /^(Level|Lawn)/.test(key) && !/Glass/.test(mesh.name);
        mesh.isPickable = /^(Level|Lawn|Furniture)/.test(key);
        if (/^Level/.test(key)) floors.push(mesh);
        const mat = mesh.material;
        const ex = mat?.metadata?.gltf?.extras;
        if (ex?.vertexLight) {
          baked.push(mesh);
          if (!mat.__lit) { mat.__lit = true; mat.albedoColor = mat.albedoColor.scale(ex.lightmapScale || 4); mat.metallic = Math.min(mat.metallic ?? 0, 0.35); mat.environmentIntensity = 0; }
        } else if (ex?.lightmap && manifest.lightmaps?.[ex.lightmap]) {
          baked.push(mesh);
          if (!mat.lightmapTexture) {
            const url = manifest.lightmaps[ex.lightmap];
            const t = tex[url] || (tex[url] = new Texture(url, scene, false, false));
            t.coordinatesIndex = 1; t.level = ex.lightmapScale || 4; t.gammaSpace = true;
            mat.lightmapTexture = t; mat.useLightmapAsShadowmap = true;
            mat.metallic = Math.min(mat.metallic ?? 0, 0.35);
            mat.environmentIntensity = 0;
          }
        } else {
          live.push(mesh);
          // bakes before the export fix carry the boxwood's procedural colour as white
          if (mat && /boxwood/.test(mat.name)) mat.albedoColor = new Color3(0.14, 0.26, 0.09);
        }
      }
      fill.includedOnlyMeshes = baked;
      sky.includedOnlyMeshes = live; sun.includedOnlyMeshes = live;
      const e = meta.entry;
      if (e) { // open on the front-door corner
        const o = [-e.inward[0], -e.inward[1]], a = 0.7, beta = 1.2;
        const d = [o[0] * Math.cos(a) - o[1] * Math.sin(a), o[0] * Math.sin(a) + o[1] * Math.cos(a)];
        const w = toWorld(d[0], 0, d[1]).subtract(toWorld(0, 0, 0)).normalize();
        const r = orbit.radius, t = orbit.target;
        orbit.setPosition(new Vector3(t.x + w.x * r * Math.sin(beta), t.y + r * Math.cos(beta), t.z + w.z * r * Math.sin(beta)));
        nav.setHome({ alpha: orbit.alpha, beta: orbit.beta, radius: orbit.radius, target: orbit.target.clone() });
      }
      apply(visibility.current.upTo, visibility.current.roof);
      setReady(true);
    }).catch((err) => { console.error('[HqViewer]', err); if (alive) setError('The photoreal model could not be shown. Reload the page to try again; the model is kept in Account, Downloads.'); });

    // tap (not drag) on the floor in walk mode: glide there
    let down = null;
    scene.onPointerObservable.add((pi) => {
      if (scene.activeCamera !== walk) { ring.setEnabled(false); return; }
      const pick = () => scene.pick(scene.pointerX, scene.pointerY, (m) => m.isPickable && m.isEnabled());
      if (pi.type === PointerEventTypes.POINTERMOVE) {
        const p = pick();
        const nrm = p?.hit ? p.getNormal(true) : null;
        if (p?.hit && nrm && nrm.y > 0.7 && Vector3.Distance(p.pickedPoint, walk.position) < 25) {
          ring.position = p.pickedPoint.add(new Vector3(0, 0.02, 0)); ring.setEnabled(true);
        } else ring.setEnabled(false);
      } else if (pi.type === PointerEventTypes.POINTERDOWN) {
        down = { x: scene.pointerX, y: scene.pointerY };
      } else if (pi.type === PointerEventTypes.POINTERUP && down) {
        const moved = Math.hypot(scene.pointerX - down.x, scene.pointerY - down.y);
        down = null;
        if (moved > 6) return; // that was a look-around drag
        const p = pick();
        const nrm = p?.hit ? p.getNormal(true) : null;
        if (p?.hit && nrm && nrm.y > 0.7) goTo(new Vector3(p.pickedPoint.x, p.pickedPoint.y + EYE, p.pickedPoint.z));
      }
    });

    const apply = (lv, roofOn) => {
      for (const [name, meshes] of nodes) {
        const vis = modelGroupVisible(name, lv, roofOn, levels);
        meshes.forEach((m) => m.setEnabled(vis));
      }
    };

    const enterAt = (x, z, lv, lookX, lookZ) => {
      const l = levels.find((q) => q.level === lv) || levels[0];
      const y = (l?.floorY || 0) + EYE / FT;
      walk.position = toWorld(x, y, z);
      walk.setTarget(toWorld(lookX, y, lookZ));
    };

    ctl.current = {
      apply,
      setMode: (m) => {
        if (m === 'walk') {
          orbit.detachControl();
          const e = meta.entry;
          const x = e ? e.position[0] + e.inward[0] * 3.5 : 0, z = e ? e.position[1] + e.inward[1] * 3.5 : 0;
          const open = (meta.rooms || []).filter((r) => r.level === (e?.level || 1) && /hall|foyer|living|great|family|dining|kitchen/.test(r.type))
            .sort((p, q) => Math.hypot(p.center[0] - x, p.center[1] - z) - Math.hypot(q.center[0] - x, q.center[1] - z))[0];
          enterAt(x, z, e?.level || 1, open ? open.center[0] : x + (e?.inward[0] || 0), open ? open.center[1] : z + (e?.inward[1] || 1));
          scene.activeCamera = walk;
          walk.attachControl(canvas, true);
          canvas.focus();
          setHere(levelOf(walk.position.y));
        } else {
          walk.detachControl();
          ring.setEnabled(false);
          scene.activeCamera = orbit;
          orbit.attachControl(canvas, true);
        }
      },
      room: (r) => {
        const l = levels.find((q) => q.level === r.level);
        const target = toWorld(r.center[0], (l?.floorY || 0) + EYE / FT, r.center[1]);
        const from = walk.position.clone();
        // stand back from the centre, facing into the room
        const dir = target.subtract(from); dir.y = 0;
        const stand = dir.length() > 2 ? target.subtract(dir.normalize().scale(1.2)) : target;
        if (levelOf(from.y) !== r.level) { walk.position = stand; walk.setTarget(target.add(dir.normalize())); }
        else goTo(stand, target.add(dir.normalize().scale(2)));
        setHere(r.level);
      },
      stairs: (toLevel) => {
        const path = meta.stairPath || [];
        const run = toLevel > levelOf(walk.position.y) ? path[path.length - 1] : path[0];
        if (!run) return;
        const p = toLevel > levelOf(walk.position.y) ? run.to : run.from;
        const q = toLevel > levelOf(walk.position.y) ? run.from : run.to;
        const lv = levels.find((l) => l.level === toLevel);
        const y = (lv?.floorY || 0) + EYE / FT;
        const sx = p[0] + (p[0] - q[0]) * 0.15, sz = p[2] + (p[2] - q[2]) * 0.15;
        walk.position = toWorld(sx, y, sz);
        // face the nearest hall or loft, not whatever the flight points at
        const c = (meta.rooms || []).filter((r) => r.level === toLevel && /hall|foyer|loft|living|great|family/.test(r.type))
          .sort((a, b) => Math.hypot(a.center[0] - sx, a.center[1] - sz) - Math.hypot(b.center[0] - sx, b.center[1] - sz))[0];
        walk.setTarget(c ? toWorld(c.center[0], y, c.center[1]) : toWorld(p[0] + (p[0] - q[0]), y, p[2] + (p[2] - q[2])));
        setHere(toLevel);
      },
      scene, walk, nav,
    };
    window.__keystoneHq = ctl.current;

    let running = false;
    const io = new IntersectionObserver(([en]) => {
      if (en.isIntersecting && !running) { running = true; engine.runRenderLoop(() => scene.render()); }
      else if (!en.isIntersecting && running) { running = false; engine.stopRenderLoop(); }
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    return () => {
      alive = false;
      io.disconnect(); ro.disconnect(); nav.dispose();
      engine.stopRenderLoop();
      scene.dispose(); engine.dispose();
      if (window.__keystoneHq === ctl.current) delete window.__keystoneHq;
      ctl.current = null;
    };
  }, [manifest]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ctl.current?.apply(upTo, roof); }, [upTo, roof, ready]);
  useEffect(() => { if (ready) ctl.current?.setMode(mode); }, [mode, ready]);

  const rooms = (meta.rooms || []).filter((r) => !/closet|storage|stairs?/.test(r.type));
  const other = here != null && levels.length > 1 ? levels.find((l) => l.level !== here) : null;

  return (
    <div className="mv mv-hq">
      <canvas ref={canvasRef} className="mv-canvas" tabIndex={0} role="img" aria-label={label}/>
      {!ready && !error && <p className="mv-loading" role="status">Loading the photoreal model…</p>}
      <div className="mv-bar mv-top">
        <div className="studio-seg" role="group" aria-label="Camera">
          <button type="button" aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')}>Orbit</button>
          <button type="button" aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>Walk inside</button>
        </div>
        {mode === 'orbit' ? (
          <>
            <div className="studio-seg" role="group" aria-label="Show levels">
              <button type="button" aria-pressed={upTo >= 99} onClick={() => setUpTo(99)}>Whole house</button>
              {levels.slice(0, -1).map((l) => (
                <button type="button" key={l.level} aria-pressed={upTo === l.level} onClick={() => setUpTo(l.level)}>Up to level {l.level}</button>
              ))}
            </div>
            <label className="mv-check"><input type="checkbox" checked={roof} onChange={(e) => setRoof(e.target.checked)} disabled={upTo < 99}/>Roof</label>
          </>
        ) : (
          <>
            <label className="mv-select">
              <span className="sr-only">Go to room</span>
              <select value="" onChange={(e) => { const r = rooms.find((q) => q.id === e.target.value); if (r) ctl.current?.room(r); }}>
                <option value="">Go to a room…</option>
                {levels.map((l) => (
                  <optgroup key={l.level} label={levels.length > 1 ? `Level ${l.level}` : 'Rooms'}>
                    {rooms.filter((r) => r.level === l.level).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            {other && (
              <button type="button" className="studio-btn studio-btn-quiet" onClick={() => ctl.current?.stairs(other.level)}>
                {other.level > here ? 'Upstairs' : 'Downstairs'}
              </button>
            )}
          </>
        )}
      </div>
      <div className="mv-bar mv-bottom">
        <p className="mv-hint">
          {mode === 'walk' ? 'Click the floor to walk there, drag or swipe to look around, or use W A S D.' : 'Drag or swipe with two fingers to turn, pinch or scroll to zoom, double-click to fly in.'}
        </p>
        <p className="mv-credit">Materials and furniture: <a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a> (CC0)</p>
      </div>
      {mode === 'orbit' && ready && (
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
