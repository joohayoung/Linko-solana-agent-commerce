// 공통 유틸 (fetch 래퍼, 포맷터, 토스트) — 프레임워크 없이 순수 JS

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function won(n) {
  return `${Number(n).toLocaleString("ko-KR")}원`;
}

function usdc(n) {
  return `${Number(n).toFixed(2)} USDC`;
}

function pct(rate) {
  return `${Math.round(rate * 100)}%`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  const map = {
    purchased: "구매발생",
    pending_confirm: "확정대기",
    settled: "정산완료",
    cancelled: "취소",
  };
  return map[status] || status;
}

function statusBadgeClass(status) {
  const map = {
    purchased: "purchased",
    pending_confirm: "pending",
    settled: "settled",
    cancelled: "cancelled",
  };
  return map[status] || "purchased";
}

let toastTimer;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function initials(text) {
  return String(text).slice(0, 2);
}
