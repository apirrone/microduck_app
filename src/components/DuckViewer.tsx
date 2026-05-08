import { onCleanup, onMount, createEffect } from "solid-js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildRig,
  loadKinematics,
  setJointAngles,
  applySleepPose,
  groundFeet,
  placeWorld,
  type DuckRig,
} from "../duck/kinematics";
import type { DuckSnapshot } from "../state/telemetry";

interface Props {
  asleep: boolean;
  snapshot: DuckSnapshot | null;
}

export function DuckViewer(props: Props) {
  let mount!: HTMLDivElement;
  let zlayer!: HTMLDivElement;
  let scene: THREE.Scene;
  let renderer: THREE.WebGLRenderer;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let rig: DuckRig | null = null;
  let raf: number | null = null;
  const target = new Float32Array(64);
  const current = new Float32Array(64);
  let nActuated = 0;

  // Smoothed scene-space duck position (X, Z) and yaw used for camera
  // tracking. Initialised on first telemetry frame.
  const followTarget = new THREE.Vector3();
  let camInited = false;

  onMount(async () => {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xfff7df);
    // Soft fog so the floor fades into the sky at distance instead of
    // showing a hard horizon line.
    scene.fog = new THREE.Fog(0xfff7df, 4, 12);

    const w = mount.clientWidth || 320;
    const h = mount.clientHeight || 480;
    camera = new THREE.PerspectiveCamera(35, w / h, 0.05, 50);

    renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1c0, 1.1);
    key.position.set(1.5, 2.0, 1.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fdcff, 0.5);
    fill.position.set(-1.2, 0.6, -1.2);
    scene.add(fill);

    // Tiled floor — large plane with a procedurally-drawn checker so
    // motion is visible as the world moves under the duck.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ map: makeFloorTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = false;
    scene.add(floor);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 0.4;
    controls.maxDistance = 3.5;
    controls.enablePan = false;
    // Lock vertical orbit to a pleasant range — never go below the floor.
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    try {
      const k = await loadKinematics("/robot/kinematics.json");
      rig = await buildRig(k, { toon: true });
      nActuated = rig.actuated.length;
      scene.add(rig.placer);
    } catch (e) {
      console.warn("kinematics load failed — placeholder", e);
      const placeholder = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 16, 12),
        new THREE.MeshToonMaterial({ color: 0xffcd3a }),
      );
      placeholder.position.y = 0.12;
      scene.add(placeholder);
    }

    const ro = new ResizeObserver(() => {
      const W = mount.clientWidth, H = mount.clientHeight;
      if (W <= 0 || H <= 0) return;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    });
    ro.observe(mount);

    let zTimer: number | null = null;
    const updateZ = () => {
      if (props.asleep && zlayer && !zTimer) {
        zTimer = window.setInterval(() => spawnZ(zlayer), 850);
      } else if (!props.asleep && zTimer) {
        window.clearInterval(zTimer);
        zTimer = null;
      }
    };
    createEffect(updateZ);

    let lastT = performance.now();
    const tmpDelta = new THREE.Vector3();
    const newTarget = new THREE.Vector3();
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      if (rig) {
        if (props.asleep) {
          applySleepPose(rig, t / 1000);
        } else {
          const q = props.snapshot?.joints;
          if (q) {
            const n = Math.min(q.length, nActuated);
            for (let i = 0; i < n; i++) target[i] = q[i];
          }
          const k = 1 - Math.exp(-dt * 14);
          for (let i = 0; i < nActuated; i++) {
            current[i] += (target[i] - current[i]) * k;
          }
          setJointAngles(rig, Array.from(current.subarray(0, nActuated)));
          if (props.snapshot) {
            placeWorld(rig, props.snapshot.x, props.snapshot.y, props.snapshot.yaw_rad);
          }
        }
        // Foot-grounding runs every frame (works for both walking and
        // sleep poses).
        groundFeet(rig);

        // Follow camera: lerp the orbit target toward the duck's
        // (now-grounded) position; preserve user's orbit offset.
        newTarget.copy(rig.placer.position);
        // Aim camera roughly at the duck's torso, not its feet.
        newTarget.y += 0.18;
        if (!camInited) {
          followTarget.copy(newTarget);
          controls.target.copy(followTarget);
          camera.position.set(followTarget.x + 0.55, followTarget.y + 0.25, followTarget.z + 0.65);
          camInited = true;
        } else {
          // Smooth follow ~3 Hz half-life.
          const cf = 1 - Math.exp(-dt * 6);
          tmpDelta.copy(newTarget).sub(followTarget).multiplyScalar(cf);
          followTarget.add(tmpDelta);
          controls.target.add(tmpDelta);
          camera.position.add(tmpDelta);
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    onCleanup(() => {
      if (raf != null) cancelAnimationFrame(raf);
      if (zTimer) window.clearInterval(zTimer);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    });
  });

  return (
    <div class="absolute inset-0">
      <div ref={mount!} class="absolute inset-0" />
      <div ref={zlayer!} class="absolute inset-0 pointer-events-none overflow-hidden" />
    </div>
  );
}

// Procedural floor: warm cream base with a faint repeating tile pattern
// so motion is visually obvious without being noisy.
function makeFloorTexture(): THREE.Texture {
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf6e7";
  g.fillRect(0, 0, N, N);
  // Soft grid lines
  g.strokeStyle = "#e7dab0";
  g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = (i * N) / 8 + 0.5;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, N); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(N, p); g.stroke();
  }
  // A tiny tile dot at each crossing for additional motion cues.
  g.fillStyle = "#d8c98a";
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      g.beginPath();
      g.arc((i * N) / 8, (j * N) / 8, 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // 0.25 m per tile feels right at this camera distance — 40m/0.25m =
  // 160 tile repeats over the plane.
  t.repeat.set(160, 160);
  t.anisotropy = 4;
  return t;
}

function spawnZ(layer: HTMLDivElement) {
  const el = document.createElement("div");
  el.textContent = "Z";
  el.className =
    "absolute font-extrabold text-2xl select-none animate-zfloat text-mint-600/80";
  const rect = layer.getBoundingClientRect();
  el.style.left = `${rect.width * 0.5 + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${rect.height * 0.32}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
