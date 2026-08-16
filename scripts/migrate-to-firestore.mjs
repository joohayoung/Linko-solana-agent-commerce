/**
 * data/*.json에 있는 기존 로컬 테스트 데이터를 Firestore로 1회성 업로드하는 스크립트.
 * Cloud Run 전환 전, 지금까지 쌓인 데모 데이터(광고주/캠페인/주문 등)를 그대로 이어서
 * 쓰고 싶을 때 한 번만 실행하면 됨. GOOGLE_CLOUD_PROJECT가 가리키는 프로젝트의 Firestore로
 * 씀 — 실행 전에 .env의 GOOGLE_CLOUD_PROJECT가 올바른지 확인할 것.
 *
 * 사용법: npm run migrate-firestore
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAll } from "../src/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const COLLECTIONS = ["advertisers", "campaigns", "orders", "participations", "promoters", "budgetRebalances"];

async function main() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error(".env에 GOOGLE_CLOUD_PROJECT가 없습니다 — Firestore가 어느 프로젝트로 쓰일지 알 수 없어요.");
  }
  console.log(`[migrate-to-firestore] 대상 프로젝트: ${process.env.GOOGLE_CLOUD_PROJECT}`);

  for (const collection of COLLECTIONS) {
    const filePath = path.join(DATA_DIR, `${collection}.json`);
    if (!fs.existsSync(filePath)) {
      console.log(`[migrate-to-firestore] ${collection}.json 없음 — 건너뜀`);
      continue;
    }
    const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (records.length === 0) {
      console.log(`[migrate-to-firestore] ${collection}: 레코드 없음 — 건너뜀`);
      continue;
    }
    await writeAll(collection, records);
    console.log(`[migrate-to-firestore] ${collection}: ${records.length}건 업로드 완료`);
  }

  console.log("[migrate-to-firestore] 완료.");
}

main().catch((e) => {
  console.error("[migrate-to-firestore] 실패:", e);
  process.exit(1);
});
