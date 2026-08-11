# wallet-widget

메인 앱(`public/*.html`)은 번들러 없는 순수 HTML/JS 구조라, LazorKit React SDK(`@lazorkit/wallet`)를
그대로 쓸 수 없습니다 (React 18 + 번들러 필수). 그래서 이 폴더만 별도의 Vite+React 미니 프로젝트로
빌드해서 `../public/js/wallet-widget.js` (IIFE, 자체 완결형 번들)로 내보내고, 각 페이지에서는
`<script src="/js/wallet-widget.js"></script>` 한 줄만 추가해서 씁니다.

## 사용법 (페이지 쪽, 순수 JS)

```html
<!-- 연결 버튼을 자동으로 그려주는 슬롯 -->
<span data-linko-connect></span>

<script src="/js/wallet-widget.js"></script>
<script>
  // 현재 상태
  const { isConnected, walletAddress } = window.LinkoWallet.getState();

  // 상태 변화 구독
  window.LinkoWallet.subscribe((state) => {
    console.log(state.isConnected, state.walletAddress);
  });

  // 코드에서 직접 연결 트리거 (버튼 클릭 핸들러 안에서 호출 권장 — 패스키 프롬프트가 뜸)
  const address = await window.LinkoWallet.connect();
</script>
```

## 빌드

```bash
npm install
npm run build
```

**주의(Cowork 샌드박스 한정)**: 이 프로젝트가 네트워크로 마운트된 폴더(Windows 실제 폴더가
가상 파일시스템으로 마운트된 상태) 안에 있으면 esbuild 네이티브 바이너리 실행이 `Bus error`로
죽습니다. 사용자의 실제 PC에서 로컬 디스크로 직접 여는 경우(VS Code 등)에는 이 문제가 없습니다.
Cowork 세션 안에서 다시 빌드해야 한다면, 이 폴더를 로컬 임시 경로(예: `/tmp`)로 복사해서
`npm install && npm run build` 실행 후 `dist/wallet-widget.js` 를 `../public/js/`로 복사하세요.

## 설정

- 기본 RPC: LazorKit zero-config 기본값(devnet, `portal.lazor.sh`, 퍼블릭 Kora paymaster).
  다른 RPC를 쓰려면 페이지에서 위젯 스크립트 로드 **전에** `window.__LINKO_RPC_URL__ = "..."` 지정.
- `connect({ feeMode: 'paymaster' })` 고정 — 가스비는 항상 paymaster가 대납(Gasless 요구사항).
