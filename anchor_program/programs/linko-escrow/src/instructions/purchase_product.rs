use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::ErrorCode,
    state::{Order, Product},
};

#[derive(Accounts)]
pub struct PurchaseProduct<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    pub product: Account<'info, Product>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Order::INIT_SPACE,
        seeds = [ORDER_SEED, product.key().as_ref(), product.sales_count.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,

    // 결제 수단인 USDC Mint. product에 저장된 mint와 같은지 검사.
    #[account(constraint = mint.key() == product.mint)]
    pub mint: Account<'info, Mint>,

    // 구매자의 USDC 지갑(ATA). 이미 USDC를 가지고 있어야 하므로 미리 존재해야 함.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: product.seller와 일치하는지만 검사. 결제를 받는 쪽이라 서명은 필요 없음.
    #[account(constraint = seller.key() == product.seller)]
    pub seller: UncheckedAccount<'info>,

    // 판매자의 USDC 지갑(ATA). 첫 판매라면 이 트랜잭션에서 새로 생성됨(init_if_needed).
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_purchase_product(ctx: Context<PurchaseProduct>) -> Result<()> {
    require!(ctx.accounts.product.stock > 0, ErrorCode::SoldOut);

    let product_key = ctx.accounts.product.key();
    let price = ctx.accounts.product.price;
    let product_name = ctx.accounts.product.name.clone();
    let decimals = ctx.accounts.mint.decimals;

    // 1. USDC 결제: buyer_token_account -> seller_token_account, price 만큼 이체.
    //    transfer_checked는 mint/decimals를 같이 검증해서 단순 transfer보다 안전함(실무 표준).
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.buyer_token_account.to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx.accounts.seller_token_account.to_account_info(),
        authority: ctx.accounts.buyer.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer_checked(cpi_ctx, price, decimals)?;

    // 2. 재고/판매량 갱신
    ctx.accounts.product.stock -= 1;
    ctx.accounts.product.sales_count += 1;

    // 3. 주문 기록 생성
    let order = &mut ctx.accounts.order;
    order.buyer = ctx.accounts.buyer.key();
    order.product = product_key;
    order.price_paid = price;
    order.timestamp = Clock::get()?.unix_timestamp;

    msg!("Purchase recorded: buyer {} bought {}", order.buyer, product_name);
    Ok(())
}