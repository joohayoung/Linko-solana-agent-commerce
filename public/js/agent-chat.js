// Linko AI 에이전트 — 플로팅 채팅 위젯
// 모든 페이지에서 공통으로 사용되는 채팅 UI

(function () {
  // 현재 페이지에 따라 역할 자동 감지
  const path = location.pathname;
  const role = path.includes("promoter")
    ? "promoter"
    : path.includes("advertiser")
      ? "advertiser"
      : "general";

  let history = [];
  let isOpen = false;
  let isLoading = false;

  // ──── 채팅 위젯 HTML 생성 ────

  const widget = document.createElement("div");
  widget.id = "agentWidget";
  widget.innerHTML = `
    <button class="agent-fab" id="agentFab" title="AI 어시스턴트">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="agent-fab-badge" id="agentBadge" style="display:none;"></span>
    </button>

    <div class="agent-panel" id="agentPanel" style="display:none;">
      <div class="agent-header">
        <div class="agent-header-title">
          <span class="agent-avatar">🤖</span>
          <div>
            <div class="agent-name">링코 AI</div>
            <div class="agent-status">Gemini 기반 어시스턴트</div>
          </div>
        </div>
        <button class="agent-close" id="agentClose">✕</button>
      </div>

      <div class="agent-messages" id="agentMessages">
        <div class="agent-msg agent-msg-ai">
          <div class="agent-msg-bubble">
            안녕하세요! 저는 Linko AI 어시스턴트 <b>링코</b>예요 🤖<br/>
            ${role === "promoter" ? "캠페인 추천, 실적 분석, 광고 문구 생성 등을 도와드릴게요." : role === "advertiser" ? "캠페인 성과 분석, 크리에이터 실적 비교 등을 도와드릴게요." : "캠페인 검색, 수익 시뮬레이션 등 무엇이든 물어보세요."}
          </div>
        </div>
      </div>

      <div class="agent-presets" id="agentPresets">
        ${
          role === "promoter"
            ? `<button class="agent-preset-btn" data-msg="내 실적 분석해줘">📊 실적 분석</button>
               <button class="agent-preset-btn" data-msg="나한테 맞는 캠페인 추천해줘">🔍 캠페인 추천</button>
               <button class="agent-preset-btn" data-msg="선크림 캠페인 인스타 홍보 문구 만들어줘">✍️ 광고 문구</button>
               <button class="agent-preset-btn" data-msg="선크림 50개 팔면 얼마 벌어?">📈 수익 예측</button>`
            : role === "advertiser"
              ? `<button class="agent-preset-btn" data-msg="내 캠페인들 성과 분석해줘">📊 성과 분석</button>
                 <button class="agent-preset-btn" data-msg="어떤 캠페인이 ROI가 제일 좋아?">🏆 ROI 비교</button>
                 <button class="agent-preset-btn" data-msg="전체 캠페인 현황 요약해줘">📋 현황 요약</button>`
              : `<button class="agent-preset-btn" data-msg="지금 진행 중인 캠페인 보여줘">🔍 캠페인 목록</button>
                 <button class="agent-preset-btn" data-msg="뷰티 관련 캠페인 찾아줘">💄 뷰티 검색</button>
                 <button class="agent-preset-btn" data-msg="선크림 100개 팔면 수익이 얼마야?">📈 수익 예측</button>`
        }
      </div>

      <div class="agent-input-area">
        <input class="agent-input" id="agentInput" placeholder="무엇이든 물어보세요..." />
        <button class="agent-send" id="agentSend">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  // ──── DOM 참조 ────

  const fab = document.getElementById("agentFab");
  const panel = document.getElementById("agentPanel");
  const closeBtn = document.getElementById("agentClose");
  const messagesEl = document.getElementById("agentMessages");
  const inputEl = document.getElementById("agentInput");
  const sendBtn = document.getElementById("agentSend");
  const presetsEl = document.getElementById("agentPresets");

  // ──── 토글 ────

  fab.addEventListener("click", () => {
    isOpen = !isOpen;
    panel.style.display = isOpen ? "flex" : "none";
    fab.classList.toggle("active", isOpen);
    if (isOpen) inputEl.focus();
  });

  closeBtn.addEventListener("click", () => {
    isOpen = false;
    panel.style.display = "none";
    fab.classList.remove("active");
  });

  // ──── 메시지 렌더링 ────

  function addMessage(text, isUser) {
    const div = document.createElement("div");
    div.className = `agent-msg ${isUser ? "agent-msg-user" : "agent-msg-ai"}`;
    div.innerHTML = `<div class="agent-msg-bubble">${isUser ? escapeHtml(text) : formatAiText(text)}</div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function addLoading() {
    const div = document.createElement("div");
    div.className = "agent-msg agent-msg-ai";
    div.id = "agentLoading";
    div.innerHTML = `<div class="agent-msg-bubble"><span class="agent-typing"><span></span><span></span><span></span></span></div>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeLoading() {
    const el = document.getElementById("agentLoading");
    if (el) el.remove();
  }

  // 간단한 마크다운 → HTML 변환 (링크 파싱 포함)
  function formatAiText(text) {
    return text
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="display:inline-block; margin-top:4px; font-weight:bold; color:var(--primary); text-decoration:underline;">$1 ↗</a>')
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>")
      .replace(/\n- /g, "\n• ")
      .replace(/\n(\d+)\. /g, "\n$1. ")
      .replace(/\n/g, "<br/>");
  }

  // ──── 전송 ────

  async function sendMessage(text) {
    if (isLoading || !text.trim()) return;
    isLoading = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    // 프리셋 버튼 숨기기
    presetsEl.style.display = "none";

    addMessage(text, true);
    addLoading();

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, history, message: text }),
      });
      const data = await res.json();

      removeLoading();

      if (!res.ok) {
        addMessage(`오류가 발생했어요: ${data.error || "알 수 없는 오류"}`, false);
      } else {
        history = data.history || [];
        addMessage(data.reply, false);
      }
    } catch (e) {
      removeLoading();
      addMessage(`네트워크 오류: ${e.message}`, false);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.value = "";
      inputEl.focus();
    }
  }

  sendBtn.addEventListener("click", () => sendMessage(inputEl.value));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  // 프리셋 버튼 클릭
  presetsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-msg]");
    if (btn) sendMessage(btn.dataset.msg);
  });

  // 채팅 패널 외부 클릭 시 닫기 방지 (패널 자체 클릭은 유지)
  panel.addEventListener("click", (e) => e.stopPropagation());
})();
