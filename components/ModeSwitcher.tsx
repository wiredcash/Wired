"use client";

import { useState } from "react";
import { Bridge } from "./Bridge";
import { Swap } from "./Swap";
import { PoolStrip } from "./PoolStrip";
import { ErrorBoundary } from "./ErrorBoundary";

type Mode = "bridge" | "swap";

export function ModeSwitcher() {
  const [mode, setMode] = useState<Mode>("swap");
  return (
    <div>
      <div className="flex justify-center mb-4">
        <div className="inline-flex p-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
          <Pill active={mode === "bridge"} onClick={() => setMode("bridge")}>
            Bridge
          </Pill>
          <Pill active={mode === "swap"} onClick={() => setMode("swap")}>
            Swap
          </Pill>
        </div>
      </div>
      <ErrorBoundary key={mode}>
        {mode === "bridge" ? (
          <>
            <Bridge />
            <PoolStrip />
          </>
        ) : (
          <Swap />
        )}
      </ErrorBoundary>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-1.5 rounded-full text-[13px] font-semibold transition-all " +
        (active
          ? "bg-white text-black shadow-[0_0_24px_-8px_rgba(255,233,75,0.45)]"
          : "text-white/55 hover:text-white")
      }
    >
      {children}
    </button>
  );
}
