use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::Campaign};

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(mut)]
    pub advertiser: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, advertiser.key().as_ref(), campaign.campaign_id.as_bytes()],
        bump = campaign.bump,
        constraint = campaign.advertiser == advertiser.key() @ ErrorCode::Unauthorized,
        close = advertiser,
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
        associated_token::mint = mint,
        associated_token::authority = advertiser,
    )]
    pub advertiser_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
    let campaign = &ctx.accounts.campaign;
    let advertiser_key = campaign.advertiser;
    let campaign_id = campaign.campaign_id.clone();
    let bump = campaign.bump;

    let signer_seeds: &[&[&[u8]]] = &[&[
        CAMPAIGN_SEED,
        advertiser_key.as_ref(),
        campaign_id.as_bytes(),
        &[bump],
    ]];

    let vault_balance = ctx.accounts.vault.amount;
    if vault_balance > 0 {
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.advertiser_token_account.to_account_info(),
            authority: ctx.accounts.campaign.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer_checked(cpi_ctx, vault_balance, ctx.accounts.mint.decimals)?;
    }

    let close_accounts = CloseAccount {
        account: ctx.accounts.vault.to_account_info(),
        destination: ctx.accounts.advertiser.to_account_info(),
        authority: ctx.accounts.campaign.to_account_info(),
    };
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        close_accounts,
        signer_seeds,
    );
    token::close_account(close_ctx)?;

    msg!("Campaign closed, remaining {} USDC units returned", vault_balance);
    Ok(())
}
