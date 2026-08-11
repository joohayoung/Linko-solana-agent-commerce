import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { LazorkitProvider, useWallet } from "@lazorkit/wallet";

/**
 * Linko 패스키/가스리스 지갑 위젯 (LazorKit 기반)
 *
 * 메인 앱(public/*.html)은 번들러 없는 순수 HTML/JS라서, 이 위젯만 별도로
 * Vite+React로 빌드해 IIFE 번들(public/js/wallet-widget.js)로 내보냅니다.
 * 페이지 쪽에서는 React를 몰라도 되고, 아래 두 가지 방식으로만 붙습니다.
 *
 * 1) 선언적: HTML에 <span data-linko-connect></span> 를 두면 연결 버튼/칩이 자동 삽입됨
 * 2) 명령형: window.LinkoWallet.connect() / .getState() / .subscribe(cb) 로 제어
 *
 * 지갑 생성은 회원가입 시 지문/얼굴인식 1회만 요구하고(LazorKit portal이 처리),
 * 이후 재방문 시 connect()는 캐시된 패스키 크레덴셜로 조용히 재연결을 시도합니다.
 */

const RPC_URL = window.__LINKO_RPC_URL__ || "https://api.devnet.solana.com";

// ---------- 외부(순수 JS)에서 구독 가능한 아주 단순한 pub-sub ----------
const listeners = new Set();
let lastState = { isConnected: false, isConnecting: false, walletAddress: null, error: null };

function short(addr) {
  return addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "";
}

function publish(next) {
  lastState = next;
  window.LinkoWallet.state = next;
  listeners.forEach((cb) => {
    try {
      cb(next);
    } catch (e) {
      console.error("[LinkoWallet] subscriber error", e);
    }
  });
}

function Bridge() {
  const { connect, disconnect, isConnected, isConnecting, wallet, error } = useWallet();

  // 상태 변화를 window.LinkoWallet 구독자들에게 전파
  useEffect(() => {
    const vault = wallet?.vaultPda || wallet?.smartWallet || null;
    publish({
      isConnected,
      isConnecting,
      walletAddress: vault,
      error: error ? String(error.message || error) : null,
    });
  }, [isConnected, isConnecting, wallet, error]);

  // 명령형 API 연결 — 다른 슬롯/외부 코드가 window.LinkoWallet.connect() 로 트리거 가능
  useEffect(() => {
    window.LinkoWallet.connect = async () => {
      const w = await connect({ feeMode: "paymaster" });
      return w?.vaultPda || w?.smartWallet || null;
    };
    window.LinkoWallet.disconnect = async () => {
      await disconnect();
    };
  }, [connect, disconnect]);

  // 선언적 슬롯: [data-linko-connect] 요소를 찾아 연결 버튼/칩을 이식
  const [slots, setSlots] = useState([]);
  useEffect(() => {
    setSlots(Array.from(document.querySelectorAll("[data-linko-connect]")));
  }, []);

  return (
    <>
      {slots.map((el, i) => {
        const vault = wallet?.vaultPda || wallet?.smartWallet;
        const node =
          isConnected && vault ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="mono" title={vault}>
                🔑 {short(vault)}
              </span>
              <button type="button" className="pill-btn ghost" onClick={() => disconnect()}>
                연결 해제
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="pill-btn"
              disabled={isConnecting}
              onClick={() => window.LinkoWallet.connect().catch((e) => console.error("[LinkoWallet] connect 실패", e))}
            >
              {isConnecting ? "연결 중..." : "패스키로 지갑 연결"}
            </button>
          );
        return createPortal(node, el, i);
      })}
    </>
  );
}

function mount() {
  // 위젯이 로드되기 전에 다른 스크립트가 먼저 호출하는 경우를 대비한 안전한 기본값
  window.LinkoWallet = window.LinkoWallet || {};
  window.LinkoWallet.state = lastState;
  window.LinkoWallet.getState = () => lastState;
  window.LinkoWallet.subscribe = (cb) => {
    listeners.add(cb);
    cb(lastState);
    return () => listeners.delete(cb);
  };
  window.LinkoWallet.connect =
    window.LinkoWallet.connect || (() => Promise.reject(new Error("지갑 위젯이 아직 준비되지 않았어요.")));
  window.LinkoWallet.disconnect = window.LinkoWallet.disconnect || (() => Promise.resolve());

  let host = document.getElementById("__linko_wallet_root");
  if (!host) {
    host = document.createElement("div");
    host.id = "__linko_wallet_root";
    document.body.appendChild(host);
  }

  createRoot(host).render(
    <LazorkitProvider rpcUrl={RPC_URL}>
      <Bridge />
    </LazorkitProvider>
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
