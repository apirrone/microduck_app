// Loads the kinematics.json produced by scripts/build_kinematics.py and
// builds an Object3D tree with one Group per body. Joints become
// per-body local rotations driven by `setJointAngles`.

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export interface MJBody {
  name: string;
  parent: string | null;
  pos: [number, number, number];
  quat: [number, number, number, number]; // [w,x,y,z]
  joint?: {
    name: string;
    axis: [number, number, number];
    range?: [number, number];
    type: "hinge" | "free" | "ball" | "slide";
    pos?: [number, number, number];
    actuator_index?: number;
  };
  geoms: Array<{
    mesh?: string;
    color?: [number, number, number, number];
    pos?: [number, number, number];
    quat?: [number, number, number, number];
    type?: string;
    size?: number[];
  }>;
}

export interface Kinematics {
  bodies: MJBody[];
  actuated_joints: string[];
  mesh_dir: string;
}

export interface DuckRig {
  // World-space group positioned at the duck's MJCF (X, Y) and yawed around
  // scene +Y. Add this to the scene.
  placer: THREE.Group;
  // Z-up→Y-up corrected child of placer. All bodies are descendants.
  root: THREE.Group;
  bodies: Map<string, THREE.Group>;
  joints: Map<string, { body: THREE.Group; axis: THREE.Vector3; baseQuat: THREE.Quaternion }>;
  actuated: string[];
  bodyIdByName: Map<string, MJBody>;
  // World-space objects we use for foot grounding each frame.
  feet: THREE.Object3D[];
}

export async function loadKinematics(url: string): Promise<Kinematics> {
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) throw new Error(`kinematics fetch ${r.status}`);
  return r.json();
}

