//! Helpers for building and invoking the manual CPIs into Jupiter, the
//! USDF↔USDC bridge, and the Flipcash bonding-curve program. None of these
//! programs are Anchor-native, so we encode their instructions by hand
//! against their published `repr(C)` layouts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke};

use crate::constants::*;
use crate::error::WiredRouterError;

/// Forward a Jupiter swap-instructions response into a CPI. Caller is
/// responsible for passing the exact account list Jupiter expects (the
/// off-chain `getJupiterSwapInstructions` endpoint returns it) as
/// `remaining_accounts`, plus the raw instruction data as `data`.
pub fn invoke_jupiter<'info>(
    jupiter_program: &AccountInfo<'info>,
    jupiter_accounts: &[AccountInfo<'info>],
    data: Vec<u8>,
) -> Result<()> {
    require_keys_eq!(
        *jupiter_program.key,
        JUPITER_PROGRAM,
        WiredRouterError::InvalidProgram,
    );

    let metas: Vec<AccountMeta> = jupiter_accounts
        .iter()
        .map(|a| {
            if a.is_writable {
                AccountMeta::new(*a.key, a.is_signer)
            } else {
                AccountMeta::new_readonly(*a.key, a.is_signer)
            }
        })
        .collect();

    let ix = Instruction {
        program_id: JUPITER_PROGRAM,
        accounts: metas,
        data,
    };
    // Jupiter accounts already include the program account itself per the
    // off-chain swap-instructions response.
    invoke(&ix, jupiter_accounts).map_err(Into::into)
}

/// CPI into `usdf-swap-program`'s `swap` ix.
///
/// Layout (matches `usdf-swap-program/api/src/instruction.rs::SwapIx`):
///   [u8 disc=2][u64 amount LE][u8 usdf_to_other]
#[allow(clippy::too_many_arguments)]
pub fn invoke_bridge_swap<'info>(
    program: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    usdf_vault: &AccountInfo<'info>,
    other_vault: &AccountInfo<'info>,
    user_usdf_token: &AccountInfo<'info>,
    user_other_token: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    usdf_to_other: bool,
) -> Result<()> {
    require_keys_eq!(
        *program.key,
        USDF_SWAP_PROGRAM,
        WiredRouterError::InvalidProgram,
    );

    let mut data = Vec::with_capacity(10);
    data.push(USDF_SWAP_IX_SWAP);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(if usdf_to_other { 1 } else { 0 });

    let ix = Instruction {
        program_id: USDF_SWAP_PROGRAM,
        accounts: vec![
            AccountMeta::new(*user.key, true),
            AccountMeta::new_readonly(*pool.key, false),
            AccountMeta::new(*usdf_vault.key, false),
            AccountMeta::new(*other_vault.key, false),
            AccountMeta::new(*user_usdf_token.key, false),
            AccountMeta::new(*user_other_token.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            user.clone(),
            pool.clone(),
            usdf_vault.clone(),
            other_vault.clone(),
            user_usdf_token.clone(),
            user_other_token.clone(),
            token_program.clone(),
        ],
    )
    .map_err(Into::into)
}

/// CPI into `flipcash-program`'s `buy` ix.
///
/// Layout (matches `flipcash-program/api/src/instruction.rs::BuyTokensIx`):
///   [u8 disc=4][u64 in_amount LE][u64 min_amount_out LE]
#[allow(clippy::too_many_arguments)]
pub fn invoke_flipcash_buy<'info>(
    program: &AccountInfo<'info>,
    buyer: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    target_mint: &AccountInfo<'info>,
    base_mint: &AccountInfo<'info>,
    target_vault: &AccountInfo<'info>,
    base_vault: &AccountInfo<'info>,
    buyer_target: &AccountInfo<'info>,
    buyer_base: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    in_amount: u64,
    min_amount_out: u64,
) -> Result<()> {
    require_keys_eq!(
        *program.key,
        FLIPCASH_PROGRAM,
        WiredRouterError::InvalidProgram,
    );

    let mut data = Vec::with_capacity(17);
    data.push(FLIPCASH_IX_BUY);
    data.extend_from_slice(&in_amount.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());

    let ix = Instruction {
        program_id: FLIPCASH_PROGRAM,
        accounts: vec![
            AccountMeta::new(*buyer.key, true),
            AccountMeta::new_readonly(*pool.key, false),
            AccountMeta::new_readonly(*target_mint.key, false),
            AccountMeta::new_readonly(*base_mint.key, false),
            AccountMeta::new(*target_vault.key, false),
            AccountMeta::new(*base_vault.key, false),
            AccountMeta::new(*buyer_target.key, false),
            AccountMeta::new(*buyer_base.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            buyer.clone(),
            pool.clone(),
            target_mint.clone(),
            base_mint.clone(),
            target_vault.clone(),
            base_vault.clone(),
            buyer_target.clone(),
            buyer_base.clone(),
            token_program.clone(),
        ],
    )
    .map_err(Into::into)
}

/// CPI into `flipcash-program`'s `sell` ix.
///
/// Same layout as `buy`, just with disc=5. Note: pool is `mut` here
/// (sell mutates `fees_accumulated`).
#[allow(clippy::too_many_arguments)]
pub fn invoke_flipcash_sell<'info>(
    program: &AccountInfo<'info>,
    seller: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    target_mint: &AccountInfo<'info>,
    base_mint: &AccountInfo<'info>,
    target_vault: &AccountInfo<'info>,
    base_vault: &AccountInfo<'info>,
    seller_target: &AccountInfo<'info>,
    seller_base: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    in_amount: u64,
    min_amount_out: u64,
) -> Result<()> {
    require_keys_eq!(
        *program.key,
        FLIPCASH_PROGRAM,
        WiredRouterError::InvalidProgram,
    );

    let mut data = Vec::with_capacity(17);
    data.push(FLIPCASH_IX_SELL);
    data.extend_from_slice(&in_amount.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());

    let ix = Instruction {
        program_id: FLIPCASH_PROGRAM,
        accounts: vec![
            AccountMeta::new(*seller.key, true),
            AccountMeta::new(*pool.key, false), // sell mutates the pool
            AccountMeta::new_readonly(*target_mint.key, false),
            AccountMeta::new_readonly(*base_mint.key, false),
            AccountMeta::new(*target_vault.key, false),
            AccountMeta::new(*base_vault.key, false),
            AccountMeta::new(*seller_target.key, false),
            AccountMeta::new(*seller_base.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
        ],
        data,
    };
    invoke(
        &ix,
        &[
            seller.clone(),
            pool.clone(),
            target_mint.clone(),
            base_mint.clone(),
            target_vault.clone(),
            base_vault.clone(),
            seller_target.clone(),
            seller_base.clone(),
            token_program.clone(),
        ],
    )
    .map_err(Into::into)
}
