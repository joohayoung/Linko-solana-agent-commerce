use anchor_lang::prelude::*;

#[constant]
pub const CAMPAIGN_SEED: &[u8] = b"campaign";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const BUDGET_SEED: &[u8] = b"budget";

// 플랫폼 정산 지갑(wallets/settlement.json) 고정 주소. create_budget 인스트럭션이 이 값을
// 인자나 계정으로 넘기면 LazorKit 스마트월렛 CPI 래핑 오버헤드까지 더해져 트랜잭션 크기
// 한도(1232바이트)를 넘겨서, 아예 상수로 박아 인스트럭션에서 완전히 제거했다.
// 플랫폼 지갑이 바뀌면 이 값도 같이 바꾸고 프로그램을 재배포해야 함.
pub const PLATFORM_AUTHORITY: Pubkey = pubkey!("9GEgPQH8pWRRQD75DyZwSGTBN8n7xKJGVZCpsZo2KzHZ");