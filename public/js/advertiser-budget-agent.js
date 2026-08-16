let krwPerUsdc = 1400;
let currentAdvertiserId = null;

api("/api/config")
  .then((cfg) => {
    krwPerUsdc = cfg.krwPerUsdc || krwPerUsdc;
  })
  .catch(() => {});

async function loadBudgetStatus(advertiserId) {
  currentAdvertiserId = advertiserId;
  const panel = document.getElementById("budgetStatusPanel");
  try {
    const info = await api(`/api/advertiser/${advertiserId}/budget`);
    if (info.exists) {
      panel.innerHTML = `
        ${info.simulated ? `<p style="color:var(--danger); font-size:12.5px; font-weight:700; margin:0 0 10px;">⚠ 시뮬레이션 모드 — 실제 온체인 Budget Vault가 아니라 가정한 값이에요.</p>` : ""}
        <div class="stat-row">
          <div class="stat-card"><div class="label">Budget Vault 잔액</div><div class="value small">${won(Math.round(info.vaultBalanceUsdc * krwPerUsdc))}</div></div>
        </div>
        <p style="color:var(--muted); font-size:12.5px; margin-top:10px;">이 전체 금액이 에이전트에게 주어지는 풀이에요 — 실제로 얼마를 쓸지는 에이전트가 판단해요.</p>
      `;
      document.getElementById("runBtn").disabled = false;
    } else {
      panel.innerHTML = `<p style="color:var(--muted); font-size:13.5px;">아직 Budget PDA가 없어요. <a href="/advertiser-budget-setup.html">먼저 예비 예산을 충전해주세요 →</a></p>`;
      document.getElementById("runBtn").disabled = true;
    }
  } catch (e) {
    panel.innerHTML = `<p style="color:var(--danger);">${escapeHtml(e.message)}</p>`;
  }
}

function transcriptToStep(agentLabel, t) {
  if (t.type === "tool_call") {
    return { label: `${agentLabel} · 도구 호출 — ${t.name}`, code: JSON.stringify({ args: t.args, result: t.result }, null, 2) };
  }
  if (t.type === "note") {
    return { label: `${agentLabel} · 생각 중`, text: t.text };
  }
  if (t.type === "fallback") {
    return { label: `${agentLabel} · Gemini 실패 → 로컬 폴백`, text: t.reason };
  }
  if (t.type === "final") {
    return { label: `${agentLabel} · 최종 판단`, code: JSON.stringify(t.output, null, 2) };
  }
  return { label: agentLabel, text: JSON.stringify(t) };
}

function buildSteps(data) {
  const steps = [{ label: "🔍 분석 에이전트 시작", text: "활성 캠페인을 조사해 성과 점수를 매겨요." }];
  for (const t of data.analyst.transcript) steps.push(transcriptToStep("분석 에이전트", t));
  steps.push({ label: "📨 Agent-to-Agent 메시지", code: JSON.stringify(data.a2aMessage, null, 2) });
  steps.push({ label: "💰 예산분배 에이전트 시작", text: "Budget Vault 잔액을 보고 얼마나 쓸지부터 스스로 판단해요." });
  for (const t of data.allocatorTranscript) steps.push(transcriptToStep("예산분배 에이전트", t));
  return steps;
}

function revealSteps(steps, container, delayMs = 450) {
  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (i >= steps.length) return resolve();
      const s = steps[i++];
      const el = document.createElement("div");
      el.className = "log-entry";
      el.innerHTML = `<div class="log-label">${escapeHtml(s.label)}</div>${
        s.code ? `<pre>${escapeHtml(s.code)}</pre>` : s.text ? `<div>${escapeHtml(s.text)}</div>` : ""
      }`;
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      setTimeout(next, delayMs);
    }
    next();
  });
}

function renderAllocations(allocator) {
  const unallocatedKrw = Math.round(allocator.unallocatedUsdc * krwPerUsdc);
  document.getElementById("resultSummary").textContent =
    `${allocator.summary} (미배분 ${won(unallocatedKrw)} 남음 — Vault에 그대로 남아 다음 실행 때 다시 검토돼요)`;
  const list = document.getElementById("allocList");
  list.innerHTML = "";
  for (const a of allocator.allocations) {
    const excluded = !a.amountUsdc || a.amountUsdc <= 0;
    const card = document.createElement("div");
    card.className = `alloc-card${excluded ? " excluded" : " funded"}`;
    card.innerHTML = `
      <div>
        <b>${escapeHtml(a.product || a.campaignId)}</b>
        <div class="reason">${escapeHtml(a.reason || "")}</div>
      </div>
      <div style="text-align:right; flex-shrink:0;">
        <div class="amt">${excluded ? "배분 없음" : won(a.amountKrw)}</div>
        ${a.solscanUrl ? `<a href="${a.solscanUrl}" target="_blank" style="font-size:11.5px;">Solscan에서 보기 →</a>` : ""}
      </div>
    `;
    list.appendChild(card);
  }
}

document.getElementById("runBtn").addEventListener("click", async () => {
  const btn = document.getElementById("runBtn");
  if (!currentAdvertiserId) return toast("광고주 계정을 먼저 연결해주세요.");

  btn.disabled = true; // §12 재진입 방지 — 연타/새로고침으로 같은 라운드가 두 번 실행되는 것을 막음
  btn.textContent = "실행 중... (20~40초 정도 걸려요)";
  document.getElementById("logPanel").style.display = "block";
  document.getElementById("resultPanel").style.display = "none";
  document.getElementById("agentLog").innerHTML = "";

  try {
    const data = await api(`/api/advertiser/${currentAdvertiserId}/rebalance-budget`, { method: "POST" });
    await revealSteps(buildSteps(data), document.getElementById("agentLog"));
    renderAllocations(data.allocator);
    document.getElementById("resultPanel").style.display = "block";
    toast("예산 배분이 끝났어요!");
    loadBudgetStatus(currentAdvertiserId);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "지금 실행";
  }
});

linkoRequireAdvertiserSession((id) => loadBudgetStatus(id));
