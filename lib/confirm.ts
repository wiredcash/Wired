import {
  Connection,
  TransactionSignature,
  type Commitment,
} from "@solana/web3.js";

/**
 * Wait for a transaction signature to reach `desiredCommitment` using
 * `getSignatureStatuses` polling — no WebSocket subscription.
 *
 * The default `connection.confirmTransaction` opens a WS subscription
 * to the RPC, which doesn't survive on serverless platforms (Vercel
 * Functions don't proxy WebSockets). Polling goes through our /api/rpc
 * HTTP proxy and works everywhere.
 */
export async function confirmSignaturePolling(
  connection: Connection,
  signature: TransactionSignature,
  opts: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    desiredCommitment?: Commitment;
  } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const desired = opts.desiredCommitment ?? "confirmed";

  const start = Date.now();
  while (true) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(status.err)}`,
        );
      }
      if (
        rank(status.confirmationStatus ?? null) >= rank(desired)
      ) {
        return;
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${signature.slice(0, 10)}…`,
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

function rank(c: Commitment | null): number {
  if (c === "finalized") return 2;
  if (c === "confirmed") return 1;
  if (c === "processed") return 0;
  return -1;
}
