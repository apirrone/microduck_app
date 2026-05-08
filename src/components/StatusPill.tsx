import { Show } from "solid-js";
import { asleep, snapshot, pollErr } from "../state/connection";

export function StatusPill() {
  return (
    <Show
      when={!asleep()}
      fallback={
        <span class="pill bg-coral-400/15 text-coral-500 ring-coral-400/30">
          <Dot color="bg-coral-400" />
          {pollErr() ? "offline" : "sleeping"}
        </span>
      }
    >
      <span class="pill bg-mint-300/40 text-mint-600 ring-mint-500/30">
        <Dot color="bg-mint-500 animate-pulse" />
        {snapshot()?.lock ?? "live"}
      </span>
    </Show>
  );
}

function Dot(p: { color: string }) {
  return <span class={`size-1.5 rounded-full ${p.color}`} />;
}
