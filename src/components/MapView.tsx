import { onCleanup, onMount, createEffect, Show } from "solid-js";
import { snapshot, mapBlob, postGoal } from "../state/connection";

export function MapView() {
  let canvas!: HTMLCanvasElement;
  let raf: number | null = null;
  let imgData: ImageData | null = null;
  let imgW = 0, imgH = 0;
  const [mb] = mapBlob;

  // Reactive: when a new map blob arrives, decode the PGM into ImageData.
  createEffect(async () => {
    const blob = mb();
    if (!blob || !canvas) return;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const decoded = decodePgm(buf, canvas.getContext("2d")!);
    if (decoded) {
      imgData = decoded.img;
      imgW = decoded.w;
      imgH = decoded.h;
      canvas.width = imgW;
      canvas.height = imgH;
    }
  });

  function draw() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (imgData) ctx.putImageData(imgData, 0, 0);
    else { ctx.fillStyle = "#fbf6e7"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    const s = snapshot();
    if (s?.map && s.map.cell_m > 0) {
      drawPath(ctx, s);
      drawDuck(ctx, s);
    }
    raf = requestAnimationFrame(draw);
  }

  onMount(() => { raf = requestAnimationFrame(draw); });
  onCleanup(() => { if (raf != null) cancelAnimationFrame(raf); });

  async function onCanvasClick(ev: MouseEvent) {
    const s = snapshot();
    if (!s?.map || s.map.cell_m <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const py = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const x = s.map.x_min + px * s.map.cell_m;
    const y = s.map.y_max - py * s.map.cell_m;
    await postGoal(x, y);
  }

  return (
    <div class="h-full flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <div class="text-xs text-slate2-600">
          <Show when={snapshot()} fallback="—">
            x={snapshot()!.x.toFixed(2)} m  y={snapshot()!.y.toFixed(2)} m  yaw={snapshot()!.yaw_deg.toFixed(0)}°
          </Show>
        </div>
        <div class="text-[11px] text-slate2-600">tap to send goal</div>
      </div>
      <div class="flex-1 grid place-items-center overflow-hidden rounded-xl bg-cream-100 ring-1 ring-slate2-100">
        <canvas
          ref={canvas!}
          width="1"
          height="1"
          style="image-rendering: pixelated; max-width:100%; max-height:100%; width:auto; height:auto;"
          onClick={onCanvasClick}
        />
      </div>
    </div>
  );
}

function drawDuck(ctx: CanvasRenderingContext2D, s: NonNullable<ReturnType<typeof snapshot>>) {
  const m = s.map!;
  const px = (s.x - m.x_min) / m.cell_m;
  const py = (m.y_max - s.y) / m.cell_m;
  const len = Math.max(0.25 / m.cell_m, 7);
  const a = -s.yaw_rad;
  const cos = Math.cos(a), sin = Math.sin(a);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "#070c16";
  ctx.fillStyle = "#ffd84d";
  ctx.beginPath();
  ctx.moveTo(px + len * cos, py + len * sin);
  ctx.lineTo(px + len * 0.5 * Math.cos(a + 2.4), py + len * 0.5 * Math.sin(a + 2.4));
  ctx.lineTo(px + len * 0.5 * Math.cos(a - 2.4), py + len * 0.5 * Math.sin(a - 2.4));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, Math.max(1.2, len * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, s: NonNullable<ReturnType<typeof snapshot>>) {
  if (!s.path?.length) return;
  const m = s.map!;
  ctx.save();
  ctx.strokeStyle = "#6cf0c0";
  ctx.fillStyle = "#6cf0c0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo((s.x - m.x_min) / m.cell_m, (m.y_max - s.y) / m.cell_m);
  for (const [wx, wy] of s.path) ctx.lineTo((wx - m.x_min) / m.cell_m, (m.y_max - wy) / m.cell_m);
  ctx.stroke();
  for (const [wx, wy] of s.path) {
    ctx.beginPath();
    ctx.arc((wx - m.x_min) / m.cell_m, (m.y_max - wy) / m.cell_m, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function decodePgm(bytes: Uint8Array, ctx: CanvasRenderingContext2D): { img: ImageData; w: number; h: number } | null {
  let i = 0;
  const next = (): string => {
    while (i < bytes.length) {
      while (i < bytes.length && bytes[i] <= 32) i++;
      if (bytes[i] === 0x23) { while (i < bytes.length && bytes[i] !== 0x0a) i++; continue; }
      break;
    }
    const start = i;
    while (i < bytes.length && bytes[i] > 32) i++;
    return new TextDecoder().decode(bytes.subarray(start, i));
  };
  const magic = next();
  if (magic !== "P5") return null;
  const w = parseInt(next(), 10);
  const h = parseInt(next(), 10);
  const maxv = parseInt(next(), 10);
  if (maxv !== 255) return null;
  if (bytes[i] <= 32) i++;
  const px = bytes.subarray(i, i + w * h);
  if (px.length !== w * h) return null;
  const img = ctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const v = px[p];
    img.data[p * 4 + 0] = v;
    img.data[p * 4 + 1] = v;
    img.data[p * 4 + 2] = v;
    img.data[p * 4 + 3] = 255;
  }
  return { img, w, h };
}
