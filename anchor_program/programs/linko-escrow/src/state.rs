use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub advertiser: Pubkey,
    /// 플랫폼(정산 서비스) 권한 지갑. settle_commission 실행을 위임받은 주체.
    pub platform_authority: Pubkey,
    #[max_len(36)]
    pub campaign_id: String,
    pub budget_usdc: u64,
    pub spent_usdc: u64,
    pub mint: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
    pub is_active: bool,
}

/// 광고주당 1개뿐인 예비 예산 풀(Budget PDA). Campaign과 동형이지만 campaign_id가 없음 —
/// 여기 잠긴 USDC는 budget_campaign으로 기존 캠페인 Vault에만 이동할 수 있고,
/// 그 이체는 platform_authority 서명만으로 실행됨(광고주 재서명 불필요).
#[account]
#[derive(InitSpace)]
pub struct AdvertiserBudget {
    pub advertiser: Pubkey,
    /// budget_campaign 실행을 위임받은 플랫폼 권한 지갑.
    pub platform_authority: Pubkey,
    pub budget_usdc: u64,
    /// 지금까지 캠페인들로 배분해 나간 누적액(감사용 기록, budget_usdc에서 차감되지 않음).
    pub allocated_usdc: u64,
    pub mint: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}