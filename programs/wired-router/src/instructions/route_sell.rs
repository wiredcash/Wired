//! `route_sell` — wraps a sell through the Flipcash bonding curve, the
//! USDF↔USDC bridge, and Jupiter into a single user-signed instruction.
//!
//! Mirror of `route_buy`. Splitting: when both `jupiter_in_amount > 0` AND
//! `curve_in_amount > 0`, both paths run in this ix and their outputs add
//! into the user's output ATA. SOL output sells with split routing have
//! the same tx-size constraint as SOL input buys; not supported.
//!
//! Fee: `FEE_BPS` (1%) of `total_in_amount` is taken in the *source mint*
//! (the Flipcash currency) and transferred to FEE_OWNER's ATA before any
//! swaps run.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};

use crate::constants::*;
use crate::cpi::*;
use crate::error::WiredRouterError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteSellArgs {
    /// Total source-token (currency) amount the user is selling, raw quarks.
    pub total_in_amount: u64,
    /// Portion routed via Jupiter (currency → output mint).
    pub jupiter_in_amount: u64,
    /// Portion routed via curve (currency → USDF [→ bridge → output]).
    pub curve_in_amount: u64,
    /// Worst-case output the user must receive (in output-mint quarks).
    pub min_out_amount: u64,
    /// Min USDF the on-chain Flipcash sell ix should accept.
    pub flipcash_min_usdf_out: u64,
    /// Whether the output mint is USDF (skip both bridge and Jupiter).
    pub output_is_usdf: bool,
    /// Whether the output mint is USDC (only bridge needed, no Jupiter).
    pub output_is_usdc: bool,
    /// Raw Jupiter swap-instruction data. Empty if not used.
    pub jupiter_ix_data: Vec<u8>,
    /// Number of accounts at the start of `remaining_accounts` for Jupiter.
    pub jupiter_account_count: u8,
}

