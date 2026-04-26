"use client";

import type { Provider, RouteStep } from "@/lib/multi-hop";

export type RouteSummaryProps = {
  /** Loading state — shows a skeleton when true. */
  loading?: boolean;
  /** Hops in the chosen route, in execution order. */
  steps: RouteStep[] | null;
  /** Which side of the aggregator won. */
  provider: Provider | null;
  /** Optional: best alternative output for the badge tooltip. */
  alt?: { providerLabel: string; deltaPct: number } | null;
};

/**
 * Compact panel under the swap card showing the chosen route. Updates as
 * the user types — when the aggregator switches paths (e.g., Jupiter beats
 * the bonding curve), the panel re-renders with the new hops.
 */
export function RouteSummary({
  loading,
  steps,
  provider,
  alt,
}: RouteSummaryProps) {
  if (loading && (!steps || steps.length === 0)) {
    return (
      <div className="mt-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] px-4 py-3 animate-pulse">
        <div className="h-3 w-20 bg-white/[0.06] rounded mb-2" />
        <div className="h-3 w-3/5 bg-white/[0.06] rounded" />
      </div>
    );
  }
  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-white/40">
          <span>Route</span>
        </div>
        {provider && (
          <ProviderBadge provider={provider} alt={alt ?? null} />
        )}
      </div>
      <div className="px-4 pb-3.5 space-y-1.5">
        {steps.map((step, i) => (
          <Step key={i} step={step} index={i} last={i === steps.length - 1} />
        ))}
      </div>
    </div>
  );
}

function Step({
  step,
  index,
  last,
}: {
  step: RouteStep;
  index: number;
  last: boolean;
}) {
  return (
    <div className="flex items-stretch gap-2.5">
      {/* gutter with number + connector */}
      <div className="flex flex-col items-center pt-0.5 w-4">
        <div className="w-4 h-4 rounded-full bg-white/[0.08] flex items-center justify-center text-[9px] text-white/55 font-mono">
          {index + 1}
        </div>
        {!last && (
          <div className="w-px flex-1 bg-white/[0.08] mt-0.5 mb-1" />
        )}
      </div>
      <div className="flex-1 min-w-0 pb-0.5">
        <div className="text-[12.5px] text-white/80 tabular-nums">
          <span className="font-semibold">{step.from}</span>
          <span className="mx-1.5 text-white/30">→</span>
          <span className="font-semibold">{step.to}</span>
        </div>
        <div className="text-[11px] text-white/45 mt-0.5">{step.via}</div>
      </div>
    </div>
  );
}

function ProviderBadge({
  provider,
  alt,
}: {
  provider: Provider;
  alt: { providerLabel: string; deltaPct: number } | null;
}) {
  const isJupiter = provider === "jupiter-direct";
  const label = isJupiter ? "Jupiter" : "Flipcash curve";
  return (
    <div
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-medium tracking-tight " +
        (isJupiter
          ? "bg-spark/[0.10] text-spark border border-spark/20"
          : "bg-white/[0.05] text-white/65 border border-white/[0.08]")
      }
      title={
        alt
          ? `Best of 2 quotes · ${alt.deltaPct.toFixed(2)}% better than ${alt.providerLabel}`
          : "Aggregator chose this route"
      }
    >
      <span
        className={
          "inline-block w-1 h-1 rounded-full " +
          (isJupiter ? "bg-spark" : "bg-white/40")
        }
      />
      Best · {label}
    </div>
  );
}
