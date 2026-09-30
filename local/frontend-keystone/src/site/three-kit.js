import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* Shared setup for the site's small three.js scenes. Every scene renders
   only while its canvas is on screen and the tab is visible, and tears
   everything down on unmount. */

export const reducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createStage(canvas, { fov = 30, shadows = false, exposure = 1 } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    const camera = new THREE.PerspectiveCamera(fov, 1, 1, 1000);

    let visible = false;
    let raf = 0;
    let frame = null;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); }, { threshold: 0.01 });
    io.observe(canvas);
    const onVis = () => wake();
    document.addEventListener('visibilitychange', onVis);

    const fit = () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return false;
        const pr = renderer.getPixelRatio();
        if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        return true;
    };
    const loop = () => {
        raf = 0;
        if (!visible || document.hidden) return;
        if (fit()) { frame?.(); renderer.render(scene, camera); }
        raf = requestAnimationFrame(loop);
    };
    function wake() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(loop); }

    return {
        THREE, renderer, scene, camera,
        onFrame(fn) { frame = fn; wake(); },
        renderOnce() { if (fit()) renderer.render(scene, camera); },
        dispose() {
            cancelAnimationFrame(raf);
            io.disconnect();
            document.removeEventListener('visibilitychange', onVis);
            scene.traverse((o) => {
                o.geometry?.dispose?.();
                const m = o.material;
                (Array.isArray(m) ? m : m ? [m] : []).forEach((mm) => mm.dispose?.());
            });
            envTex.dispose();
            pmrem.dispose();
            renderer.dispose();
        },
    };
}
