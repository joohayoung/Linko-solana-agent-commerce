const params = new URLSearchParams(location.search);
const campaignId = params.get("id");

async function load() {
  if (!campaignId) {
    document.getElementById("content").innerHTML = `<div class="empty-state">캠페인 id가 없습니다.</div>`;
    return;
  }
  try {
    const { campaign } = await api(`/api/campaigns/${campaignId}`);
    render(campaign);
  } catch (e) {
    document.getElementById("content").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function render(c) {
  document.title = `픽셀 설치 안내 — ${c.product} — Linko`;
  const crumb = document.getElementById("crumbCampaign");
  crumb.textContent = c.product;
  crumb.href = `/advertiser-campaign-detail.html?id=${c.id}`;

  const storeId = c.advertiserId;
  const storeIdAttr = storeId
    ? `        <span class="cmt">data-store-id=</span><span class="str">"${escapeHtml(storeId)}"</span>\n`
    : `        <span class="cmt">data-store-id=</span><span class="str">"{{ 광고주 계정 id }}"</span>\n`;

  document.getElementById("content").innerHTML = `
    <div class="success-banner">
      <div class="icon">✓</div>
      <div>
        <h1>캠페인이 등록됐어요</h1>
        <p><span class="camp-name">${escapeHtml(c.product)}</span> 캠페인이 활성화됐어요. 스토어에 픽셀만 설치하면 이 캠페인은 물론, 앞으로 만드는 모든 캠페인의 구매가 자동으로 확정·정산돼요.</p>
      </div>
    </div>

    ${!storeId ? `
    <div class="callout" style="background:var(--warn-bg); margin-bottom:22px;">
      <span class="callout-icon">⚠️</span>
      <span>이 캠페인에는 연결된 광고주 계정이 없어서 <span class="mono">data-store-id</span>를 자동으로 채우지 못했어요. 아래 스크립트의 <span class="mono">{{ 광고주 계정 id }}</span> 부분을 직접 채워주시거나, 지원팀에 문의해주세요.</span>
    </div>` : ""}

    <div class="panel">
      <h2>구매 확정 픽셀이란?</h2>
      <p class="panel-sub">크리에이터의 추천 링크로 들어온 방문자가 실제로 결제까지 마쳤는지 저희가 알 수 있도록, 스토어에 붙여넣는 아주 작은 스크립트예요.</p>
      <div class="field-list">
        <div class="field-row"><div class="fname">referralCode</div><div class="fdesc">어떤 크리에이터의 추천 링크를 통해 들어온 구매인지 — 방문 시 자동으로 쿠키에 저장돼서 별도 입력이 필요 없어요</div></div>
        <div class="field-row"><div class="fname">orderId</div><div class="fdesc">쇼핑몰 측 주문번호 — 중복 집계를 막기 위해 사용해요</div></div>
        <div class="field-row"><div class="fname">amount</div><div class="fdesc">결제 금액 — 정산 금액 계산에 사용돼요</div></div>
        <div class="field-row"><div class="fname">storeId</div><div class="fdesc">어느 광고주 스토어에서 보낸 이벤트인지 — 로더 스크립트 태그에서 자동으로 붙어요</div></div>
      </div>
      <div class="callout">
        <span class="callout-icon">🔁</span>
        <span><b>캠페인마다 다시 설치할 필요 없어요.</b> 스토어(광고주 계정) 기준으로 딱 한 번만 설치하면 끝이에요. 어떤 캠페인·어떤 크리에이터의 성과인지는 추천 링크(<span class="mono">referralCode</span>)에 이미 담겨 있어서, 저희가 서버에서 알아서 구분해요.</span>
      </div>
    </div>

    <div class="panel">
      <h2>설치 방법</h2>
      <p class="panel-sub">스크립트 2개를 각각 다른 위치에 붙여넣어요. 개발자에게 이 페이지를 그대로 전달해도 좋아요.</p>
      <div class="steps">
        <div class="step">
          <div class="num">1</div>
          <div class="step-body">
            <h3>로더 스크립트 — 스토어 전체 공통 레이아웃에 1번</h3>
            <p>헤더나 전체 레이아웃 템플릿처럼 <b>모든 페이지에 공통으로 나가는 곳</b>에 넣어주세요. 크리에이터 링크(<span class="mono">?ref=</span>)로 들어온 방문자를 감지해서, 이후 며칠 뒤 결제하더라도 추적할 수 있도록 브라우저에 표시를 남겨두는 역할이에요.</p>
          </div>
        </div>
        <div class="step">
          <div class="num">2</div>
          <div class="step-body">
            <h3>구매 확정 이벤트 — 결제 완료 페이지에 1번</h3>
            <p>주문이 실제로 완료된 뒤 사용자가 보는 "주문이 완료됐습니다" 페이지에서만 호출해주세요. 장바구니·결제 진행 페이지에 넣으면 결제하지 않은 방문도 확정으로 집계될 수 있어요.</p>
          </div>
        </div>
        <div class="step">
          <div class="num">3</div>
          <div class="step-body">
            <h3>저장하고 배포</h3>
            <p>배포가 끝나면 다음 실제 구매 건부터 바로 반영돼요.</p>
          </div>
        </div>
      </div>

      <div class="code-block">
        <div class="code-head">
          <span class="filename">1 · 전체 레이아웃 (header.html 등)</span>
          <button class="copy-btn" id="copyBtn1"><span id="copyIcon1">⧉</span><span id="copyLabel1">복사</span></button>
        </div>
        <pre id="code1"><span class="cmt">&lt;!-- 스토어 전체 공통 레이아웃에 한 번만 --&gt;</span>
<span class="tag">&lt;script</span> <span class="cmt">src=</span><span class="str">"${location.origin}/js/pixel.js"</span>
${storeIdAttr}        <span class="cmt">async</span><span class="tag">&gt;&lt;/script&gt;</span></pre>
      </div>

      <div class="code-block">
        <div class="code-head">
          <span class="filename">2 · 결제 완료 페이지 전용</span>
          <button class="copy-btn" id="copyBtn2"><span id="copyIcon2">⧉</span><span id="copyLabel2">복사</span></button>
        </div>
        <pre id="code2"><span class="tag">&lt;script&gt;</span>
  <span class="cmt">// linko 로더가 아직 로드되기 전이어도 안전하게 쌓아뒀다가 전송돼요</span>
  window.linko = window.linko || <span class="tag">function</span>() {
    (window.linko.q = window.linko.q || []).push(arguments);
  };
  linko(<span class="str">"trackPurchase"</span>, {
    orderId: <span class="str">"{{ 실제 주문번호 }}"</span>,
    amount: <span class="str">{{ 실제 결제금액 }}</span>
  });
<span class="tag">&lt;/script&gt;</span></pre>
      </div>
    </div>

    <div class="panel" style="margin-bottom:0;">
      <h2>참고 — 추천 링크 형식</h2>
      <p class="panel-sub">크리에이터가 캠페인에 참여하면 아래 형식의 고유 링크가 자동으로 발급돼요. 방문자가 이 링크를 거쳐야 픽셀이 어떤 캠페인·크리에이터의 성과인지 구분할 수 있어요.</p>
      <div class="link-box">
        <span class="url">${location.origin}/go/{추천코드}</span>
      </div>
    </div>

    <div class="bottom-actions">
      <button class="pill-btn" id="goBackBtn">확인했어요 — 대시보드로 이동</button>
      <p class="fineprint">픽셀 설치를 완료해야 구매 확정과 정산이 자동으로 진행돼요.</p>
    </div>
  `;

  wireCopy("copyBtn1", "copyIcon1", "copyLabel1", "code1");
  wireCopy("copyBtn2", "copyIcon2", "copyLabel2", "code2");
  document.getElementById("goBackBtn").addEventListener("click", () => {
    location.href = `/advertiser-campaign-detail.html?id=${c.id}`;
  });
}

function wireCopy(btnId, iconId, labelId, codeId) {
  document.getElementById(btnId).addEventListener("click", () => {
    const label = document.getElementById(labelId);
    const icon = document.getElementById(iconId);
    const btn = document.getElementById(btnId);
    const code = document.getElementById(codeId);
    if (navigator.clipboard && code) {
      navigator.clipboard.writeText(code.innerText).catch(() => {});
    }
    btn.classList.add("copied");
    icon.textContent = "✓";
    label.textContent = "복사됨";
    setTimeout(() => {
      btn.classList.remove("copied");
      icon.textContent = "⧉";
      label.textContent = "복사";
    }, 1500);
  });
}

load();
