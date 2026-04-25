"use client";

import { useState } from "react";

export function CurrencyIcon({
  src,
  symbol,
  size = 28,
}: {
  src: string | null;
  symbol: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const showImg = src && !errored;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full overflow-hidden bg-white/[0.05] ring-1 ring-white/10 shrink-0"
      style={{ width: size, height: size }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={symbol}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-bold text-white/70"
          style={{ fontSize: size * 0.42, letterSpacing: "-0.04em" }}
        >
          {(symbol[0] ?? "?").toUpperCase()}
        </span>
      )}
    </span>
  );
}