#[derive(Accounts)]
pub struct RouteSell<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub source_mint: Box<Account<'info, Mint>>,
    pub output_mint: Box<Account<'info, Mint>>,
    pub usdf_mint: Box<Account<'info, Mint>>,

    #[account(mut, token::mint = source_mint, token::authority = user)]
    pub user_source_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = output_mint, token::authority = user)]
    pub user_output_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdf_mint, token::authority = user)]
    pub user_usdf_ata: Box<Account<'info, TokenAccount>>,
    /// USDC ATA — used as the bridge intermediate when output != USDF.
    #[account(mut, token::authority = user)]
    pub user_usdc_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = source_mint,
        constraint = fee_source_ata.owner == FEE_OWNER @ WiredRouterError::InvalidFeeAccount,
    )]
    pub fee_source_ata: Box<Account<'info, TokenAccount>>,

    // ─── Flipcash sell ──────────────────────────────────────────────
    /// CHECK: verified by `invoke_flipcash_sell`.
    pub flipcash_program: UncheckedAccount<'info>,
    /// CHECK: pool, mut for fee accumulation.
    #[account(mut)]
    pub flipcash_pool: UncheckedAccount<'info>,
    /// CHECK: source-mint vault.
    #[account(mut)]
    pub flipcash_source_vault: UncheckedAccount<'info>,
    /// CHECK: USDF vault.
    #[account(mut)]
    pub flipcash_usdf_vault: UncheckedAccount<'info>,

    // ─── USDF↔USDC bridge ────────────────────────────────────────────
    /// CHECK: verified by `invoke_bridge_swap`.
    pub usdf_swap_program: UncheckedAccount<'info>,
    /// CHECK: bridge pool.
    pub bridge_pool: UncheckedAccount<'info>,
    /// CHECK: bridge USDF vault.
    #[account(mut)]
    pub bridge_usdf_vault: UncheckedAccount<'info>,
    /// CHECK: bridge USDC vault.
    #[account(mut)]
    pub bridge_usdc_vault: UncheckedAccount<'info>,

    // ─── Jupiter ─────────────────────────────────────────────────────
    /// CHECK: verified by `invoke_jupiter`.
    pub jupiter_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handle<'info>(
    ctx: Context<'_, '_, '_, 'info, RouteSell<'info>>,
    args: RouteSellArgs,
) -> Result<()> {
    // ─── 1. Take fee in source mint ──────────────────────────────────
    let fee = ((args.total_in_amount as u128)
        .checked_mul(FEE_BPS as u128)
        .ok_or(WiredRouterError::Overflow)?
        / FEE_BPS_DIVISOR) as u64;

    if fee > 0 {
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_source_ata.to_account_info(),
                    to: ctx.accounts.fee_source_ata.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    let net_in = args
        .total_in_amount
        .checked_sub(fee)
        .ok_or(WiredRouterError::Overflow)?;
    let routed = args
        .jupiter_in_amount
        .checked_add(args.curve_in_amount)
        .ok_or(WiredRouterError::Overflow)?;
    require!(routed <= net_in, WiredRouterError::AmountMismatch);

    let output_balance_before = ctx.accounts.user_output_ata.amount;

    // ─── 2. Jupiter leg (currency → output) ──────────────────────────
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

    // ─── 3. Curve leg (currency → USDF → [bridge → [Jupiter →]] output) ──
    if args.curve_in_amount > 0 {
        // Snapshot USDF before sell so we know how much to bridge / Jupiter.
        let usdf_before = ctx.accounts.user_usdf_ata.amount;

        invoke_flipcash_sell(
            &ctx.accounts.flipcash_program.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.flipcash_pool.to_account_info(),
            &ctx.accounts.source_mint.to_account_info(),
            &ctx.accounts.usdf_mint.to_account_info(),
            &ctx.accounts.flipcash_source_vault.to_account_info(),
            &ctx.accounts.flipcash_usdf_vault.to_account_info(),
            &ctx.accounts.user_source_ata.to_account_info(),
            &ctx.accounts.user_usdf_ata.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            args.curve_in_amount,
            args.flipcash_min_usdf_out,
        )?;

        // Compute how much USDF the sell delivered.
        ctx.accounts.user_usdf_ata.reload()?;
        let usdf_received = ctx
            .accounts
            .user_usdf_ata
            .amount
            .checked_sub(usdf_before)
            .ok_or(WiredRouterError::Overflow)?;

        if !args.output_is_usdf {
            // Bridge USDF → USDC (1:1, same decimals).
            invoke_bridge_swap(
                &ctx.accounts.usdf_swap_program.to_account_info(),
                &ctx.accounts.user.to_account_info(),
                &ctx.accounts.bridge_pool.to_account_info(),
                &ctx.accounts.bridge_usdf_vault.to_account_info(),
                &ctx.accounts.bridge_usdc_vault.to_account_info(),
                &ctx.accounts.user_usdf_ata.to_account_info(),
                &ctx.accounts.user_usdc_ata.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                usdf_received,
                /* usdf_to_other */ true,
            )?;
            // Note: output==USDC means we're done; the USDC is in the
            // user's USDC ATA, NOT user_output_ata. The min-out check
            // below would fail, so callers must wire user_output_ata =
            // user_usdc_ata when output_is_usdc.
        }
        // For output == SOL or other, the off-chain caller schedules a
        // separate Jupiter swap on the bridged USDC. In v1 we don't do
        // that here — the curve-leg sell stops at USDC. Callers wanting
        // currency → SOL split routing should use jupiter_in_amount for
        // the Jupiter portion and curve_in_amount=0, since splitting both
        // a curve→USDC and a Jupiter→SOL through this ix doesn't fit.
    }

    // ─── 4. Verify slippage ──────────────────────────────────────────
    ctx.accounts.user_output_ata.reload()?;
    let received = ctx
        .accounts
        .user_output_ata
        .amount
        .checked_sub(output_balance_before)
        .ok_or(WiredRouterError::Overflow)?;
    require!(
        received >= args.min_out_amount,
        WiredRouterError::SlippageExceeded,
    );

    let _ = args.output_is_usdc; // currently unused; reserved for future routing
    Ok(())
}
