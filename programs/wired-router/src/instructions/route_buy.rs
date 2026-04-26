//! `route_buy` — wraps a buy through Jupiter, the USDF↔USDC bridge, and
//! the Flipcash bonding curve into a single user-signed instruction.
//!
//! Splitting: when `jupiter_in_amount > 0` AND `curve_in_amount > 0`, both
//! paths run in this ix and their outputs add into the user's target ATA.
//! For SOL inputs only one path can use Jupiter (the curve leg also needs
//! Jupiter to reach USDC), so SOL splits aren't supported by tx-size
//! constraints — the off-chain planner enforces this.
//!
//! Fee: `FEE_BPS` (1%) of `total_input_amount` is taken in the *input
//! mint* and transferred to the FEE_OWNER's ATA *before* any swaps run.
//! The remaining net is what gets routed.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

use crate::constants::*;
use crate::cpi::*;
use crate::error::WiredRouterError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteBuyArgs {
    /// Total amount the user is paying, in input-mint smallest units.
    pub total_input_amount: u64,
    /// Portion routed via Jupiter (input → target). 0 = curve-only.
    pub jupiter_in_amount: u64,
    /// Portion routed via curve (input → bridge if not USDF → flipcash buy).
    /// 0 = jupiter-only. Implicitly upper-bounded by `total - fee - jup`.
    pub curve_in_amount: u64,
    /// Worst-case currency tokens (10 decimals) the user must receive in
    /// total. The ix reverts if the actual delta on `user_target_ata` is
    /// below this.
    pub min_target_out: u64,
    /// Min target tokens the on-chain Flipcash buy ix should accept (its
    /// own slippage check). Should be ≤ the curve portion of min_target_out.
    pub flipcash_min_out: u64,
    /// Whether the input mint is USDF (skip the bridge leg).
    pub curve_input_is_usdf: bool,
    /// Raw Jupiter swap-instruction data. Empty if `jupiter_in_amount == 0`.
    pub jupiter_ix_data: Vec<u8>,
    /// Number of accounts at the start of `remaining_accounts` that belong
    /// to Jupiter. The rest are passed-through extras (none today).
    pub jupiter_account_count: u8,
}

#[derive(Accounts)]
pub struct RouteBuy<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    // `Box` the SPL accounts to keep them off the on-program stack —
    // SBF programs have a 4 KB stack and Account<'info, T> deserializes
    // its data inline. Without Box, having ~7 such fields blows past it.
    pub input_mint: Box<Account<'info, Mint>>,
    pub target_mint: Box<Account<'info, Mint>>,
    pub usdf_mint: Box<Account<'info, Mint>>,

    #[account(mut, token::mint = input_mint, token::authority = user)]
    pub user_input_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = target_mint, token::authority = user)]
    pub user_target_ata: Box<Account<'info, TokenAccount>>,
    /// USDF ATA — required for the curve leg (intermediate or input).
    #[account(mut, token::mint = usdf_mint, token::authority = user)]
    pub user_usdf_ata: Box<Account<'info, TokenAccount>>,
    /// USDC ATA — used as the bridge intermediate when input != USDF.
    /// Pass any USDC ATA owned by user; if curve_input_is_usdf, this can
    /// be unused but must still type-check.
    #[account(mut, token::authority = user)]
    pub user_usdc_ata: Box<Account<'info, TokenAccount>>,

    /// Fee receiver's ATA for the input mint.
    #[account(
        mut,
        token::mint = input_mint,
        constraint = fee_input_ata.owner == FEE_OWNER @ WiredRouterError::InvalidFeeAccount,
    )]
    pub fee_input_ata: Box<Account<'info, TokenAccount>>,

    // ─── USDF↔USDC bridge ────────────────────────────────────────────
    /// CHECK: program ID is verified inside `invoke_bridge_swap`.
    pub usdf_swap_program: UncheckedAccount<'info>,
    /// CHECK: bridge `Pool` PDA. Verified by the bridge program.
    pub bridge_pool: UncheckedAccount<'info>,
    /// CHECK: bridge USDF vault.
    #[account(mut)]
    pub bridge_usdf_vault: UncheckedAccount<'info>,
    /// CHECK: bridge USDC vault.
    #[account(mut)]
    pub bridge_usdc_vault: UncheckedAccount<'info>,

    // ─── Flipcash buy ────────────────────────────────────────────────
    /// CHECK: program ID verified in `invoke_flipcash_buy`.
    pub flipcash_program: UncheckedAccount<'info>,
    /// CHECK: flipcash `LiquidityPool` PDA. Verified by flipcash program.
    pub flipcash_pool: UncheckedAccount<'info>,
    /// CHECK: target-mint vault for the flipcash pool.
    #[account(mut)]
    pub flipcash_target_vault: UncheckedAccount<'info>,
    /// CHECK: USDF (base) vault for the flipcash pool.
    #[account(mut)]
    pub flipcash_usdf_vault: UncheckedAccount<'info>,

    // ─── Jupiter ─────────────────────────────────────────────────────
    /// CHECK: must equal JUPITER_PROGRAM. Verified inside `invoke_jupiter`.
    pub jupiter_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    // Jupiter route accounts arrive via `remaining_accounts`. The first
    // `jupiter_account_count` are forwarded to the Jupiter CPI; any extras
    // are unused (reserved for future fee-token ATAs etc.).
}

