import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Jito tip accounts. Bundles include a SOL transfer to one of these so
 * Jito's block engine can capture the tip. Pick one at random per bundle
 * so we don't hot-spot a single account.
 *
 * Source: https://docs.jito.wtf/lowlatencytxnsend/#tip-amount-and-acco
 */
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBjNs1U3FwsmBJ",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
].map((s) => new PublicKey(s));

/** ~$0.01 at SOL=$100. Floor is 1k lamports; mid-tier landing odds at 100k. */
export const DEFAULT_TIP_LAMPORTS = 100_000;

export function pickTipAccount(): PublicKey {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

export function buildJitoTipIx(
  payer: PublicKey,
  lamports: number = DEFAULT_TIP_LAMPORTS,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: pickTipAccount(),
    lamports,
  });
}

function proxyBase(): string {
  if (typeof window !== "undefined") return "";
  return process.env.WIRE_PROXY_BASE ?? "http://localhost:3127";
}

/**
 * Generic JSON-RPC call to the /api/jito proxy. The proxy forwards
 * everything to the configured Jito block-engine URL.
 */
async function jitoRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(`${proxyBase()}/api/jito`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Jito ${method}: HTTP ${r.status} — ${text.slice(0, 200)}`);
  }
  let json: { result?: T; error?: unknown };
  try {
    json = JSON.parse(text) as { result?: T; error?: unknown };
  } catch {
    throw new Error(`Jito ${method}: non-JSON response: ${text.slice(0, 200)}`);
  }
  if (json.error) {
    throw new Error(`Jito ${method}: ${JSON.stringify(json.error)}`);
  }
  if (json.result === undefined) {
    throw new Error(`Jito ${method}: missing result`);
  }
  return json.result;
}

/**
 * Submit a bundle of up to 5 signed transactions to Jito. They land
 * atomically in the same block (or the bundle is dropped). Returns the
 * bundle ID for polling.
 */
export async function sendBundle(
  signedTxs: VersionedTransaction[],
): Promise<string> {
  if (signedTxs.length === 0) throw new Error("Empty bundle");
  if (signedTxs.length > 5) throw new Error("Jito bundles are capped at 5 txs");
  const encoded = signedTxs.map((tx) => bs58.encode(tx.serialize()));
  return jitoRpc<string>("sendBundle", [encoded]);
}

export type BundleStatusEntry = {
  bundle_id: string;
  /** Tx signatures of the txs in this bundle. */
  transactions: string[];
  /** Slot the bundle landed in. */
  slot: number | null;
  confirmation_status:
    | "processed"
    | "confirmed"
    | "finalized"
    | "Invalid"
    | "Pending"
    | null;
  /** `{ Ok: null }` on success; `{ error: ... }` on failure. */
  err: { Ok: null } | { error: unknown } | null;
};

export async function getBundleStatuses(
  bundleIds: string[],
): Promise<BundleStatusEntry[]> {
  const result = await jitoRpc<{ value?: BundleStatusEntry[] }>(
    "getBundleStatuses",
    [bundleIds],
  );
  return result.value ?? [];
}

/**
 * Poll until the bundle reaches `confirmed` (or `finalized`). Throws on
 * bundle-level error or timeout. Default 60s timeout, 1.5s poll interval.
 */
export async function pollBundleLanded(
  bundleId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<BundleStatusEntry> {
  const timeout = opts.timeoutMs ?? 60_000;
  const interval = opts.pollIntervalMs ?? 1_500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const statuses = await getBundleStatuses([bundleId]);
    const s = statuses[0];
    if (s) {
      if (s.err && "error" in s.err) {
        throw new Error(`Jito bundle reverted: ${JSON.stringify(s.err)}`);
      }
      if (
        s.confirmation_status === "confirmed" ||
        s.confirmation_status === "finalized"
      ) {
        return s;
      }
      if (s.confirmation_status === "Invalid") {
        throw new Error("Jito bundle was rejected as Invalid");
      }
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `Bundle ${bundleId.slice(0, 10)}… didn't land in ${timeout}ms`,
  );
}
