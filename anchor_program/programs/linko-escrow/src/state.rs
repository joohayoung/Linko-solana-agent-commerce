use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub advertiser: Pubkey,
    #[max_len(36)]
    pub campaign_id: String,
    pub budget_usdc: u64,
    pub spent_usdc: u64,
    pub mint: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    pub is_active: bool,
}