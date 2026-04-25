"use client";

import Image from "next/image";

const ICONS: Record<string, { src: string; alt: string }> = {
  USDF: { src: "/usdf.png", alt: "USDF" },
  USDC: { src: "/usdc.png", alt: "USDC" },
};

export function TokenIcon({
  symbol,
  size = 20,
}: {
  symbol: string;
  size?: number;
}) {
  const icon = ICONS[symbol];
  if (!icon) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 text-white/70 font-bold"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
      >
        {symbol[0]}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full overflow-hidden ring-1 ring-white/10 bg-black"
      style={{ width: size, height: size }}
    >
      <Image
        src={icon.src}
        alt={icon.alt}
        width={size}
        height={size}
        className="object-cover"
      />
    </span>
  );
}
