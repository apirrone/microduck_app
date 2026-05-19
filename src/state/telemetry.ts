// Telemetry shapes shared between sim server (microduck_brain) and the
// real-robot server (microduck_runtime/maploc_web.rs). Intentionally a
// superset — fields are optional so each backend can fill what it has.

export type LockState = "tracking" | "searching";

export interface MapMeta {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  cell_m: number;
}

/// One entry of the `objects` array — a single detected object reported
/// by the runtime, in world frame (the same frame the duck is rendered
/// in).  `class` picks the emoji shown in the 3D view.
export interface DetectedObject {
  class: string;
  world_pos: [number, number, number];
  score: number;
  ts_s: number;
}

export interface DuckSnapshot {
  duck_id?: string;
  // Pose in world frame
  x: number;
  y: number;
  yaw_rad: number;
  yaw_deg: number;
  // Localisation health
  lock?: LockState;
  uptime_s?: number;
  // Maploc internals (real robot)
  n_submaps?: number;
  n_edges?: number;
  n_loops?: number;
  // Map extent so renderer can draw on top of /map.pgm
  map?: MapMeta;
  // Currently followed waypoints (world coords)
  path?: [number, number][];
  // Joint positions in radians, ordered as kinematics.json `actuated_joints`.
  joints?: number[];
  // Brain HUD bits (optional — sim only for now)
  behavior?: string;
  drives?: Record<string, number>;
  mood?: Record<string, number>;
  /// Heavily-smoothed average motor-bus voltage in volts.
  battery_v?: number;
  /// Hardware variant — picks which mesh bundle the 3D viewer loads.
  /// Values: "v1", "v1.5". Missing on older runtimes; PWA falls back
  /// to v1.5 (the current/default model).
  robot_version?: string;
  /// Detected objects in world frame.  Rendered as emoji sprites in the
  /// 3D view; empty/missing means nothing in sight.
  objects?: DetectedObject[];
  /// Head-camera pose in world frame (MJCF +Z up).  Rendered in the 3D
  /// view as a small arrow for debugging projection / FK.  Missing when
  /// the runtime hasn't computed it (sim) or `cam_valid` is false.
  cam_world_pos?: [number, number, number];
  cam_world_fwd?: [number, number, number];
  cam_valid?: boolean;
}

export interface RootState {
  // Most recent snapshot from the active duck. null while bootstrapping.
  snapshot: DuckSnapshot | null;
  // Wall-clock ms timestamp of the last successful poll.
  last_seen_ms: number;
  // True when we've never seen telemetry, or haven't seen any in > stale_ms.
  asleep: boolean;
}

export const STALE_MS = 3000;
