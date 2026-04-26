use anchor_lang::prelude::*;

#[error_code]
pub enum WiredRouterError {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Total of jupiter + curve amounts exceeds net input after fee")]
    AmountMismatch,
    #[msg("Jupiter portion is non-zero but jupiter_ix_data is empty")]
    MissingJupiterData,
    #[msg("Curve portion is non-zero but the curve route accounts are missing")]
    MissingCurveAccounts,
    #[msg("Slippage exceeded — output below min_amount_out")]
    SlippageExceeded,
    #[msg("Wrong fee account: must be the FEE_OWNER's ATA for the input/output mint")]
    InvalidFeeAccount,
    #[msg("CPI target does not match the expected program ID")]
    InvalidProgram,
    #[msg("Unsupported input/output mint combination")]
    UnsupportedMint,
}
