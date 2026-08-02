use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::Campaign};

#[derive(Accounts)]
pub struct SettleCommission<'info> {
    /// The settlement authority (advertiser or authorized platform wallet)
    #[account(
        mut,
        constraint = (authority.key() == campaign.advertiser || authority.key() == campaign.mint) @ ErrorCode::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.advertiser.as_ref(), campaign.campaign_id.as_bytes()],
        bump = campaign.bump,
        constraint = campaign.is_active @ ErrorCode::CampaignNotActive,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        seeds = [VAULT_SEED, campaign.key().as_ref()],
        bump = campaign.vault_bump,
        token::mint = mint,
        token::authority = campaign,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_settle_commission(
    ctx: Context<SettleCommission>,
    amount_usdc: u64,
    order_id: String,
) -> Result<()> {
    require!(
        ctx.accounts.campaign.spent_usdc.checked_add(amount_usdc).unwrap() <= ctx.accounts.campaign.budget_usdc,
        ErrorCode::BudgetExceeded
    );

    let advertiser_key = ctx.accounts.campaign.advertiser;
    let campaign_id = ctx.accounts.campaign.campaign_id.clone();
    let bump = ctx.accounts.campaign.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        CAMPAIGN_SEED,
        advertiser_key.as_ref(),
        campaign_id.as_bytes(),
        &[bump],
    ]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.vault.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.creator_token_account.to_account_info(),
        authority: ctx.accounts.campaign.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, amount_usdc, ctx.accounts.mint.decimals)?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.spent_usdc += amount_usdc;

    msg!("Settlement: {} USDC units for order {}", amount_usdc, order_id);
    Ok(())
}
