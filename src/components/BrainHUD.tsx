import { For, Show } from "solid-js";
import type { DuckSnapshot } from "../state/telemetry";

const DRIVE_COLORS: Record<string, string> = {
  energy: "bg-mint-500",
  curiosity: "bg-sky-400",
  social: "bg-duck-500",
  rest: "bg-slate2-400",
  fear: "bg-coral-500",
};

export function BrainHUD(props: { snapshot: DuckSnapshot | null }) {
  return (
    <Show when={props.snapshot?.drives || props.snapshot?.behavior}>
      <div class="card p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs uppercase tracking-wider text-slate2-600 font-bold">Brain</div>
          <Show when={props.snapshot?.behavior}>
            <div class="pill bg-mint-300/40 text-mint-600 ring-mint-500/30">
              {props.snapshot!.behavior}
            </div>
          </Show>
        </div>
        <Show when={props.snapshot?.drives}>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <For each={Object.entries(props.snapshot!.drives!)}>
              {([k, v]) => <Bar label={k} value={v} color={DRIVE_COLORS[k] ?? "bg-slate2-400"} />}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function Bar(p: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, p.value)) * 100;
  return (
    <div class="flex items-center gap-2 text-xs">
      <span class="w-16 text-slate2-600 capitalize">{p.label}</span>
      <div class="relative flex-1 h-1.5 rounded-full bg-slate2-100 overflow-hidden">
        <div class={`absolute inset-y-0 left-0 ${p.color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span class="w-9 text-right tabular-nums text-slate2-600">{p.value.toFixed(2)}</span>
    </div>
  );
}