// 2-band toon gradient — soft "cartoon-light" feel that flatters most
// MJCF colours without darkening dark parts to mush.
function makeToonGradient(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 3; c.height = 1;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9aa1b3"; g.fillRect(0, 0, 1, 1);
  g.fillStyle = "#d8dde8"; g.fillRect(1, 0, 1, 1);
  g.fillStyle = "#ffffff"; g.fillRect(2, 0, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export interface BuildOpts {
  toon?: boolean;       // toon shading vs. flat-ish standard
  flatShading?: boolean; // hard normals — extra cartoon
}

export async function buildRig(k: Kinematics, opts: BuildOpts = {}): Promise<DuckRig> {
  // placer holds world-space position + yaw (no axis-conversion).
  const placer = new THREE.Group();
  placer.name = "duck_placer";
  // root applies the MJCF +Z up → three.js +Y up convention fix. Yaw is
  // applied to placer (around scene +Y, which here corresponds to MJCF
  // +Z = up) BEFORE the X-fix, so it's a correct world-up yaw.
  const root = new THREE.Group();
  root.name = "duck_root";
  root.rotation.x = -Math.PI / 2;
  placer.add(root);

  const bodies = new Map<string, THREE.Group>();
  const joints: DuckRig["joints"] = new Map();
  const bodyIdByName = new Map<string, MJBody>();
  const loader = new STLLoader();

  const meshCache = new Map<string, Promise<THREE.BufferGeometry>>();
  const loadMesh = (name: string) => {
    if (!meshCache.has(name)) meshCache.set(name, loader.loadAsync(`${k.mesh_dir}/${name}`));
    return meshCache.get(name)!;
  };

  for (const b of k.bodies) {
    const g = new THREE.Group();
    g.name = b.name;
    g.position.set(b.pos[0], b.pos[1], b.pos[2]);
    g.quaternion.set(b.quat[1], b.quat[2], b.quat[3], b.quat[0]);
    bodies.set(b.name, g);
    bodyIdByName.set(b.name, b);
  }
  for (const b of k.bodies) {
    const g = bodies.get(b.name)!;
    if (b.parent && bodies.has(b.parent)) bodies.get(b.parent)!.add(g);
    else root.add(g);
  }
  for (const b of k.bodies) {
    if (!b.joint || b.joint.type !== "hinge") continue;
    const g = bodies.get(b.name)!;
    joints.set(b.joint.name, {
      body: g,
      axis: new THREE.Vector3(b.joint.axis[0], b.joint.axis[1], b.joint.axis[2]).normalize(),
      baseQuat: g.quaternion.clone(),
    });
  }

  const useToon = opts.toon !== false;
  const gradient = useToon ? makeToonGradient() : null;
  // Cache materials by quantised rgba so the 14 xl330 motors etc. share
  // a single GPU material instance.
  const matCache = new Map<string, THREE.Material>();
  const matFor = (rgba: [number, number, number, number]): THREE.Material => {
    const r = Math.round(rgba[0] * 255), g = Math.round(rgba[1] * 255);
    const b = Math.round(rgba[2] * 255), a = Math.round(rgba[3] * 255);
    const key = `${r},${g},${b},${a}`;
    const cached = matCache.get(key);
    if (cached) return cached;
    const color = (r << 16) | (g << 8) | b;
    const transparent = a < 255;
    const opacity = a / 255;
    const m: THREE.Material = useToon
      ? new THREE.MeshToonMaterial({ color, gradientMap: gradient!, transparent, opacity })
      : new THREE.MeshLambertMaterial({ color, flatShading: !!opts.flatShading, transparent, opacity });
    matCache.set(key, m);
    return m;
  };

  for (const b of k.bodies) {
    const g = bodies.get(b.name);
    if (!g) continue;
    for (const geom of b.geoms) {
      if (geom.type && geom.type !== "mesh") continue;
      if (!geom.mesh) continue;
      void loadMesh(geom.mesh).then((geo) => {
        // Use the MJCF rgba so colours match the sim/CAD intent.
        const rgba: [number, number, number, number] = geom.color
          ? [geom.color[0], geom.color[1], geom.color[2], geom.color[3] ?? 1]
          : [0.85, 0.85, 0.85, 1];
        const m = new THREE.Mesh(geo, matFor(rgba));
        if (geom.pos) m.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
        if (geom.quat) m.quaternion.set(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
        m.castShadow = false;
        m.receiveShadow = false;
        g.add(m);
      });
    }
  }

  // Identify foot bodies for ground contact resolution. The MJCF names
  // them `foot` (left) and `foot_2` (right).
  const feet: THREE.Object3D[] = [];
  for (const name of ["foot", "foot_2"]) {
    const g = bodies.get(name);
    if (g) feet.push(g);
  }

  return { placer, root, bodies, joints, actuated: k.actuated_joints, bodyIdByName, feet };
}

// Drop the rig vertically so the lowest foot mesh sits on y=0. Computes
// a Box3 over the foot subtrees in world space — cheap (handful of
// meshes) and works for any pose.
const _box = new THREE.Box3();
export function groundFeet(rig: DuckRig, floorY = 0): number {
  if (rig.feet.length === 0) return 0;
  let minY = Infinity;
  for (const f of rig.feet) {
    f.updateWorldMatrix(true, true);
    _box.setFromObject(f);
    if (_box.min.y < minY) minY = _box.min.y;
  }
  if (!Number.isFinite(minY)) return 0;
  // Apply on placer.position.y so the result is visible to subsequent
  // world-space queries.
  rig.placer.position.y += floorY - minY;
  return floorY - minY;
}

// Place the duck in MJCF world coords (x, y in metres, yaw in radians)
// and yaw it. Z-axis grounding is left to groundFeet().
export function placeWorld(rig: DuckRig, x: number, y: number, yaw: number) {
  // MJCF (X, Y, Z) → scene (X, Z, -Y). Floor is at scene y=0.
  rig.placer.position.x = x;
  rig.placer.position.z = -y;
  rig.placer.rotation.y = yaw;
}

export function setJointAngles(rig: DuckRig, q: number[]) {
  for (let i = 0; i < rig.actuated.length && i < q.length; i++) {
    const j = rig.joints.get(rig.actuated[i]);
    if (!j) continue;
    const rot = new THREE.Quaternion().setFromAxisAngle(j.axis, q[i]);
    j.body.quaternion.copy(j.baseQuat).multiply(rot);
  }
}

// Sitting / curled-up sleeping pose. Joint signs mirror the MJCF ranges:
//   - left_hip_pitch  ∈ [0,  +1.57]   right_hip_pitch ∈ [-1.57, 0]
//   - left_knee       ∈ [-1.92, 0]    right_knee      ∈ [0, +1.92]
//   - left_ankle / right_ankle: symmetric ±1.57
//   - neck_pitch ∈ [-1.22, +2.09] — positive folds neck down/forward
//   - head_pitch ∈ [-1.22, +1.22]  — positive tucks chin down
export function applySleepPose(rig: DuckRig, t: number) {
  const breathe = Math.sin(t * 1.4) * 0.025;
  const pose: Record<string, number> = {
    // Legs folded under, knees fully bent.
    left_hip_yaw: 0.0,
    right_hip_yaw: 0.0,
    left_hip_roll: 0.0,
    right_hip_roll: 0.0,
    left_hip_pitch:  1.45,
    right_hip_pitch: -1.45,
    left_knee:  -1.85,
    right_knee:  1.85,
    left_ankle:  0.6,
    right_ankle: -0.6,
    // Head tucked forward + slight roll.
    neck_pitch: 1.6 + breathe * 0.5,
    head_pitch: 1.0,
    head_yaw:   0.0,
    head_roll:  0.0,
  };
  for (const [name, ang] of Object.entries(pose)) {
    const j = rig.joints.get(name);
    if (!j) continue;
    const rot = new THREE.Quaternion().setFromAxisAngle(j.axis, ang);
    j.body.quaternion.copy(j.baseQuat).multiply(rot);
  }
  // Body height is resolved by groundFeet() — once the legs fold, the
  // trunk sits naturally at floor level.
}
