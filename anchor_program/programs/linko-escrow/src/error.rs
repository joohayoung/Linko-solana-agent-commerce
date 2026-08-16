use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Campaign budget exceeded")]
    BudgetExceeded,
    #[msg("Campaign is not active")]
    CampaignNotActive,
    #[msg("Unauthorized: only the advertiser can perform this action")]
    Unauthorized,
    #[msg("Campaign ID too long (max 36 bytes)")]
    CampaignIdTooLong,
    #[msg("Budget advertiser does not match campaign advertiser")]
    BudgetAdvertiserMismatch,
    #[msg("Advertiser budget pool exceeded")]
    BudgetPoolExceeded,
}