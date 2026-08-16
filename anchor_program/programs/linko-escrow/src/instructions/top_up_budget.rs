use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::AdvertiserBudget};

/// create_budget과 달리 init이 아님 — 이미 존재하는 Budget PDA/Vault에 광고주가 몇 번이고
/// 추가로 입금할 수 있게 하는 인스트럭션. Budget PDA 자체는 광고주당 여전히 1개뿐이고,
/// 이 인스트럭션은 그 Vault 잔액만 늘린다(=budget_usdc 누적 증가).
#[derive(Accounts)]
pub struct TopUpBudget<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,

    #[account(
        mut,
        seeds = [BUDGET_SEED, advertiser.key().as_ref()],
        bump = budget.bump,
        constraint = budget.advertiser == advertiser.key() @ ErrorCode::Unauthorized,
    )]
    pub budget: Account<'info, AdvertiserBudget>,

    #[account(
        mut,
        seeds = [VAULT_SEED, budget.key().as_ref()],
        bump = budget.vault_bump,
        token::mint = mint,
        token::authority = budget,
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
}

pub fn handle_top_up_budget(ctx: Context<TopUpBudget>, amount_usdc: u64) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.advertiser_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.advertiser.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer_checked(cpi_ctx, amount_usdc, ctx.accounts.mint.decimals)?;

    let budget = &mut ctx.accounts.budget;
    budget.budget_usdc += amount_usdc;

    msg!("Budget topped up for advertiser {}: +{} USDC units", budget.advertiser, amount_usdc);
    Ok(())
}
