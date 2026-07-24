import { createSignal, createMemo } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import type { DuckSnapshot } from "./telemetry";
import { STALE_MS } from "./telemetry";

export const [robotUrl, setRobotUrl] = makePersisted(
  createSignal<string>(defaultRobotUrl()),
  { name: "microduck.robotUrl" },
);

const [snapshot, setSnapshot] = createSignal<DuckSnapshot | null>(null);
const [lastSeenMs, setLastSeenMs] = createSignal<number>(0);
const [pollErr, setPollErr] = createSignal<string | null>(null);
const [now, setNow] = createSignal<number>(Date.now());
setInterval(() => setNow(Date.now()), 250);

export { snapshot, lastSeenMs, pollErr };

export const asleep = createMemo(() => now() - lastSeenMs() > STALE_MS);

export const mapBlob = createSignal<Blob | null>(null);
export const cameraBlob = createSignal<Blob | null>(null);
export const [cameraAvailable, setCameraAvailable] = createSignal<boolean>(false);

function defaultRobotUrl(): string {
  // Port 9876 is the real robot's default (microduck_runtime --web-port);
  // the sim publishes on the same port too. When the PWA is served from
  // the Pi itself (the recommended deployment), `window.location.host`
  // already resolves to the duck — no gear-menu step needed.
  if (typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    return `${window.location.protocol}//${host}:9876`;
  }
  return "http://localhost:9876";
}

let stopped = false;
export function startPolling() {
  stopped = false;
  loop();
}
export function stopPolling() {
  stopped = true;
}

async function loop() {
  while (!stopped) {
    const t0 = performance.now();
    try {
      const r = await fetch(joinUrl(robotUrl(), "/state.json"), {
        cache: "no-store",
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as DuckSnapshot;
      setSnapshot(j);
      setLastSeenMs(Date.now());
      setPollErr(null);
    } catch (e: any) {
      setPollErr(String(e?.message ?? e));
    }
    const dt = performance.now() - t0;
    // Aim for ~30 Hz so the 3D viewer interpolates between fresh frames
    // instead of visibly stepping at the old 5 Hz cadence.
    await sleep(Math.max(8, 33 - dt));
  }
}

async function fetchMap(): Promise<Blob | null> {
  try {
    const r = await fetch(joinUrl(robotUrl(), "/map.pgm"), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    return await r.blob();
  } catch {
    return null;
  }
}

let mapTicker: number | null = null;
export function startMapPolling(periodMs = 750) {
  if (mapTicker != null) return;
  const tick = async () => {
    const b = await fetchMap();
    if (b) mapBlob[1](b);
  };
  tick();
  mapTicker = window.setInterval(tick, periodMs);
}
export function stopMapPolling() {
  if (mapTicker != null) {
    window.clearInterval(mapTicker);
    mapTicker = null;
  }
}

// ── Camera ──────────────────────────────────────────────────────────────
// Prefers the runtime's live MJPEG push stream (`GET /camera.mjpg`, added
// in runtime v5.1.9): one multipart part per captured frame, so the view
// runs at the full camera rate (30 fps) with no polling. Older runtimes
// 404 on that path — those fall back to polling `/camera.jpg` at ~6.7 Hz.
// Both paths feed the same `cameraBlob` signal consumed by CameraView.

async function fetchCamera(): Promise<{ blob: Blob | null; reachable: boolean }> {
  try {
    const r = await fetch(joinUrl(robotUrl(), "/camera.jpg"), {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    // 503 = endpoint exists but no frame yet (runtime running without --stream,
    // or camera hasn't produced a frame yet). Reachable, but no image.
    if (r.status === 503) return { blob: null, reachable: true };
    if (!r.ok) return { blob: null, reachable: false };
    return { blob: await r.blob(), reachable: true };
  } catch {
    return { blob: null, reachable: false };
  }
}

// Parse a multipart/x-mixed-replace MJPEG body, invoking `emit` once per
// complete JPEG part. Returns when the stream ends or is aborted.
async function readMjpeg(
  body: ReadableStream<Uint8Array>,
  emit: (b: Blob) => void,
): Promise<void> {
  const reader = body.getReader();
  const headerEnd = [13, 10, 13, 10]; // \r\n\r\n
  let buf = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
    for (;;) {
      const he = indexOfSeq(buf, headerEnd);
      if (he < 0) break;
      const head = new TextDecoder().decode(buf.subarray(0, he));
      const m = head.match(/content-length:\s*(\d+)/i);
      if (!m) {
        buf = buf.subarray(he + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const start = he + 4;
      if (buf.length < start + len) break; // body incomplete — need more bytes
      emit(new Blob([buf.subarray(start, start + len)], { type: "image/jpeg" }));
      buf = buf.subarray(start + len);
    }
    if (buf.length > 4 << 20) buf = new Uint8Array(0); // malformed-input guard
  }
}

function indexOfSeq(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

let cameraStop: (() => void) | null = null;

export function startCameraPolling() {
  if (cameraStop) return;
  let stopped = false;
  let ctrl: AbortController | null = null;
  let lastFrameMs = 0;

  const emit = (blob: Blob) => {
    lastFrameMs = Date.now();
    setCameraAvailable(true);
    cameraBlob[1](blob);
  };

  // "live" badge: a frame counts as fresh for 2 s.
  const watchdog = window.setInterval(() => {
    if (Date.now() - lastFrameMs > 2000) setCameraAvailable(false);
  }, 500);

  (async () => {
    // Consecutive stream attempts that produced zero frames. After a few,
    // assume the stream is unusable on this runtime (pre-v5.1.9 404, CORS,
    // proxy…) and poll snapshots for a while before probing the stream
    // again — polling works against every runtime version.
    let dryRuns = 0;
    while (!stopped) {
      const base = robotUrl();
      ctrl = new AbortController();
      // Restart the stream if the robot URL is changed in the gear menu.
      const urlCheck = window.setInterval(() => {
        if (robotUrl() !== base) ctrl?.abort();
      }, 500);
      let gotFrames = false;
      try {
        const r = await fetch(joinUrl(base, "/camera.mjpg"), {
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (r.ok && r.body && r.status !== 404) {
          await readMjpeg(r.body, (b) => {
            gotFrames = true;
            emit(b);
          });
        }
      } catch {
        /* robot unreachable / stream dropped / aborted — handled below */
      } finally {
        window.clearInterval(urlCheck);
      }
      if (stopped) break;
      dryRuns = gotFrames ? 0 : dryRuns + 1;
      if (dryRuns >= 3) {
        // Snapshot-poll for 20 s, then give the stream another chance.
        const until = Date.now() + 20_000;
        while (!stopped && robotUrl() === base && Date.now() < until) {
          const { blob } = await fetchCamera();
          if (blob) emit(blob);
          await sleep(150);
        }
      } else {
        await sleep(1000);
      }
    }
  })();

  cameraStop = () => {
    stopped = true;
    ctrl?.abort();
    window.clearInterval(watchdog);
    setCameraAvailable(false);
  };
}

export function stopCameraPolling() {
  cameraStop?.();
  cameraStop = null;
}

export async function postGoal(x: number, y: number): Promise<boolean> {
  try {
    const r = await fetch(joinUrl(robotUrl(), "/goal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function postCommand(cmd: string, args: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const r = await fetch(joinUrl(robotUrl(), "/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, ...args }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}
