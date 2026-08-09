# 🔗 Linko Escrow — Solana Anchor Program

> **Linko**는 광고주(Advertiser)와 크리에이터(Promoter) 간의 커미션 정산을 Solana 블록체인 위에서 신뢰 없이(trustless) 처리하는 에스크로 프로그램입니다.

---

## 📌 개요

| 항목 | 내용 |
|------|------|
| 네트워크 | Solana **Devnet** |
| 프로그램 ID | `4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP` |
| 언어 | Rust (Anchor Framework) |
| Anchor 버전 | `1.1.2` |
| Rust 버전 | `1.89.0` |
| 결제 수단 | USDC (SPL Token) |

---

## 🏗️ 아키텍처

```
광고주 (Advertiser)
    │
    │  create_campaign(campaign_id, budget_usdc)
    │  ─────────────────────────────────────────▶  Campaign 계정 생성
    │                                              Vault(에스크로)에 USDC 예치
    │
    │  settle_commission(amount_usdc, order_id)
    │  ─────────────────────────────────────────▶  Vault → 크리에이터 지갑으로 USDC 전송
    │
    │  close_campaign()
    │  ─────────────────────────────────────────▶  잔여 USDC 광고주에게 반환
                                                   Campaign 계정 및 Vault 종료
```

---

## 📂 프로젝트 구조

```
anchor_program/
├── programs/
│   └── linko-escrow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs               # 프로그램 진입점, instruction 등록
│           ├── constants.rs         # PDA seed 상수 (campaign, vault)
│           ├── state.rs             # Campaign 계정 구조체
│           ├── error.rs             # 커스텀 에러 코드
│           ├── instructions.rs      # instruction 모듈 선언
│           └── instructions/
│               ├── create_campaign.rs    # 캠페인 생성 & USDC 예치
│               ├── settle_commission.rs  # 크리에이터에게 커미션 정산
│               ├── close_campaign.rs     # 캠페인 종료 & 잔여금 반환
│               ├── list_product.rs       # (확장) 상품 등록
│               └── purchase_product.rs   # (확장) 상품 구매
├── Anchor.toml
├── Cargo.toml
├── Cargo.lock
└── rust-toolchain.toml
```

---

## ⚙️ Instructions (온체인 함수)

### 1. `create_campaign`
광고주가 캠페인을 생성하고 USDC를 에스크로 Vault에 예치합니다.

```
인자:
  - campaign_id: String  (최대 36바이트, 고유 식별자)
  - budget_usdc: u64     (예치할 USDC 금액, 단위: lamport)

필요 계정:
  - advertiser          (서명자, SOL 수수료 지불)
  - campaign            (PDA, 새로 생성)
  - vault               (PDA TokenAccount, 에스크로)
  - mint                (USDC Mint 주소)
  - advertiser_token_account
```

### 2. `settle_commission`
광고주(또는 플랫폼)가 크리에이터에게 커미션을 정산합니다. Vault에서 크리에이터 지갑으로 USDC가 전송됩니다.

```
인자:
  - amount_usdc: u64    (정산할 USDC 금액)
  - order_id: String    (주문 식별자, 로깅용)

필요 계정:
  - authority           (광고주 또는 플랫폼 지갑, 서명자)
  - campaign            (기존 PDA)
  - vault               (에스크로 TokenAccount)
  - mint
  - creator_token_account
```

### 3. `close_campaign`
캠페인을 종료합니다. 잔여 USDC를 광고주에게 반환하고 모든 계정을 닫습니다.

```
필요 계정:
  - advertiser          (서명자, 캠페인 소유자만 가능)
  - campaign            (종료될 PDA)
  - vault               (종료될 TokenAccount)
  - mint
  - advertiser_token_account
```

---

## 🗂️ Campaign 상태 (State)

```rust
pub struct Campaign {
    pub advertiser: Pubkey,    // 광고주 지갑 주소
    pub campaign_id: String,   // 캠페인 고유 ID (max 36자)
    pub budget_usdc: u64,      // 총 예산 (USDC)
    pub spent_usdc: u64,       // 지출된 금액
    pub mint: Pubkey,          // USDC Mint 주소
    pub bump: u8,              // Campaign PDA bump
    pub vault_bump: u8,        // Vault PDA bump
    pub is_active: bool,       // 캠페인 활성 여부
}
```

---

## 🔐 PDA 구조

| 계정 | Seeds |
|------|-------|
| Campaign | `["campaign", advertiser_pubkey, campaign_id]` |
| Vault | `["vault", campaign_pubkey]` |

---

## 🚀 개발 환경 설정

### 사전 요구사항

```bash
# 1. Rust 설치
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Solana CLI 설치
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# 3. Anchor CLI 설치 (avm 사용)
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest
avm use latest
```

### 버전 확인

```bash
rustc --version      # 1.89.0
solana --version
anchor --version     # 1.1.2
```

---

## 📦 설치 및 빌드

```bash
# 1. 레포 클론
git clone https://github.com/joohayoung/Linko-solana-agent-commerce.git
cd Linko-solana-agent-commerce/anchor_program

# 2. Solana 지갑 생성 (없는 경우)
solana-keygen new

# 3. Devnet으로 네트워크 설정
solana config set --url devnet

# 4. Devnet SOL 에어드롭 (테스트용)
solana airdrop 2

# 5. 빌드
anchor build
```

---

## 🧪 테스트

```bash
# 전체 테스트 실행
anchor test

# 또는 Cargo 테스트
cargo test
```

> 테스트에는 `litesvm`을 사용하여 로컬에서 빠르게 실행됩니다 (별도 validator 불필요).

---

## 🚢 배포 (Devnet)

```bash
# 빌드 후 배포
anchor deploy --provider.cluster devnet

# 배포 확인
solana program show 4KocVh769f9Z43717gsSW9Wp4863eQ7npKSWEbDbwLPP
```

---

## ❌ 에러 코드

| 코드 | 메시지 | 설명 |
|------|--------|------|
| `BudgetExceeded` | Campaign budget exceeded | 정산 금액이 잔여 예산 초과 |
| `CampaignNotActive` | Campaign is not active | 비활성 캠페인에 정산 시도 |
| `Unauthorized` | Unauthorized: only the advertiser can perform this action | 권한 없는 계정의 접근 |
| `CampaignIdTooLong` | Campaign ID too long (max 36 bytes) | campaign_id가 36바이트 초과 |

---

## 🤝 기여 방법

1. 이 저장소를 **Fork**합니다
2. 새 브랜치를 생성합니다 (`git checkout -b feature/새기능`)
3. 변경사항을 커밋합니다 (`git commit -m 'feat: 새기능 추가'`)
4. 브랜치에 Push합니다 (`git push origin feature/새기능`)
5. **Pull Request**를 생성합니다

---

## 📄 라이선스

MIT License
