import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/* Trackpad, mouse and keyboard navigation shared by both 3D viewers.

   Orbit:  drag or two-finger swipe turns the house; pinch, scroll wheel or
           + / - zoom toward the point under the cursor; shift + swipe or
           right-drag pans; double-click flies in; 0 resets.
   Walk:   two-finger swipe looks around; pinch zooms the lens; a wheel steps.

   Every wheel and pinch on the canvas is consumed, so the page itself never
   scrolls or zooms while the pointer is over the model. Babylon's own wheel
   input is removed because it cannot tell a trackpad from a mouse. */

const GAP_MS = 250; // a pause this long starts a new gesture

// A mouse wheel moves in coarse notches; a trackpad in small smooth steps.
// Decided once per gesture from its first event, then held.
function isMouseWheel(e) {
  if (e.deltaMode !== 0) return true; // lines or pages: Firefox mouse
  if (e.deltaX !== 0) return false;
  const y = Math.abs(e.deltaY);
  if (y !== 0 && y % 4.000244140625 === 0) return true; // Chrome, macOS mouse
  return y >= 50; // Windows and Linux wheels report ~100 a notch
}

export function attachNav({ scene, canvas, orbit, walk, home, isWalking = () => scene.activeCamera === walk }) {
  orbit.inputs.removeByType('ArcRotateCameraMouseWheelInput');
  walk?.inputs.removeByType('FreeCameraMouseWheelInput');
  // Drag follows the hand more directly than Babylon's default (1000, 0.9),
  // which coasts a long way after release: the same turn, far less drift.
  orbit.angularSensibilityX = 500;
  orbit.angularSensibilityY = 500;
  orbit.inertia = 0.8;
  orbit.panningInertia = 0.8;

  const start = { alpha: orbit.alpha, beta: orbit.beta, radius: orbit.radius, target: orbit.target.clone(), ...home };
  const clampR = (r) => Math.min(orbit.upperRadiusLimit ?? Infinity, Math.max(orbit.lowerRadiusLimit ?? 0.5, r));
  let tween = null;
  scene.onBeforeRenderObservable.add(() => {
    if (!tween) return;
    const t = Math.min(1, (performance.now() - tween.t0) / tween.ms);
    const k = 1 - (1 - t) ** 3;
    for (const key of ['alpha', 'beta', 'radius']) if (tween[key] != null) orbit[key] = tween.from[key] + (tween[key] - tween.from[key]) * k;
    if (tween.target) orbit.target = Vector3.Lerp(tween.from.target, tween.target, k);
    if (t >= 1) tween = null;
  });
  const animate = (to, ms = 420) => {
    tween = { ...to, t0: performance.now(), ms, from: { alpha: orbit.alpha, beta: orbit.beta, radius: orbit.radius, target: orbit.target.clone() } };
  };

  const pickAt = (x, y) => {
    const p = scene.pick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible);
    return p?.hit ? p.pickedPoint : null;
  };
  // zoom by `f` (<1 is closer), pulling the target toward what is under (x, y).
  // A trackpad sends a wheel event per frame; the point under the cursor is picked
  // once per gesture (or when the cursor moves), not on every event.
  let aim = null;
  const zoom = (f, x, y) => {
    tween = null;
    const r = clampR(orbit.radius * f);
    const real = r / orbit.radius;
    if (real < 1 && x != null) {
      const now = performance.now();
      if (!aim || now - aim.t > GAP_MS || Math.hypot(aim.x - x, aim.y - y) > 24) aim = { x, y, p: pickAt(x, y) };
      aim.t = now;
      if (aim.p) orbit.target = Vector3.Lerp(orbit.target, aim.p, 1 - real);
    }
    orbit.radius = r;
  };
  const pan = (dx, dy) => {
    tween = null;
    const view = orbit.getViewMatrix();
    const right = new Vector3(view.m[0], view.m[4], view.m[8]);
    const up = new Vector3(view.m[1], view.m[5], view.m[9]);
    const s = orbit.radius * 0.0016;
    orbit.target = orbit.target.add(right.scale(dx * s)).add(up.scale(-dy * s));
  };
  const turn = (dx, dy) => {
    tween = null;
    orbit.alpha += dx * 0.006;
    orbit.beta = Math.min(orbit.upperBetaLimit ?? Math.PI, Math.max(orbit.lowerBetaLimit ?? 0.01, orbit.beta + dy * 0.006));
  };
  const look = (dx, dy) => {
    walk.rotation.y += dx * 0.004;
    walk.rotation.x = Math.max(-1.3, Math.min(1.3, walk.rotation.x + dy * 0.004));
  };
  const lens = (f) => { walk.fov = Math.max(0.5, Math.min(1.35, walk.fov * f)); };

  const local = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  let last = 0, mouse = false;
  const onWheel = (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - last > GAP_MS) mouse = isMouseWheel(e);
    last = now;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    const [x, y] = local(e);
    if (isWalking()) {
      if (e.ctrlKey) lens(Math.exp(dy * 0.01));
      else if (mouse) walk.cameraDirection.addInPlace(walk.getDirection(new Vector3(0, 0, 1)).multiplyByFloats(1, 0, 1).normalize().scale(-Math.sign(dy) * 0.3));
      else look(dx, dy);
      return;
    }
    if (e.ctrlKey) zoom(Math.exp(dy * 0.012), x, y); // trackpad pinch (and ctrl + wheel)
    else if (mouse) zoom(Math.exp(dy * 0.0016), x, y);
    else if (e.shiftKey) pan(dx, dy);
    else turn(dx, dy);
  };

  // Safari reports a trackpad pinch as gesture events, not ctrl + wheel
  let scale = 1;
  const onGestureStart = (e) => { e.preventDefault(); scale = 1; };
  const onGestureChange = (e) => {
    e.preventDefault();
    const f = scale / e.scale; scale = e.scale;
    if (isWalking()) lens(f);
    else { const [x, y] = local(e); zoom(f, x, y); }
  };

  const onDblClick = (e) => {
    if (isWalking()) return;
    const [x, y] = local(e);
    const p = pickAt(x, y);
    if (p) animate({ target: p, radius: clampR(Math.min(orbit.radius * 0.5, 12)) });
  };

  const api = {
    busy: () => Boolean(tween), // a zoom, fly-in or reset is animating
    zoomIn: () => animate({ radius: clampR(orbit.radius * 0.7) }, 260),
    zoomOut: () => animate({ radius: clampR(orbit.radius / 0.7) }, 260),
    reset: () => animate({ alpha: start.alpha, beta: start.beta, radius: start.radius, target: start.target }, 600),
    setHome: (h) => Object.assign(start, h),
  };
  const onKey = (e) => {
    if (isWalking() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); api.zoomIn(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); api.zoomOut(); }
    else if (e.key === '0') { e.preventDefault(); api.reset(); }
  };

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('gesturestart', onGestureStart, { passive: false });
  canvas.addEventListener('gesturechange', onGestureChange, { passive: false });
  canvas.addEventListener('gestureend', onGestureStart, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('keydown', onKey);
  api.dispose = () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('gesturestart', onGestureStart);
    canvas.removeEventListener('gesturechange', onGestureChange);
    canvas.removeEventListener('gestureend', onGestureStart);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('keydown', onKey);
  };
  return api;
}
