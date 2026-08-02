/**
 * 가짜 쇼핑몰 상태 저장소 + 스키마 포맷터 (모듈 9의 핵심 로직)
 * server.mjs의 /mock-shop 라우트와 scripts/06-mock-shops-server.mjs가 공유합니다.
 */
export const SHOP_IDS = ["sundayglow-mall", "nongshim-mall", "lge-mall"];

// key: `${shopId}:${orderId}` -> { orderId, amount, state, createdAt, updatedAt }
// state: "paid" | "confirmed" | "cancelled"
const store = new Map();

function key(shopId, orderId) {
  return `${shopId}:${orderId}`;
}
function nowIso() {
  return new Date().toISOString();
}

function formatSundayGlow(rec) {
  const statusMap = { paid: "PAID", confirmed: "CONFIRMED", cancelled: "CANCELLED" };
  return { orderId: rec.orderId, status: statusMap[rec.state], amount: rec.amount, updatedAt: rec.updatedAt };
}
function formatNongshim(rec) {
  const statusMap = { paid: "결제완료", confirmed: "구매확정", cancelled: "반품접수" };
  return { order: { id: rec.orderId, delivery_status: statusMap[rec.state], price: rec.amount, updated_at: rec.updatedAt } };
}
function formatLge(rec) {
  const stateMap = {
    paid: { stateCode: "10", stateDesc: "결제완료" },
    confirmed: { stateCode: "20", stateDesc: "구매확정" },
    cancelled: { stateCode: "90", stateDesc: "취소/반품" },
  };
  const s = stateMap[rec.state];
  return { result: { orderNo: rec.orderId, stateCode: s.stateCode, stateDesc: s.stateDesc, amt: rec.amount, ts: rec.updatedAt } };
}

const FORMATTERS = {
  "sundayglow-mall": formatSundayGlow,
  "nongshim-mall": formatNongshim,
  "lge-mall": formatLge,
};

export function formatOrder(shopId, rec) {
  const formatter = FORMATTERS[shopId];
  if (!formatter) throw new Error(`알 수 없는 shopId: ${shopId}`);
  return formatter(rec);
}

export function createOrder(shopId, orderId, amount) {
  const rec = { orderId, amount, state: "paid", createdAt: nowIso(), updatedAt: nowIso() };
  store.set(key(shopId, orderId), rec);
  return formatOrder(shopId, rec);
}

export function getOrder(shopId, orderId) {
  const rec = store.get(key(shopId, orderId));
  if (!rec) return null;
  return formatOrder(shopId, rec);
}

export function setState(shopId, orderId, state) {
  const rec = store.get(key(shopId, orderId));
  if (!rec) return null;
  rec.state = state;
  rec.updatedAt = nowIso();
  store.set(key(shopId, orderId), rec);
  return formatOrder(shopId, rec);
}

/**
 * 알려진 쇼핑몰 스키마를 로컬에서 즉시 정규화 (Gemini 미사용, 데모용 고속 경로).
 * 위 formatXxx()의 역함수 — 이미 스키마를 아는 쇼핑몰이라 네트워크 호출 없이 동기적으로 판단 가능.
 * 실서비스라면 "처음 보는 쇼핑몰 스키마"에 한해서만 Gemini(normalize.mjs)로 폴백하는 구조가 이상적.
 * @returns {{status: "confirmed"|"cancelled"|"pending", reason: string} | null} 모르는 shopId면 null
 */
export function normalizeOrderStatusLocal(shopId, raw) {
  if (shopId === "sundayglow-mall") {
    const map = { PAID: "pending", CONFIRMED: "confirmed", CANCELLED: "cancelled" };
    const status = map[raw?.status] || "pending";
    return { status, reason: `[로컬 파서] sundayglow-mall status=${raw?.status}` };
  }
  if (shopId === "nongshim-mall") {
    const map = { "결제완료": "pending", "구매확정": "confirmed", "반품접수": "cancelled" };
    const s = raw?.order?.delivery_status;
    return { status: map[s] || "pending", reason: `[로컬 파서] nongshim-mall delivery_status=${s}` };
  }
  if (shopId === "lge-mall") {
    const map = { "10": "pending", "20": "confirmed", "90": "cancelled" };
    const code = raw?.result?.stateCode;
    return { status: map[code] || "pending", reason: `[로컬 파서] lge-mall stateCode=${code}` };
  }
  return null;
}
