import { Show } from "solid-js";
import { snapshot, asleep } from "../state/connection";

// NP-F550 = 2S Li-ion. Under load, usable range is roughly:
//   8.20 V  → 100 %  (just off a full charge)
//   7.40 V  →  50 %  (nominal mid-discharge)
//   6.60 V  →   0 %  (sag floor — duck starts struggling)
// Below 6.6 V we clamp to 0 % rather than going negative.
const V_FULL = 8.2;
const V_EMPTY = 6.6;

export function batteryPercent(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const t = (v - V_EMPTY) / (V_FULL - V_EMPTY);
  return Math.max(0, Math.min(1, t)) * 100;
}

export function BatteryPill() {
  const v = () => snapshot()?.battery_v ?? 0;
  const visible = () => !asleep() && v() > 0;
  const pct = () => batteryPercent(v());
  const tone = () => {
    const p = pct();
    return p > 50 ? "text-mint-600 ring-mint-500/30 bg-mint-300/40"
         : p > 20 ? "text-amber-600 ring-amber-400/40 bg-amber-300/30"
         :          "text-coral-500 ring-coral-400/40 bg-coral-400/15";
  };
  return (
    <Show when={visible()}>
      <span class={`pill ${tone()}`} title={`${v().toFixed(2)} V`}>
        <BatteryGlyph pct={pct()} />
        <span class="tabular-nums">{pct().toFixed(0)}%</span>
      </span>
    </Show>
  );
}

function BatteryGlyph(p: { pct: number }) {
  // Compact rounded battery icon. Fill width tracks pct.
  const fillW = Math.max(1, Math.round((p.pct / 100) * 14));
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="16.5" height="10.5" rx="2" ry="2"
            stroke="currentColor" stroke-width="1.2" />
      <rect x="18" y="3.5" width="2" height="5" rx="0.7" fill="currentColor" />
      <rect x="2.5" y="2.5" width={fillW} height="7" rx="1" fill="currentColor" opacity="0.85" />
    </svg>
  );
}
