/**
 * 8. 데이터 모델 — Firestore 저장소
 * Cloud Run은 무상태(stateless) 컨테이너라 로컬 JSON 파일로는 인스턴스 재시작/스케일아웃 시
 * 데이터가 유실된다. 그래서 Firestore로 옮기되, 호출부 영향을 최소화하기 위해 기존 함수
 * 시그니처(readAll/writeAll/findById/findWhere/insert/update)는 그대로 유지한다 — 다만
 * Firestore 자체가 네트워크 호출이라 전부 async가 됐으므로, 호출부는 await을 붙여야 한다.
 * 컬렉션: advertisers/campaigns/orders/participations/promoters/budgetRebalances.
 */
import { Firestore } from "@google-cloud/firestore";

const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  ignoreUndefinedProperties: true,
});

export async function readAll(collection) {
  const snapshot = await firestore.collection(collection).get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function writeAll(collection, records) {
  const colRef = firestore.collection(collection);
  const existingDocs = await colRef.listDocuments();
  const batch = firestore.batch();
  for (const docRef of existingDocs) batch.delete(docRef);
  for (const record of records) batch.set(colRef.doc(String(record.id)), record);
  await batch.commit();
}

export async function findById(collection, id) {
  const doc = await firestore.collection(collection).doc(String(id)).get();
  return doc.exists ? doc.data() : null;
}

export async function findWhere(collection, predicate) {
  const all = await readAll(collection);
  return all.filter(predicate);
}

export async function insert(collection, record) {
  await firestore.collection(collection).doc(String(record.id)).set(record);
  return record;
}

export async function update(collection, id, patch) {
  const docRef = firestore.collection(collection).doc(String(id));
  const snap = await docRef.get();
  if (!snap.exists) throw new Error(`${collection}에서 id=${id} 를 찾을 수 없습니다.`);
  const updated = { ...snap.data(), ...patch };
  await docRef.set(updated);
  return updated;
}
