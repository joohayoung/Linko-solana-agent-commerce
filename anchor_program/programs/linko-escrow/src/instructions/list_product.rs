use anchor_lang::prelude::*;

use crate::{constants::*, state::Product};
#[derive(Accounts)]
#[instruction(name: String, price: u64, stock: u64)]
pub struct ListProduct<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = 8 + Product::INIT_SPACE,
        seeds = [PRODUCT_SEED, seller.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub product: Account<'info, Product>,
    pub mint: Account<'info, anchor_spl::token::Mint>,
    pub system_program: Program<'info, System>,
}

pub fn handle_list_product(
    ctx: Context<ListProduct>,
    name: String,
    price: u64,
    stock: u64,
) -> Result<()> {
    ctx.accounts.product.seller = ctx.accounts.seller.key();
    ctx.accounts.product.name = name;
    ctx.accounts.product.price = price;
    ctx.accounts.product.stock = stock;
    ctx.accounts.product.sales_count = 0;
    ctx.accounts.product.mint = ctx.accounts.mint.key();

    msg!("Product listed: {}", ctx.accounts.product.name);
    Ok(())
}