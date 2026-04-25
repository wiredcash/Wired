"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[wire] global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: "#000",
          color: "#fff",
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#0a0a0a",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 24,
            padding: 20,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#FF6B6B",
              }}
            />
            <strong style={{ color: "#FF6B6B" }}>Fatal error</strong>
            {error.digest && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10.5,
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {error.digest}
              </span>
            )}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.65)",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              wordBreak: "break-all",
            }}
          >
            <strong style={{ color: "rgba(255,255,255,0.85)" }}>
              {error.name}:
            </strong>{" "}
            {error.message || "(no message)"}
          </div>
          {error.stack && (
            <details open style={{ marginTop: 12 }}>
              <summary
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.5)",
                  cursor: "pointer",
                }}
              >
                stack trace
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  fontSize: 10.5,
                  color: "rgba(255,255,255,0.55)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: "ui-monospace, monospace",
                  lineHeight: 1.4,
                }}
              >
                {error.stack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "6px 12px",
              borderRadius: 8,
              background: "#fff",
              color: "#000",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
