# wired-router

A Solana program that wraps **Jupiter**, the **USDF↔USDC bridge**
(`usdf-swap-program`), and the **Flipcash bonding curve**
(`flipcash-program`) into a single user-signed instruction, with a 1%
integrator fee taken on every swap.

> Status: **built but not deployed**. The address in `declare_id!` is a
> placeholder — generate a real keypair before `anchor build` /
> `anchor deploy`.

## Why

The off-chain Wired client already aggregates between the curve and
Jupiter, but:

1. The **1% integrator fee** can only be taken on Jupiter-touching
   routes today (via Jupiter's `platformFeeBps`). Pure-curve buys/sells
   slip through fee-free.
2. **Split routing** (e.g. 30% via Jupiter, 70% via the curve) is
   physically impossible to fit into a single transaction without a
   custom dispatcher program — too many separate instructions, busts
   the 1232-byte tx limit. The current client falls back to
   winner-takes-all.

This program solves both. Every swap that goes through `route_buy` /
`route_sell` pays the fee, and split routing fits in one signature
because the multiple CPIs are wrapped inside one program ix.

## Instructions

### `route_buy`

```rust
fn route_buy(ctx, args: RouteBuyArgs) -> Result<()>
```

Args:

| field | type | meaning |
| --- | --- | --- |
| `total_input_amount` | u64 | Source-mint quarks pulled from the user. |
| `jupiter_in_amount`  | u64 | Portion routed through Jupiter (input → target). |
| `curve_in_amount`    | u64 | Portion routed through bridge + flipcash buy. |
| `min_target_out`     | u64 | Worst-case target tokens the user must receive. |
| `flipcash_min_out`   | u64 | Min target tokens accepted by the flipcash buy ix. |
| `curve_input_is_usdf`| bool | If true, skip the bridge — curve portion is USDF directly. |
| `jupiter_ix_data`    | Vec\<u8\> | Raw Jupiter swap-instructions data (empty when no Jupiter portion). |
| `jupiter_account_count` | u8 | First N `remaining_accounts` are Jupiter's. |

Logic:

1. Transfer 1% of `total_input_amount` from user's input ATA to the
   FEE_OWNER's ATA for that mint.
2. CPI Jupiter with `jupiter_ix_data` and the first
   `jupiter_account_count` of `remaining_accounts`. Output lands in
   `user_target_ata`.
3. CPI the bridge (USDC → USDF) for `curve_in_amount`, unless
   `curve_input_is_usdf`. Output lands in `user_usdf_ata`.
4. CPI flipcash `buy` for `curve_in_amount` USDF, with
   `flipcash_min_out` slippage guard. Output adds to `user_target_ata`.
5. Verify the net delta on `user_target_ata` ≥ `min_target_out`.

### `route_sell`

Mirror of `route_buy`: flipcash sell → optional bridge → optional
Jupiter, with fee taken in the source (currency) mint.

## Fee

Hardcoded at compile time:

```rust
pub const FEE_OWNER: Pubkey = pubkey!("8w985ENi8Gikora3eesgnHMAyhVJdBhC5FJ5ZueNqfvr");
pub const FEE_BPS:   u16    = 100;   // 1%
```

Re-deploy to change either value. There's no on-chain admin authority —
the fee config is immutable per-build, by design.

## Account budget

Big tx. Buy with full Jupiter+bridge+flipcash route is roughly:

| section | accounts |
| --- | --- |
| User signer + ATAs | 5 |
| Fee ATA | 1 |
| Bridge program + pool + vaults | 4 |
| Flipcash program + pool + vaults | 4 |
| Jupiter program + route | 1 + ~30 |
| Mints + token program | 4 |
| **Total** | ~50 |

Solana caps a v0 tx at ~64 accounts. With Jupiter's address-lookup table
covering its ~30 route accounts, the user-tx body sits well under
budget. The router program itself uses 0 PDAs — it's a pure dispatcher
so it doesn't need `invoke_signed`.

## Splitting limits

Achievable in one tx:

| Input | Output | Split? | Why |
| --- | --- | --- | --- |
| USDF | currency | ✅ | Curve leg has no Jupiter; only one Jupiter CPI total. |
| USDC | currency | ✅ | Curve leg uses bridge (no Jupiter); only one Jupiter CPI. |
| SOL  | currency | ❌ | Curve leg also needs Jupiter (SOL→USDC); two Jupiter CPIs busts 1232B. Use winner-takes-all. |
| currency | USDF | ✅ | Curve leg has no Jupiter. |
| currency | USDC | ✅ | Curve leg uses bridge only. |
| currency | SOL  | ❌ | Symmetric to SOL input case. |

The off-chain planner is responsible for choosing valid splits and
falling back to winner-takes-all when split would bust.

## Build & deploy

```bash
# Generate a real program keypair
solana-keygen new -o target/deploy/wired_router-keypair.json

# Update declare_id! and Anchor.toml with the new address, then:
anchor build
anchor deploy --provider.cluster mainnet
```

After deploy, regenerate the IDL and import into the TS client:

```bash
anchor idl init <program-id> -f target/idl/wired_router.json
```

The TS client at `lib/multi-hop.ts` currently builds Jupiter + bridge +
flipcash as separate instructions in a v0 tx. Switching to the router
means:

1. Build the same `(jupiter, bridge, flipcash)` plan off-chain.
2. Pack the result into a single `route_buy`/`route_sell` ix.
3. Pass the Jupiter route accounts as `remaining_accounts`.

That migration is a separate step — the program is here, ready when you
are.

## Audit considerations before mainnet

- The fee owner is hardcoded; document this prominently in any UI.
- Slippage is enforced **only on the user_target_ata delta**. Make sure
  no other ix in the same tx can credit that ATA between the snapshots.
  In practice the user is the signer for everything, so this is safe,
  but worth re-confirming under any wallet that batches ixs.
- Jupiter CPI accepts arbitrary instruction data — don't trust the
  off-chain planner blindly. The user signs the whole tx, so they're
  consenting to the Jupiter call, but defense-in-depth would parse the
  data and verify it's a Jupiter `route` ix.
- `route_sell` doesn't currently route the bridged USDC further through
  Jupiter for `output == SOL`; the off-chain planner should use
  jupiter-only for that case. Consider extending the program if needed.

## License

MIT — same as the rest of Wired.
