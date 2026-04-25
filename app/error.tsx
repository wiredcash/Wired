"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[wire] route error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-md w-full p-5 text-[13px] leading-relaxed">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block w-2 h-2 rounded-full bg-err" />
          <span className="font-semibold text-err">Page error</span>
          {error.digest && (
            <span className="ml-auto text-[10.5px] text-white/40 font-mono">
              {error.digest}
            </span>
          )}
        </div>
        <div className="text-white/65 font-mono text-[12px] break-all">
          <strong className="text-white/85">{error.name}:</strong>{" "}
          {error.message || "(no message)"}
        </div>
        {error.stack && (
          <details className="mt-3" open>
            <summary className="text-[11px] text-white/50 cursor-pointer">
              stack trace
            </summary>
            <pre className="mt-2 text-[10.5px] text-white/55 whitespace-pre-wrap break-all font-mono leading-snug">
              {error.stack}
            </pre>
          </details>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-white/85 text-[12px] font-semibold"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
