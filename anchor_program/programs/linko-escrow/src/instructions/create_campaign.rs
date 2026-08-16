use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::Campaign};

#[derive(Accounts)]
#[instruction(campaign_id: String, budget_usdc: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,

    #[account(
        init,
        payer = advertiser,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, advertiser.key().as_ref(), campaign_id.as_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = advertiser,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = campaign,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = advertiser,
    )]
    pub advertiser_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_campaign(
    ctx: Context<CreateCampaign>,
    campaign_id: String,
    budget_usdc: u64,
) -> Result<()> {
    require!(campaign_id.len() <= 36, ErrorCode::CampaignIdTooLong);

    let campaign = &mut ctx.accounts.campaign;
    campaign.advertiser = ctx.accounts.advertiser.key();
    // 계정도 인스트럭션 인자도 아닌 상수(PLATFORM_AUTHORITY) — create_budget과 동일한 이유로
    // LazorKit CPI 래핑 오버헤드 때문에 트랜잭션 크기 한도를 가끔 넘기던 문제를 해결함.
    campaign.platform_authority = PLATFORM_AUTHORITY;
    campaign.campaign_id = campaign_id;
    campaign.budget_usdc = budget_usdc;
    campaign.spent_usdc = 0;
    campaign.mint = ctx.accounts.mint.key();
    campaign.bump = ctx.bumps.campaign;
    campaign.vault_bump = ctx.bumps.vault;
    campaign.is_active = true;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.advertiser_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.advertiser.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer_checked(cpi_ctx, budget_usdc, ctx.accounts.mint.decimals)?;

    msg!("Campaign created: {}, budget: {} USDC units", campaign.campaign_id, budget_usdc);
    Ok(())
}
