import { createEffect, onCleanup, Show } from "solid-js";
import { cameraBlob, cameraAvailable } from "../state/connection";

// Head camera is physically mounted rotated 90°. Flip the sign here if the
// image ends up the wrong way round.
const HEAD_CAM_ROTATION_DEG = -90;

export function CameraView() {
  const [mb] = cameraBlob;
  let canvas!: HTMLCanvasElement;

  // Decode each new JPEG into an Image, then blit rotated into the canvas.
  // The canvas dimensions are sized to the *rotated* image so the parent's
  // `object-fit: contain` letterboxes it correctly.
  createEffect(() => {
    const blob = mb();
    if (!blob || !canvas) return;
    const img = new Image();
    const u = URL.createObjectURL(blob);
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const rot = ((HEAD_CAM_ROTATION_DEG % 360) + 360) % 360;
      const swapped = rot === 90 || rot === 270;
      canvas.width = swapped ? h : w;
      canvas.height = swapped ? w : h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2);
        ctx.restore();
      }
      URL.revokeObjectURL(u);
    };
    img.onerror = () => URL.revokeObjectURL(u);
    img.src = u;
  });

  onCleanup(() => {});

  return (
    <div class="h-full flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <div class="text-xs text-slate2-600">camera</div>
        <div class="text-[11px] text-slate2-600">
          {cameraAvailable() ? "live" : "no stream"}
        </div>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl bg-cream-100 ring-1 ring-slate2-100 relative">
        <canvas
          ref={canvas!}
          width="1"
          height="1"
          style="width:100%; height:100%; object-fit:contain; display:block;"
        />
        <Show when={!cameraAvailable()}>
          <div class="absolute inset-0 grid place-items-center text-center text-slate2-600 text-xs px-4 bg-cream-100">
            <div>
              <div class="text-2xl mb-2">📷</div>
              waiting for camera…
              <div class="text-[10px] mt-1 opacity-70">run microduck_runtime with --stream</div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
