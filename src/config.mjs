import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NETWORK = "devnet";
export const RPC_ENDPOINT = clusterApiUrl(NETWORK);

export const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Circle 공식 devnet USDC 민트 주소
export const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

export const WALLETS_DIR = path.resolve(__dirname, "..", "wallets");

// 메인 앱 서버 포트 (server.mjs) — 가짜 쇼핑몰 라우트도 이 서버 안에 함께 마운트됨
export const APP_PORT = parseInt(process.env.PORT || "3000", 10);

// 가짜 쇼핑몰 API — 기본값은 server.mjs 안에 마운트된 /mock-shop 경로
// (독립 실행되는 scripts/06-mock-shops-server.mjs를 쓰고 싶으면 MOCK_SHOP_BASE_URL=http://localhost:4000 로 오버라이드)
export const MOCK_SHOP_BASE_URL =
  process.env.MOCK_SHOP_BASE_URL || `http://localhost:${APP_PORT}/mock-shop`;

// 데모용 고정 환율 (원/USDC)
export const KRW_PER_USDC = 1400;

// 플랫폼 수수료율 — 캠페인 예산 예치 시, 예산과는 별도로 (예산 × 이 비율)만큼을
// 광고주 지갑에서 플랫폼 지갑으로 같은 트랜잭션에서 함께 이체함(플랫폼 매출).
// 온체인 가스비(정산 트랜잭션마다 플랫폼이 대납)도 이 수수료 안에서 충당한다는 전제 —
// 솔라나 트랜잭션 수수료가 매우 작아(건당 약 5000 lamports) 별도로 미터링하지 않음.
export const PLATFORM_FEE_RATE = 0.05;

// 데모용 지갑 아이디 목록 — 광고주/플랫폼/크리에이터 역할별로 분리된 지갑
export const WALLET_IDS = {
  platform: "settlement", // 플랫폼 지갑: settle_commission 실행 권한 + 가스비 대납 (기존 "settlement" 파일 재사용)
  advertiser: "advertiser", // 광고주 데모 지갑: 캠페인 생성 + 예산 USDC 예치
  promoter1: "promoter-jisu", // 크리에이터 지수
  promoter2: "promoter-minsu", // 크리에이터 민수
};

export function solscanTxUrl(signature) {
  return `https://solscan.io/tx/${signature}?cluster=${NETWORK}`;
}

export function solscanAddressUrl(address) {
  return `https://solscan.io/account/${address}?cluster=${NETWORK}`;
}
