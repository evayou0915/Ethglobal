"use client";

/**
 * Rotating point-cloud "bust" + cursor-blur reveal for the landing hero.
 *
 * Why a separate component with STATIC three imports (not a dynamic import in
 * page.tsx): the production webpack build was splitting `three` and
 * `three/examples/jsm/*` into separate async chunks, which loaded duplicate
 * THREE module instances — the PCDLoader/scene used one copy while the
 * WebGLRenderer used another, so nothing rendered (no error). `next dev`
 * (turbopack) deduped them, hiding the bug locally. Static imports inside one
 * module guarantee a single shared instance. This component is loaded via
 * next/dynamic({ ssr:false }) from page.tsx so three never runs during SSR.
 *
 * It mounts its canvas into the #three-bust div that lives in the page's static
 * hero markup, and renders nothing itself.
 */
import { useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PCDLoader } from "three/examples/jsm/loaders/PCDLoader.js";

export default function HeroBust() {
  useEffect(() => {
    const container = document.getElementById("three-bust");
    let disposeBust: (() => void) | null = null;

    if (container && !container.querySelector("canvas")) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      const size = (): [number, number] => [
        container.clientWidth || window.innerWidth,
        container.clientHeight || window.innerHeight,
      ];
      let [w, h] = size();
      renderer.setSize(w, h);
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 40);
      camera.position.set(0, 0, 1.2);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.enableRotate = false;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.8;

      const RUST = 0xc2410c;
      // Point cloud is inert DATA (parsed by our bundled PCDLoader), not code —
      // fetched from the three.js examples host with a procedural-sphere fallback.
      new PCDLoader().load(
        "https://threejs.org/examples/models/pcd/binary/Zaghetto.pcd",
        (points) => {
          points.geometry.center();
          points.geometry.rotateX(Math.PI);
          (points.material as THREE.PointsMaterial).size = 0.003;
          (points.material as THREE.PointsMaterial).color.setHex(RUST);
          scene.add(points);
        },
        undefined,
        () => {
          const N = 9000;
          const positions = new Float32Array(N * 3);
          for (let i = 0; i < N; i++) {
            const r = 0.28 + Math.random() * 0.18;
            const t = Math.random() * Math.PI * 2;
            const p = Math.acos(2 * Math.random() - 1);
            positions[i * 3]     = r * Math.sin(p) * Math.cos(t);
            positions[i * 3 + 1] = r * Math.sin(p) * Math.sin(t);
            positions[i * 3 + 2] = r * Math.cos(p);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          const m = new THREE.PointsMaterial({ size: 0.003, color: RUST, transparent: true, opacity: 0.85 });
          scene.add(new THREE.Points(g, m));
        }
      );

      const onResize = () => {
        [w, h] = size();
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener("resize", onResize);

      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      disposeBust = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        controls.dispose();
        renderer.dispose();
        renderer.forceContextLoss?.();
        renderer.domElement.remove();
      };
    }

    // Cursor-tracked blur reveal — a soft hole follows the mouse over the bust.
    const layer = document.querySelector<HTMLElement>(".bust-blur");
    let blurRaf = 0;
    let tx = window.innerWidth / 2, ty = window.innerHeight * 0.42;
    let cx = tx, cy = ty;
    const onMove = (e: MouseEvent) => { tx = e.clientX; ty = e.clientY; };
    if (layer) {
      document.addEventListener("mousemove", onMove);
      const tick = () => {
        cx += (tx - cx) * 0.12;
        cy += (ty - cy) * 0.12;
        layer.style.setProperty("--bx", cx + "px");
        layer.style.setProperty("--by", cy + "px");
        blurRaf = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      if (disposeBust) disposeBust();
      document.removeEventListener("mousemove", onMove);
      if (blurRaf) cancelAnimationFrame(blurRaf);
    };
  }, []);

  return null;
}
