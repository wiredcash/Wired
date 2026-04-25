"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // Surface in the prod console — devs grep for this when debugging.
    // eslint-disable-next-line no-console
    console.error("[wire] error boundary:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const e = this.state.error;
    return (
      <div className="card p-5 text-[13px] leading-relaxed">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-err" />
          <span className="font-semibold text-err">Something broke</span>
        </div>
        <div className="text-white/65 font-mono text-[12px] break-all">
          <strong className="text-white/85">{e.name}:</strong>{" "}
          {e.message || "(no message)"}
        </div>
        {e.stack && (
          <details className="mt-3">
            <summary className="text-[11px] text-white/45 cursor-pointer">
              stack trace
            </summary>
            <pre className="mt-2 text-[10.5px] text-white/45 whitespace-pre-wrap break-all font-mono">
              {e.stack}
            </pre>
          </details>
        )}
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-4 px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/70 hover:bg-white/[0.1] text-[12px]"
        >
          Try again
        </button>
      </div>
    );
  }
}
