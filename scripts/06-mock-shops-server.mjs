/**
 * 9. 가짜 쇼핑몰 API 시뮬레이터 (독립 실행용)
 * 참고: server.mjs를 쓰는 경우 이미 /mock-shop 경로에 동일한 기능이 마운트되어 있어서
 * 이 스크립트는 따로 안 띄워도 됩니다. 단독으로 모듈 9만 테스트하고 싶을 때 사용하세요.
 *
 * 실행: node scripts/06-mock-shops-server.mjs [port]  (기본 4000)
 */
import http from "node:http";
import { SHOP_IDS, createOrder, getOrder, setState } from "../src/mockShop.mjs";

const PORT = parseInt(process.argv[2] || "4000", 10);

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const shopId = parts[0];

  if (!SHOP_IDS.includes(shopId)) {
    return sendJson(res, 404, { error: `알 수 없는 shopId: ${shopId}`, valid: SHOP_IDS });
  }
  if (parts[1] !== "orders") return sendJson(res, 404, { error: "not found" });

  try {
    if (req.method === "POST" && parts.length === 2) {
      const body = await readBody(req);
      if (!body.orderId || body.amount == null) return sendJson(res, 400, { error: "orderId, amount 필수" });
      return sendJson(res, 201, createOrder(shopId, body.orderId, body.amount));
    }
    if (req.method === "GET" && parts.length === 3) {
      const rec = getOrder(shopId, parts[2]);
      if (!rec) return sendJson(res, 404, { error: "주문 없음" });
      return sendJson(res, 200, rec);
    }
    if (req.method === "POST" && parts.length === 4) {
      const action = parts[3];
      if (!["confirm", "cancel"].includes(action)) return sendJson(res, 400, { error: `알 수 없는 action: ${action}` });
      const rec = setState(shopId, parts[2], action === "confirm" ? "confirmed" : "cancelled");
      if (!rec) return sendJson(res, 404, { error: "주문 없음" });
      return sendJson(res, 200, rec);
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`=== 가짜 쇼핑몰 API 시뮬레이터 (포트 ${PORT}, 독립 실행) ===`);
  console.log(`지원 쇼핑몰: ${SHOP_IDS.join(", ")}`);
});
