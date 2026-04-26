import { NextRequest, NextResponse } from "next/server";

const JUP_BASE = "https://api.jup.ag/swap/v1";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "JUPITER_API_KEY not set" },
      { status: 500 },
    );
  }

  const params = req.nextUrl.searchParams;
  const url = `${JUP_BASE}/quote?${params.toString()}`;

  try {
    const r = await fetch(url, {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: "jupiter quote failed", upstream: text, status: r.status },
        { status: r.status },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
