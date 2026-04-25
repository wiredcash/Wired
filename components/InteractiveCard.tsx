"use client";

import dynamic from "next/dynamic";
import { CardSkeleton } from "./CardSkeleton";

// dynamic({ ssr: false }) only works from inside a client boundary in App
// Router. This wrapper exists so the page (server component) can drop in a
// truly client-only ModeSwitcher and avoid hydration mismatches caused by
// browser wallet extensions injecting state before React hydrates.
const ModeSwitcher = dynamic(
  () => import("./ModeSwitcher").then((m) => m.ModeSwitcher),
  { ssr: false, loading: () => <CardSkeleton /> },
);

export function InteractiveCard() {
  return <ModeSwitcher />;
}
