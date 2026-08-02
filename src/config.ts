import { Connection, clusterApiUrl, PublicKey } from "@solana/web3.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NETWORK = "devnet" as const;
export const RPC_ENDPOINT = clusterApiUrl(NETWORK);

export const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Circle 공식 devnet USDC 민트 주소
export const USDC_DEVNET_MINT = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

export const WALLETS_DIR = path.resolve(__dirname, "..", "wallets");

// 데모용 지갑 아이디 목록
export const WALLET_IDS = {
  settlement: "settlement", // 정산 지갑 (광고주/플랫폼 대표)
  promoter1: "promoter-jisu", // 홍보자 지수
  promoter2: "promoter-minsu", // 홍보자 민수
} as const;

export function solscanTxUrl(signature: string) {
  return `https://solscan.io/tx/${signature}?cluster=${NETWORK}`;
}

export function solscanAddressUrl(address: string) {
  return `https://solscan.io/account/${address}?cluster=${NETWORK}`;
}
