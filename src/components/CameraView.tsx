import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { cameraBlob, cameraAvailable } from "../state/connection";

export function CameraView() {
  const [mb] = cameraBlob;
  const [url, setUrl] = createSignal<string | null>(null);
  let prevUrl: string | null = null;

  createEffect(() => {
    const blob = mb();
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    prevUrl = next;
  });

  onCleanup(() => {
    if (prevUrl) URL.revokeObjectURL(prevUrl);
  });

  return (
    <div class="h-full flex flex-col gap-2">
      <div class="flex items-center justify-between px-1">
        <div class="text-xs text-slate2-600">camera</div>
        <div class="text-[11px] text-slate2-600">
          {cameraAvailable() ? "live" : "no stream"}
        </div>
      </div>
      <div class="flex-1 overflow-hidden rounded-xl bg-cream-100 ring-1 ring-slate2-100 grid place-items-center">
        <Show
          when={url() && cameraAvailable()}
          fallback={
            <div class="text-center text-slate2-600 text-xs px-4">
              <div class="text-2xl mb-2">📷</div>
              waiting for camera…
              <div class="text-[10px] mt-1 opacity-70">run microduck_runtime with --stream</div>
            </div>
          }
        >
          <img
            src={url()!}
            alt="camera"
            style="image-rendering: pixelated; width:100%; height:100%; object-fit:contain; display:block;"
          />
        </Show>
      </div>
    </div>
  );
}
