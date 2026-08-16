pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP");

#[program]
pub mod linko_escrow {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: String,
        budget_usdc: u64,
    ) -> Result<()> {
        instructions::create_campaign::handle_create_campaign(ctx, campaign_id, budget_usdc)
    }

    pub fn settle_commission(
        ctx: Context<SettleCommission>,
        amount_usdc: u64,
        order_id: String,
    ) -> Result<()> {
        instructions::settle_commission::handle_settle_commission(ctx, amount_usdc, order_id)
    }

    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::close_campaign::handle_close_campaign(ctx)
    }

    pub fn create_budget(ctx: Context<CreateBudget>, amount_usdc: u64) -> Result<()> {
        instructions::create_budget::handle_create_budget(ctx, amount_usdc)
    }

    pub fn budget_campaign(ctx: Context<BudgetCampaign>, amount_usdc: u64) -> Result<()> {
        instructions::budget_campaign::handle_budget_campaign(ctx, amount_usdc)
    }

    pub fn top_up_budget(ctx: Context<TopUpBudget>, amount_usdc: u64) -> Result<()> {
        instructions::top_up_budget::handle_top_up_budget(ctx, amount_usdc)
    }
}