pub fn handle<'info>(
    ctx: Context<'_, '_, '_, 'info, RouteBuy<'info>>,
    args: RouteBuyArgs,
) -> Result<()> {
    // ─── 1. Take fee in input mint ────────────────────────────────────
    let fee = ((args.total_input_amount as u128)
        .checked_mul(FEE_BPS as u128)
        .ok_or(WiredRouterError::Overflow)?
        / FEE_BPS_DIVISOR) as u64;

    if fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_input_ata.to_account_info(),
                    to: ctx.accounts.fee_input_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    let net_input = args
        .total_input_amount
        .checked_sub(fee)
        .ok_or(WiredRouterError::Overflow)?;
    let routed = args
        .jupiter_in_amount
        .checked_add(args.curve_in_amount)
        .ok_or(WiredRouterError::Overflow)?;
    require!(routed <= net_input, WiredRouterError::AmountMismatch);

    // Snapshot target balance before swaps so we can verify total received.
    let user_target_balance_before = ctx.accounts.user_target_ata.amount;

    // ─── 2. Jupiter leg (input → target) ──────────────────────────────
    if args.jupiter_in_amount > 0 {
        require!(
            !args.jupiter_ix_data.is_empty(),
            WiredRouterError::MissingJupiterData,
        );
        let n = args.jupiter_account_count as usize;
        require!(
            ctx.remaining_accounts.len() >= n,
            WiredRouterError::MissingJupiterData,
        );
        invoke_jupiter(
            &ctx.accounts.jupiter_program.to_account_info(),
            &ctx.remaining_accounts[..n],
            args.jupiter_ix_data.clone(),
        )?;
    }

    // ─── 3. Curve leg (input → [bridge →] flipcash buy) ───────────────
    if args.curve_in_amount > 0 {
        if !args.curve_input_is_usdf {
            // Bridge USDC → USDF for the curve portion.
            invoke_bridge_swap(
                &ctx.accounts.usdf_swap_program.to_account_info(),
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.bridge_pool.to_account_info(),
                &ctx.accounts.bridge_usdf_vault.to_account_info(),
                &ctx.accounts.bridge_usdc_vault.to_account_info(),
                &ctx.accounts.user_usdf_ata.to_account_info(),
                &ctx.accounts.user_usdc_ata.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                args.curve_in_amount,
                /* usdf_to_other */ false,
            )?;
        }

        // Flipcash buy USDF → target. The amount we deposit is the bridged
        // amount (1:1 from USDC) or the raw USDF input.
        invoke_flipcash_buy(
            &ctx.accounts.flipcash_program.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.flipcash_pool.to_account_info(),
            &ctx.accounts.target_mint.to_account_info(),
            &ctx.accounts.usdf_mint.to_account_info(),
            &ctx.accounts.flipcash_target_vault.to_account_info(),
            &ctx.accounts.flipcash_usdf_vault.to_account_info(),
            &ctx.accounts.user_target_ata.to_account_info(),
            &ctx.accounts.user_usdf_ata.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            args.curve_in_amount,
            args.flipcash_min_out,
        )?;
    }

    // ─── 4. Verify combined slippage ─────────────────────────────────
    ctx.accounts.user_target_ata.reload()?;
    let received = ctx
        .accounts
        .user_target_ata
        .amount
        .checked_sub(user_target_balance_before)
        .ok_or(WiredRouterError::Overflow)?;
    require!(
        received >= args.min_target_out,
        WiredRouterError::SlippageExceeded,
    );

    Ok(())
}
