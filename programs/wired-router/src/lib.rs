//! Wired Router — a Solana program that wraps Jupiter, the USDF↔USDC
//! bridge, and the Flipcash bonding curve into single user-signed
//! instructions, taking a 1% integrator fee on every swap.
//!
//! The program is a thin CPI dispatcher. Routing decisions (which path,
//! how much through each leg, expected output, slippage) are made by the
//! off-chain planner in `lib/multi-hop.ts`; the on-chain code just
//! executes the resulting plan as a single atomic instruction.
//!
//! Fee model: 1% of the user's *input* amount is transferred to the
//! configured FEE_OWNER's ATA before any swaps run. The remaining net
//! amount is routed.

use anchor_lang::prelude::*;

mod constants;
mod cpi;
mod error;
mod instructions;

use instructions::*;

// PLACEHOLDER — replace with `anchor keys list` after the first build.
declare_id!("11111111111111111111111111111111");

#[program]
pub mod wired_router {
    use super::*;

    /// See `instructions/route_buy.rs`.
    pub fn route_buy<'info>(
        ctx: Context<'_, '_, '_, 'info, RouteBuy<'info>>,
        args: RouteBuyArgs,
    ) -> Result<()> {
        instructions::route_buy::handle(ctx, args)
    }

    /// See `instructions/route_sell.rs`.
    pub fn route_sell<'info>(
        ctx: Context<'_, '_, '_, 'info, RouteSell<'info>>,
        args: RouteSellArgs,
    ) -> Result<()> {
        instructions::route_sell::handle(ctx, args)
    }
}
