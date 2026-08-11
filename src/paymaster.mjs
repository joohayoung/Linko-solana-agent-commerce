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
import { Keypair, Transaction } from "@solana/web3.js";
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

      case "signTransaction": {
        const [txBase64] = params;
        const tx = Transaction.from(Buffer.from(txBase64, "base64"));
        tx.partialSign(platformKeypair);
        const signed = tx.serialize({ verifySignatures: false, requireAllSignatures: false });
        return { jsonrpc: "2.0", id, result: { signed_transaction: signed.toString("base64") } };
      }

      case "signAndSendTransaction": {
        const [txBase64] = params;
        const tx = Transaction.from(Buffer.from(txBase64, "base64"));
        tx.partialSign(platformKeypair);
        const raw = tx.serialize({ verifySignatures: false, requireAllSignatures: false });
        const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
        await connection.confirmTransaction(signature, "confirmed");
        return { jsonrpc: "2.0", id, result: { signature } };
      }

      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (e) {
    console.error("[paymaster]", method, e);
    return { jsonrpc: "2.0", id, error: { code: -32000, message: e.message || String(e) } };
  }
}
