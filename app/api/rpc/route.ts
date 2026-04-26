import { NextRequest, NextResponse } from "next/server";

/**
 * Solana JSON-RPC proxy. The browser's Connection talks to this route
 * instead of the upstream RPC, so the API key in `SOLANA_RPC_URL` never
 * appears in the public bundle.
 *
 * Use cases that pass through:
 *   - POST  /api/rpc                  → standard JSON-RPC
 *   - GET   /api/rpc?method=getHealth → some clients use GET for trivial calls
 *
 * NOT proxied: WebSocket subscriptions. We don't use them.
 */

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

function targetUrl(): string {
  return process.env.SOLANA_RPC_URL ?? DEFAULT_RPC;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.text();
  try {
    const r = await fetch(targetUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: {
        "Content-Type":
          r.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: -32603, message: (e as Error).message } },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest) {
  const upstream = new URL(targetUrl());
  req.nextUrl.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));
  try {
    const r = await fetch(upstream.toString(), { cache: "no-store" });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: {
        "Content-Type":
          r.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { code: -32603, message: (e as Error).message } },
      { status: 502 },
    );
  }
}
