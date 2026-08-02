/**
 * 8. 데이터 모델 — 파일 기반 저장소
 * 해커톤 MVP라 DB 없이 JSON 파일로 시작합니다. 스키마는 data-model.md 참고.
 * 각 컬렉션(campaigns/promoters/participations/orders)은 data/*.json 배열로 저장됩니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, "..", "data");

function filePathFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function ensureCollection(collection) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const fp = filePathFor(collection);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, "[]");
  return fp;
}

export function readAll(collection) {
  const fp = ensureCollection(collection);
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}

export function writeAll(collection, records) {
  const fp = ensureCollection(collection);
  fs.writeFileSync(fp, JSON.stringify(records, null, 2));
}

export function findById(collection, id) {
  return readAll(collection).find((r) => r.id === id) ?? null;
}

export function findWhere(collection, predicate) {
  return readAll(collection).filter(predicate);
}

export function insert(collection, record) {
  const records = readAll(collection);
  records.push(record);
  writeAll(collection, records);
  return record;
}

export function update(collection, id, patch) {
  const records = readAll(collection);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) throw new Error(`${collection}에서 id=${id} 를 찾을 수 없습니다.`);
  records[idx] = { ...records[idx], ...patch };
  writeAll(collection, records);
  return records[idx];
}
