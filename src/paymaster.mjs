/**
 * 자체 호스팅 Paymaster (LazorKit이 공개해둔 테스트용 공용 paymaster가
 * CORS/allow-list 문제로 막혀있어서, 우리 platform 지갑을 fee payer로 쓰는
 * 미니 JSON-RPC paymaster를 직접 구현함. 우리 서버(server.mjs)와 같은 오리진에서
 * 서빙되기 때문에 CORS 문제 자체가 발생하지 않음.
 *
 * LazorKit React SDK(@lazorkit/wallet)가 실제로 호출하는 메서드만 구현:
 *   - getPayerSigner        : fee payer(플랫폼 지갑) 주소 조회
 *   - getBlockhash          : 최신 blockhash 조회
 *   - signTransaction       : 플랫폼 지갑으로 서명만 (제출 안 함)
 *   - signAndSendTransaction: 플랫폼 지갑으로 서명 + devnet 제출 (가스비 대납)
 *
 * (SDK 소스: node_modules/@lazorkit/wallet/dist/index.js 의 Paymaster 클래스를
 *  역참조해서 요청/응답 형태를 그대로 맞춤)
 */
import fs from "node:fs";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { connection, WALLETS_DIR, WALLET_IDS } from "./config.mjs";

function loadPlatformKeypair() {
  const filePath = `${WALLETS_DIR}/${WALLET_IDS.platform}.json`;
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const platformKeypair = loadPlatformKeypair();

export function platformPublicKey() {
  return platformKeypair.publicKey;
}

export async function handlePaymasterRpc(body) {
  const { method, params = [], id = 1 } = body || {};
  try {
    switch (method) {
      case "getPayerSigner": {
        return { jsonrpc: "2.0", id, result: { signer_address: platformKeypair.publicKey.toBase58() } };
      }

      case "getBlockhash": {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        return { jsonrpc: "2.0", id, result: { blockhash } };
      }

      // LazorKit은 ExecuteChunk 단계(주소 룩업 테이블 사용 시)에서 레거시 Transaction이 아니라
      // VersionedTransaction(v0)을 보낸다. 레거시 Transaction.from()으로 v0 트랜잭션을 파싱하면
      // 헤더/서명자 정보가 깨져서 "missing required signature for instruction" 에러가 난다.
      // VersionedTransaction.deserialize()는 레거시/v0 포맷을 자동 감지해서 둘 다 처리하므로
      // 이걸로 통일한다.
      case "signTransaction": {
        // SDK 2.1.0부터 params가 배열([txBase64])이 아니라 객체({transaction, signer_key?})로 옴 —
        // 둘 다 지원하도록 처리.
        const txBase64 = Array.isArray(params) ? params[0] : params.transaction;
        const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
        tx.sign([platformKeypair]);
        const signed = Buffer.from(tx.serialize()).toString("base64");
        return { jsonrpc: "2.0", id, result: { signed_transaction: signed } };
      }

      case "signAndSendTransaction": {
        // SDK 2.1.0부터 params가 배열([txBase64])이 아니라 객체({transaction, signer_key?})로 옴 —
        // 둘 다 지원하도록 처리.
        const txBase64 = Array.isArray(params) ? params[0] : params.transaction;
        const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
        // 임시 디버그 로그 — LazorKit SDK가 실제로 어떤 트랜잭션 구조를 보내는지 확인용
        try {
          const msg = tx.message;
          console.error("[paymaster][DEBUG] staticAccountKeys:", msg.staticAccountKeys.map((k) => k.toBase58()));
          console.error("[paymaster][DEBUG] addressTableLookups:", msg.addressTableLookups.map((l) => ({
            table: l.accountKey.toBase58(),
            writableIndexes: l.writableIndexes,
            readonlyIndexes: l.readonlyIndexes,
          })));
          console.error("[paymaster][DEBUG] compiledInstructions:", msg.compiledInstructions.map((ix) => ({
            programIdIndex: ix.programIdIndex,
            accountKeyIndexes: ix.accountKeyIndexes,
            dataLen: ix.data.length,
          })));
        } catch (dbgErr) {
          console.error("[paymaster][DEBUG] 디코딩 실패:", dbgErr.message);
        }
        tx.sign([platformKeypair]);
        const raw = tx.serialize();
        try {
          const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
          await connection.confirmTransaction(signature, "confirmed");
          return { jsonrpc: "2.0", id, result: { signature } };
        } catch (sendErr) {
          // sendRawTransaction의 preflight 실패 응답엔 프로그램 로그가 비어있는 경우가 있어서,
          // 실패 원인을 정확히 보려고 같은 트랜잭션을 다시 시뮬레이션해서 전체 로그를 남긴다.
          try {
            const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
            console.error("[paymaster] signAndSendTransaction 실패 — 재시뮬레이션 로그:", JSON.stringify(sim.value.logs, null, 2));
          } catch (simErr) {
            console.error("[paymaster] 재시뮬레이션도 실패:", simErr.message);
          }
          throw sendErr;
        }
      }

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (e) {
    console.error("[paymaster]", method, e);
    return { jsonrpc: "2.0", id, error: { code: -32000, message: e.message || String(e) } };
  }
}
