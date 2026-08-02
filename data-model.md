# 데이터 모델

DB 없이 `data/*.json` 파일 기반 (파일 I/O는 `src/db.mjs`). 시간이 남으면 실제 DB로 교체 가능.

## campaigns (`data/campaigns.json`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 캠페인 식별자 |
| advertiser | string | 광고주 |
| product | string | 상품명 |
| description | string | 상품 설명 |
| productUrl | string | 실제 상품 페이지 URL. /go/:code 클릭 리다이렉트가 (실서비스라면) 최종적으로 이동시킬 주소 |
| guideline | string | 광고 가이드라인 (크리에이터에게 캠페인 상세 페이지로 노출) |
| tags | string[] | 검색용 태그 (Gemini 캠페인 검색에서 사용) |
| price | number | 상품 가격 (원) |
| commissionTiers | {minSales, maxSales, rate}[] | 누적 확정판매 건수 구간별 리워드 요율(내부 필드명은 commissionTiers 유지). maxSales=null이면 상한 없음 |
| confirmDelayDays | number | 구매확정까지 대기 기간(일) — 부정사용 방지 핵심 |
| budgetKrw | number | 캠페인 예산(원). 사용자에게는 원화로만 노출되고, 실제 정산은 내부적으로 USDC로 환산되어 온체인 지급됨 |
| shopId | string | 연동된 가짜 쇼핑몰 시뮬레이터 식별자 (모듈 9). 등록 폼에는 노출되지 않고 서버가 자동 배정 |
| status | string | active / ended |

## promoters (`data/promoters.json`)
| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 크리에이터 식별자 |
| name | string | 이름 |
| followers | number | 팔로워 수 (표시용, 자격요건 아님 — 누구나 참여 가능) |
| walletAddress | string | devnet 지갑 공개키 (정산 수신처) |

## participations (`data/participations.json`)
크리에이터가 특정 캠페인에 참여해 추천링크(코드)를 발급받은 기록.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 참여 식별자 |
| promoterId | string | promoters.id 참조 |
| campaignId | string | campaigns.id 참조 |
| referralCode | string | 체크아웃 시 사용되는 추천코드 |
| clicks | number | `/go/:referralCode` 클릭 리다이렉트를 통해 들어온 클릭 수 (구매 전환 전 단계 추적) |
| joinedAt | ISO string | 참여 시각 |

## orders (`data/orders.json`)
구매 발생부터 정산까지의 상태를 추적. 처음엔 빈 배열, 체크아웃 시뮬레이터(모듈 12)가 생성.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 주문 식별자 |
| campaignId | string | campaigns.id 참조 |
| referralCode | string | 어떤 크리에이터를 통해 들어온 주문인지 |
| promoterId | string | referralCode로부터 역참조 (조회 편의용) |
| amount | number | 결제 금액(원) |
| status | string | `purchased`(구매발생) → `pending_confirm`(확정대기) → `settled`(정산완료) 또는 `cancelled`(취소) |
| purchasedAt | ISO string | 구매 시각 |
| confirmDueAt | ISO string | `purchasedAt + confirmDelayDays` — 이 시점 이후 취소 없으면 확정 |
| settledAt | ISO string \| null | 정산 완료 시각 |
| settlementTx | string \| null | Solana Pay 정산 트랜잭션 서명 (Solscan 링크용) |
| commissionRateApplied | number \| null | 정산 시점에 적용된 요율 (해당 크리에이터의 그 시점까지 누적 확정건수 기준) |
| commissionAmountUsdc | number \| null | 실제 지급된 USDC 커미션 금액 |

## 요율 계산 규칙 (핵심 로직, 모듈 6)
특정 주문이 **확정**되는 순간, 그 주문의 promoterId가 **같은 캠페인에서 지금까지 확정한 누적 판매 건수**(이 주문 포함)를 세고, `commissionTiers`에서 그 구간의 rate를 찾아 적용한다. 요율은 확정 시점에 결정되며 소급 적용되지 않고, 크리에이터별로 독립적으로 계산된다.
