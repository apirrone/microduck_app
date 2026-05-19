import { onCleanup, onMount, createEffect } from "solid-js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  buildRig,
  loadKinematics,
  setJointAngles,
  applySleepPose,
  groundFullBody,
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

    // Emoji sprite pool — one Sprite per detected-object class, reused
    // across frames so we don't churn GPU textures. Sprites live in the
    // scene root (not the rig), so we convert MJCF world coords to scene
    // coords explicitly: (mx, my, mz) → (mx, mz, -my). Sprites face the
    // camera automatically.
    const spritePool = new Map<string, THREE.Sprite>();
    const seenThisTick = new Set<string>();

    // Debug arrow for the head camera. Cyan arrow at the camera in
    // trunk frame, pointing along the optical axis. Attached as a child
    // of `rig.root` (assigned once the rig finishes loading), so it
    // inherits the duck's placement + yaw and uses MJCF (trunk) coords
    // directly — sidesteps any odo/IMU vs PWA-grounding mismatch.
    const camArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      0.30,            // 30 cm shaft — comfortably longer than the duck
      0x00d1c1,        // cyan, contrasts with the cream background
      0.05, 0.03,      // head length / head width
    );
    camArrow.visible = false;
    const emojiFor = (cls: string): string => {
      switch (cls) {
        case "ball":   return "⚽";
        case "apple":  return "🍎";
        case "person": return "🧑";
        case "cat":    return "🐱";
        case "dog":    return "🐶";
        default:       return "❓";
      }
    };
    const getSprite = (cls: string): THREE.Sprite => {
      const cached = spritePool.get(cls);
      if (cached) return cached;
      const tex = makeEmojiTexture(emojiFor(cls));
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
      const s = new THREE.Sprite(mat);
      // 8 cm tall — visible without dwarfing the duck.
      s.scale.set(0.08, 0.08, 0.08);
      spritePool.set(cls, s);
      return s;
    };

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

    // The rig we load depends on the runtime's reported `robot_version`.
    // First telemetry frame seeds this; if it changes (e.g. user points
    // PWA at a different robot), we hot-swap the rig.
    let currentVersion: string | null = null;

    async function loadRigFor(version: string) {
      try {
        const k = await loadKinematics(`/robot/${version}/kinematics.json`);
        const next = await buildRig(k, { toon: true });
        if (rig) {
          scene.remove(rig.placer);
          // Best-effort cleanup — three.js doesn't auto-dispose.
          rig.placer.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
            const mat = (m.material as THREE.Material | THREE.Material[] | undefined);
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
            else if (mat) mat.dispose();
          });
        }
        rig = next;
        nActuated = rig.actuated.length;
        scene.add(rig.placer);
        // Attach the camera-debug arrow to the trunk_base body so trunk-
        // frame coords map 1:1 (the body's local axes already follow MJCF
        // convention, and groundFullBody's placer offset is inherited).
        const trunkBody = rig.bodies.get("trunk_base");
        if (trunkBody) trunkBody.add(camArrow);
        currentVersion = version;
      } catch (e) {
        console.warn(`kinematics load failed for ${version} — placeholder`, e);
        const placeholder = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 16, 12),
          new THREE.MeshToonMaterial({ color: 0xffcd3a }),
        );
        placeholder.position.y = 0.12;
        scene.add(placeholder);
      }
    }

    // Initial load — use whatever the latest snapshot says, defaulting
    // to v1.5 (the current model) when offline.
    await loadRigFor(props.snapshot?.robot_version ?? "v1.5");

    // Reactively hot-swap if the runtime later reports a different
    // variant (e.g. user switches the Robot URL between robots).
    createEffect(() => {
      const v = props.snapshot?.robot_version;
      if (v && v !== currentVersion) {
        void loadRigFor(v);
      }
    });

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
          applySleepPose(rig, t / 1000, currentVersion ?? "v1.5");
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
        // Ground using the whole-rig bounding box in both poses.  Awake:
        // the feet are the lowest geometry → same result as the old
        // `groundFeet` path.  Asleep: the legs fold under the trunk so
        // the trunk-bottom takes over as the lowest point and the body
        // sits naturally on the floor.  Single path also avoids state
        // bleeding when v1.5's feet bodies don't match the "foot"/"foot_2"
        // names that groundFeet looks for.
        groundFullBody(rig);

        // Camera debug arrow.  Trunk-frame coords; arrow is a child of
        // rig.root which already applies MJCF Z-up → scene Y-up, so we
        // pass MJCF coords as-is.
        const snap = props.snapshot;
        if (snap?.cam_valid && snap.cam_trunk_pos && snap.cam_trunk_fwd) {
          camArrow.position.set(...snap.cam_trunk_pos);
          camArrow.setDirection(new THREE.Vector3(...snap.cam_trunk_fwd).normalize());
          camArrow.visible = true;
        } else {
          camArrow.visible = false;
        }

        // Detected-object sprites (emoji).  Attach to trunk_base body
        // and use trunk-frame coords directly — the body's transform
        // (root rotation + placer offset) places the sprite at the right
        // scene location with no frame mismatch.  Small upward offset
        // keeps the sprite from clipping through the floor.
        seenThisTick.clear();
        const trunkBody = rig.bodies.get("trunk_base");
        const objs = props.snapshot?.objects;
        if (trunkBody && objs && objs.length > 0) {
          for (const o of objs) {
            const sp = getSprite(o.class);
            const p = o.trunk_pos ?? o.world_pos;  // fall back for old runtimes
            const [mx, my, mz] = p;
            const yOff = sp.scale.y * 0.7;
            sp.position.set(mx, my, mz + yOff);
            if (sp.parent !== trunkBody) trunkBody.add(sp);
            sp.visible = true;
            seenThisTick.add(o.class);
          }
        }
        for (const [cls, sp] of spritePool) {
          if (!seenThisTick.has(cls)) sp.visible = false;
        }

        // Follow camera: lerp the orbit target horizontally toward the
        // duck's (now-grounded) position; preserve user's orbit offset.
        // Y is pinned — foot-grounding moves placer.y each frame as the
        // joints interpolate, and we don't want the camera to bob with
        // it. Small XZ deadzone kills mm-scale odometry jitter.
        const TORSO_Y = 0.18;
        const DEAD_M = 0.015;
        newTarget.set(rig.placer.position.x, TORSO_Y, rig.placer.position.z);
        if (!camInited) {
          followTarget.copy(newTarget);
          controls.target.copy(followTarget);
          camera.position.set(followTarget.x + 0.55, followTarget.y + 0.25, followTarget.z + 0.65);
          camInited = true;
        } else {
          const ddx = newTarget.x - followTarget.x;
          const ddz = newTarget.z - followTarget.z;
          const dist = Math.hypot(ddx, ddz);
          if (dist > DEAD_M) {
            // Smooth follow ~1.5 Hz half-life — slow enough that pose
            // jitter washes out, fast enough that the duck stays framed.
            const cf = 1 - Math.exp(-dt * 3);
            tmpDelta.set(ddx * cf, 0, ddz * cf);
            followTarget.add(tmpDelta);
            controls.target.add(tmpDelta);
            camera.position.add(tmpDelta);
          }
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

// Render an emoji onto a transparent canvas → CanvasTexture.  Sized for
// readability at 8 cm world scale on a phone screen; cached per-class in
// `spritePool` so each emoji is rasterised at most once per session.
function makeEmojiTexture(emoji: string): THREE.Texture {
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, N, N);
  g.font = `${N * 0.85}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, N / 2, N / 2);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function spawnZ(layer: HTMLDivElement) {
  const el = document.createElement("div");
  el.textContent = "Z";
  el.className =
    "absolute font-extrabold text-2xl select-none animate-zfloat text-mint-600/80";
  const rect = layer.getBoundingClientRect();
  el.style.left = `${rect.width * 0.5 + (Math.random() - 0.5) * 30}px`;
  el.style.top = `${rect.height * 0.45}px`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
