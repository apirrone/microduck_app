import { Show } from "solid-js";
import { robotUrl, setRobotUrl, pollErr } from "../state/connection";

export function SettingsSheet(props: { open: boolean; onClose: () => void }) {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-slate2-900/30 backdrop-blur-sm" onClick={props.onClose} />
        <div class="absolute inset-x-0 bottom-0 card p-5 rounded-b-none rounded-t-3xl pb-[max(env(safe-area-inset-bottom),16px)]">
          <div class="mx-auto max-w-md">
            <div class="mb-3 flex items-center justify-between">
              <div class="text-sm font-extrabold">Connection</div>
              <button class="btn !px-2.5 !py-1 text-xs" onClick={props.onClose}>Done</button>
            </div>
            <label class="block">
              <span class="text-xs text-slate2-600">Robot URL</span>
              <input
                class="input mt-1"
                placeholder="http://duck.local:8080"
                value={robotUrl()}
                onInput={(e) => setRobotUrl(e.currentTarget.value)}
              />
            </label>
            <Show when={pollErr()}>
              <div class="mt-3 rounded-xl bg-coral-400/15 ring-1 ring-coral-400/30 px-3 py-2 text-xs text-coral-500">
                {pollErr()}
              </div>
            </Show>
            <p class="mt-4 text-[11px] text-slate2-600 leading-relaxed">
              Point this at the sim server (default <code class="text-slate2-900">localhost:8080</code> from
              <code class="text-slate2-900"> microduck_brain</code>) or at the robot's
              <code class="text-slate2-900"> maploc-web</code> port.
            </p>
          </div>
        </div>
      </div>
    </Show>
  );
}
