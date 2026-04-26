import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { indexCurrencies, type IndexedCurrency } from "@/lib/flipcash/index-currencies";

const TTL_MS = 60_000;

let cache: { at: number; data: IndexedCurrency[] } | null = null;
let inflight: Promise<IndexedCurrency[]> | null = null;

function rpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com"
  );
}

async function loadFresh(): Promise<IndexedCurrency[]> {
  const url = rpcUrl();
  const conn = new Connection(url, "confirmed");
  const data = await indexCurrencies(conn, url);
  cache = { at: Date.now(), data };
  return data;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json(
      { fresh: false, ageMs: now - cache.at, count: cache.data.length, items: cache.data },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  }
  if (!inflight) {
    inflight = loadFresh().finally(() => {
      inflight = null;
    });
  }
  try {
    const items = await inflight;
    return NextResponse.json(
      { fresh: true, ageMs: 0, count: items.length, items },
      { headers: { "Cache-Control": "public, max-age=30" } },
    );
  } catch (err) {
    if (cache) {
      return NextResponse.json(
        {
          fresh: false,
          stale: true,
          error: (err as Error).message,
          ageMs: Date.now() - cache.at,
          count: cache.data.length,
          items: cache.data,
        },
        { status: 200, headers: { "Cache-Control": "public, max-age=10" } },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
