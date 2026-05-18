import { Show, createSignal, onMount } from "solid-js";
import { startPolling, startMapPolling, startCameraPolling, asleep, snapshot, pollErr } from "./state/connection";
import { DuckViewer } from "./components/DuckViewer";
import { MapView } from "./components/MapView";
import { CameraView } from "./components/CameraView";
import { SettingsSheet } from "./components/SettingsSheet";
import { StatusPill } from "./components/StatusPill";
import { BatteryPill } from "./components/BatteryPill";
import { BrainHUD } from "./components/BrainHUD";

type Tab = "duck" | "map" | "camera";

export default function App() {
  const [tab, setTab] = createSignal<Tab>("duck");
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  onMount(() => {
    startPolling();
    startMapPolling();
    startCameraPolling();
  });

  return (
    <div class="h-full flex flex-col">
      <header class="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div class="flex items-center gap-2.5">
          <div class="size-10 rounded-2xl bg-duck-500 grid place-items-center text-slate2-900 shadow-soft">
            <span class="text-xl leading-none">🦆</span>
          </div>
          <div class="leading-tight">
            <div class="text-sm font-extrabold tracking-tight">Microduck</div>
            <Show when={snapshot()?.behavior} fallback={<div class="text-[11px] text-slate2-600">companion</div>}>
              <div class="text-[11px] text-slate2-600">{snapshot()!.behavior}</div>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <BatteryPill />
          <StatusPill />
          <button class="btn !px-2.5" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
          </button>
        </div>
      </header>

      <main class="relative flex-1 px-3 pb-24 overflow-hidden">
        {/* All three panes stay mounted *and* keep their layout box (same
            absolute size) across tab switches. We toggle visibility +
            pointer-events instead of `display: none` because collapsing
            the duck canvas to 0×0 on mobile browsers can drop the WebGL
            context's GPU state, which makes meshes re-stream into view
            when the tab becomes visible again. */}
        <section
          class="absolute inset-x-3 top-0 bottom-24 grid grid-rows-[1fr_auto] gap-3"
          style={{
            visibility: tab() === "duck" ? "visible" : "hidden",
            "pointer-events": tab() === "duck" ? "auto" : "none",
          }}
        >
          <div class="card relative overflow-hidden">
            <DuckViewer asleep={asleep()} snapshot={snapshot()} />
            <Show when={asleep()}>
              <div class="absolute inset-x-0 bottom-3 text-center text-slate2-600 text-xs">
                💤 sleeping{pollErr() ? ` — ${pollErr()}` : ""}
              </div>
            </Show>
          </div>
          <BrainHUD snapshot={snapshot()} />
        </section>
        <div
          class="absolute inset-x-3 top-0 bottom-24 card p-2 overflow-hidden"
          style={{
            visibility: tab() === "map" ? "visible" : "hidden",
            "pointer-events": tab() === "map" ? "auto" : "none",
          }}
        >
          <MapView />
        </div>
        <div
          class="absolute inset-x-3 top-0 bottom-24 card p-2 overflow-hidden"
          style={{
            visibility: tab() === "camera" ? "visible" : "hidden",
            "pointer-events": tab() === "camera" ? "auto" : "none",
          }}
        >
          <CameraView />
        </div>
      </main>

      <nav class="fixed inset-x-0 bottom-0 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 bg-gradient-to-t from-cream-50 via-cream-50/85 to-transparent">
        <div class="card mx-auto max-w-md flex p-1.5 gap-1">
          <TabButton active={tab() === "duck"} onClick={() => setTab("duck")} label="Duck" icon="duck" />
          <TabButton active={tab() === "map"} onClick={() => setTab("map")} label="Map" icon="map" />
          <TabButton active={tab() === "camera"} onClick={() => setTab("camera")} label="Camera" icon="camera" />
        </div>
      </nav>

      <SettingsSheet open={settingsOpen()} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; label: string; icon: "duck" | "map" | "camera" }) {
  return (
    <button
      onClick={props.onClick}
      class={`flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition
              ${props.active ? "bg-mint-500 text-white shadow-glow" : "text-slate2-600 hover:bg-cream-100"}`}
    >
      <Show when={props.icon === "duck"}>🦆</Show>
      <Show when={props.icon === "map"}>🗺️</Show>
      <Show when={props.icon === "camera"}>📷</Show>
      {props.label}
    </button>
  );
}
