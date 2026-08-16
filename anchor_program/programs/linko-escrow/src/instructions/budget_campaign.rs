use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::{AdvertiserBudget, Campaign}};

/// Budget PDA의 Vault -> 기존 캠페인 Vault로 USDC를 이체한다. 두 Vault 모두 프로그램 소유 PDA라
/// 서명은 budget PDA 시드로 프로그램이 스스로 걸고(invoke_signed), 광고주 지갑은 관여하지 않는다 —
/// 실행 주체는 platform_authority(예산분배 에이전트를 구동하는 플랫폼 지갑) 서명뿐이다.
#[derive(Accounts)]
pub struct BudgetCampaign<'info> {
    #[account(
        constraint = platform_authority.key() == budget.platform_authority @ ErrorCode::Unauthorized
    )]
    pub platform_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [BUDGET_SEED, budget.advertiser.as_ref()],
        bump = budget.bump,
    )]
    pub budget: Account<'info, AdvertiserBudget>,

    #[account(
        mut,
        seeds = [VAULT_SEED, budget.key().as_ref()],
        bump = budget.vault_bump,
        token::mint = mint,
        token::authority = budget,
    )]
    pub budget_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.advertiser.as_ref(), campaign.campaign_id.as_bytes()],
        bump = campaign.bump,
        constraint = campaign.is_active @ ErrorCode::CampaignNotActive,
        constraint = campaign.advertiser == budget.advertiser @ ErrorCode::BudgetAdvertiserMismatch,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump,
        token::mint = mint,
        token::authority = campaign,
    )]
    pub campaign_vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_budget_campaign(ctx: Context<BudgetCampaign>, amount_usdc: u64) -> Result<()> {
    require!(
        ctx.accounts.budget.allocated_usdc.checked_add(amount_usdc).unwrap() <= ctx.accounts.budget.budget_usdc,
        ErrorCode::BudgetPoolExceeded
    );

    let advertiser_key = ctx.accounts.budget.advertiser;
    let bump = ctx.accounts.budget.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[BUDGET_SEED, advertiser_key.as_ref(), &[bump]]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.budget_vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.campaign_vault.to_account_info(),
        authority: ctx.accounts.budget.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, amount_usdc, ctx.accounts.mint.decimals)?;

    let budget = &mut ctx.accounts.budget;
    budget.allocated_usdc += amount_usdc;

    let campaign = &mut ctx.accounts.campaign;
    campaign.budget_usdc += amount_usdc;

    msg!("Budgeted {} USDC units from advertiser budget pool to campaign {}", amount_usdc, campaign.campaign_id);
    Ok(())
}
