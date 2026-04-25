import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        surface: "#0a0a0a",
        elevated: "#0f0f10",
        hairline: "rgba(255,255,255,0.07)",
        hairline2: "rgba(255,255,255,0.12)",
        muted: "rgba(255,255,255,0.50)",
        dim: "rgba(255,255,255,0.32)",
        spark: "#FFE94B",
        sparkSoft: "rgba(255,233,75,0.12)",
        ok: "#7DFFB7",
        err: "#FF6B6B",
      },
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Inter"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 60px -15px rgba(255,233,75,0.35)",
        card: "0 30px 80px -40px rgba(255,255,255,0.12), 0 1px 0 rgba(255,255,255,0.04) inset",
      },
      backgroundImage: {
        "radial-spark":
          "radial-gradient(60% 50% at 50% 0%, rgba(255,233,75,0.10) 0%, rgba(0,0,0,0) 70%)",
        "grid-faint":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
      },
      animation: {
        "pulse-soft": "pulseSoft 4s ease-in-out infinite",
        "marquee": "marquee 60s linear infinite",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
