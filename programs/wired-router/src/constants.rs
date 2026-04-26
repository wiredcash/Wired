use anchor_lang::prelude::*;

/// Wallet that receives the integrator fee. Set at compile time so the fee
/// destination is auditable and immutable per build. Re-deploy to change.
pub const FEE_OWNER: Pubkey =
    solana_program::pubkey!("8w985ENi8Gikora3eesgnHMAyhVJdBhC5FJ5ZueNqfvr");

/// Fee in basis points. 100 = 1%.
pub const FEE_BPS: u16 = 100;
pub const FEE_BPS_DIVISOR: u128 = 10_000;

/// Programs we CPI into.
pub const JUPITER_PROGRAM: Pubkey =
    solana_program::pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
pub const USDF_SWAP_PROGRAM: Pubkey =
    solana_program::pubkey!("usdfcP2V1bh1Lz7Y87pxR4zJd3wnVtssJ6GeSHFeZeu");
pub const FLIPCASH_PROGRAM: Pubkey =
    solana_program::pubkey!("ccJYP5gjZqcEHaphcxAZvkxCrnTVfYMjyhSYkpQtf8Z");

/// Mints we know about. Reserved for future routing constraints —
/// today the program trusts the off-chain planner to wire the right
/// mints for bridge / flipcash CPIs.
#[allow(dead_code)]
pub const USDF_MINT: Pubkey =
    solana_program::pubkey!("5AMAA9JV9H97YYVxx8F6FsCMmTwXSuTTQneiup4RYAUQ");
#[allow(dead_code)]
pub const USDC_MINT: Pubkey =
    solana_program::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/// Instruction-data discriminators in the programs we CPI into. These are
/// fixed by the on-chain ABI of those programs (single-byte enum
/// discriminators per the Steel framework convention).
pub const USDF_SWAP_IX_SWAP: u8 = 2;
pub const FLIPCASH_IX_BUY: u8 = 4;
pub const FLIPCASH_IX_SELL: u8 = 5;
