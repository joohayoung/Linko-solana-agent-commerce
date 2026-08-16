use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, state::AdvertiserBudget};

#[derive(Accounts)]
pub struct CreateBudget<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,

    #[account(
        init,
        payer = advertiser,
        space = 8 + AdvertiserBudget::INIT_SPACE,
        seeds = [BUDGET_SEED, advertiser.key().as_ref()],
        bump
    )]
    pub budget: Account<'info, AdvertiserBudget>,

    #[account(
        init,
        payer = advertiser,
        seeds = [VAULT_SEED, budget.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
}

pub fn handle_create_budget(ctx: Context<CreateBudget>, amount_usdc: u64) -> Result<()> {
    let budget = &mut ctx.accounts.budget;
    budget.advertiser = ctx.accounts.advertiser.key();
    // 계정도 인스트럭션 인자도 아닌 상수(PLATFORM_AUTHORITY) — LazorKit CPI 래핑 오버헤드 때문에
    // 트랜잭션 크기 한도를 넘기던 문제를 해결하려고 아예 인스트럭션에서 제거함(constants.rs 참고).
    budget.platform_authority = PLATFORM_AUTHORITY;
    budget.budget_usdc = amount_usdc;
    budget.allocated_usdc = 0;
    budget.mint = ctx.accounts.mint.key();
    budget.bump = ctx.bumps.budget;
    budget.vault_bump = ctx.bumps.vault;

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.advertiser_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.advertiser.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer_checked(cpi_ctx, amount_usdc, ctx.accounts.mint.decimals)?;

    msg!("Budget pool created for advertiser {}: {} USDC units", budget.advertiser, amount_usdc);
    Ok(())
}
