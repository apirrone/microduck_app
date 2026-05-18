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

let cameraTicker: number | null = null;
export function startCameraPolling(periodMs = 150) {
  if (cameraTicker != null) return;
  const tick = async () => {
    const { blob, reachable } = await fetchCamera();
    setCameraAvailable(reachable && blob != null);
    if (blob) cameraBlob[1](blob);
  };
  tick();
  cameraTicker = window.setInterval(tick, periodMs);
}
export function stopCameraPolling() {
  if (cameraTicker != null) {
    window.clearInterval(cameraTicker);
    cameraTicker = null;
  }
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
