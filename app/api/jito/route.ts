import { NextRequest, NextResponse } from "next/server";

/**
 * Jito block engine proxy. The block engine is public (no API key
 * required), but we proxy through our origin anyway so:
 *   • the upstream URL is configurable per deployment via env,
 *   • the browser's network panel only shows our own /api/* calls,
 *   • we can layer rate limiting and observability later.
 *
 * All Jito calls are POST JSON-RPC to the same endpoint, so one route
 * handler is enough.
 */

const DEFAULT_URL = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const url = process.env.JITO_BLOCK_ENGINE_URL ?? DEFAULT_URL;
  const body = await req.text();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
