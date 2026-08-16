/**
 * 광고주 패스키 실서명(LazorKit) 트랜잭션 크기를 줄이기 위한 주소 룩업 테이블(ALT) 1회 생성 스크립트.
 *
 * create_campaign / create_budget / top_up_budget 인스트럭션에 항상 반복되는 고정 계정들
 * (USDC 민트, 토큰 프로그램, 에스크로 프로그램, 시스템 프로그램)을 ALT에 담아두면, 트랜잭션
 * 메시지에서 이 계정들이 32바이트 풀 주소 대신 1바이트 인덱스로만 참조돼서 크기가 크게 줄어듦.
 *
 * 사용법: node scripts/create-lookup-table.mjs
 * 실행 후 콘솔에 나오는 LINKO_ALT_ADDRESS 값을 .env 파일에 추가해야 함.
 */
import {
  AddressLookupTableProgram,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { connection, USDC_DEVNET_MINT, WALLETS_DIR, WALLET_IDS } from "../src/config.mjs";
import { ESCROW_PROGRAM_ID } from "../src/escrow.mjs";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";

function loadWallet(id) {
  const filePath = `${WALLETS_DIR}/${id}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main() {
  const platformAuthority = loadWallet(WALLET_IDS.platform);
  console.log(`플랫폼 지갑(=ALT authority): ${platformAuthority.publicKey.toBase58()}`);

  const slot = await connection.getSlot("finalized");
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: platformAuthority.publicKey,
    payer: platformAuthority.publicKey,
    recentSlot: slot,
  });

  console.log(`ALT 생성 트랜잭션 전송 중... (주소: ${lookupTableAddress.toBase58()})`);
  const createTx = new Transaction().add(createIx);
  const createSig = await sendAndConfirmTransaction(connection, createTx, [platformAuthority], {
    commitment: "confirmed",
  });
  console.log(`생성 완료: ${createSig}`);

  // 플랫폼 ATA도 포함시켜서 create_campaign + 플랫폼 수수료 이체를 한 트랜잭션에 같이 담을 때도
  // 크기를 최대한 아낀다 (플랫폼 지갑 주소는 고정이라 매번 반복되는 계정).
  const platformAta = await getAssociatedTokenAddress(USDC_DEVNET_MINT, platformAuthority.publicKey);

  const addresses = [
    USDC_DEVNET_MINT,
    TOKEN_PROGRAM_ID,
    ESCROW_PROGRAM_ID,
    SystemProgram.programId,
    platformAta,
  ];

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: platformAuthority.publicKey,
    authority: platformAuthority.publicKey,
    lookupTable: lookupTableAddress,
    addresses,
  });

  console.log(`ALT에 계정 ${addresses.length}개 추가 중...`);
  addresses.forEach((a) => console.log(`  - ${a.toBase58()}`));
  const extendTx = new Transaction().add(extendIx);
  const extendSig = await sendAndConfirmTransaction(connection, extendTx, [platformAuthority], {
    commitment: "confirmed",
  });
  console.log(`확장 완료: ${extendSig}`);

  console.log("\n=================================");
  console.log("아래 줄을 .env 파일에 추가해줘:");
  console.log(`LINKO_ALT_ADDRESS=${lookupTableAddress.toBase58()}`);
  console.log("=================================");
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
