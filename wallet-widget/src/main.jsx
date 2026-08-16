import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { LazorkitProvider, useWallet } from "@lazorkit/wallet";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";

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
const PORTAL_URL = "https://portal.lazor.sh";
// @lazorkit/wallet 2.0.1의 LazorkitProvider가 paymasterConfig prop을 안 넘기면
// 기본 파라미터로 매 렌더마다 새 객체({ paymasterUrl: ... })를 만들어서, 그걸 그대로
// useEffect 의존성 배열에 넣는 바람에 무한 렌더 루프(Maximum update depth exceeded)가 남.
// 그래서 여기서 모듈 스코프의 "고정 참조" 객체를 만들어 명시적으로 넘겨서 우회한다.
//
// paymasterUrl: LazorKit이 공개해둔 두 공용 테스트 paymaster(onrender.com은 CORS로 우리 origin을
// 막고, kora.devnet.lazorkit.com은 우리가 쓰는 프로그램 버전을 allow-list에 안 올려둠)가 둘 다 막혀있어서,
// 우리 서버(server.mjs, /paymaster)에 platform 지갑을 fee payer로 쓰는 미니 paymaster를 직접 구현해
// 자체 호스팅함. 같은 오리진이라 CORS 문제 자체가 없고, 우리가 원래 세운 설계("가스비는 플랫폼이 대납")와도 일치.
const PAYMASTER_CONFIG = { paymasterUrl: `${window.location.origin}/paymaster` };

// 서명해서 보낼 인스트럭션에 쓰이는 주소 룩업 테이블(ALT)을 조회하기 위한 읽기 전용 커넥션.
// (서명·전송 자체는 LazorKit의 paymaster 경유로 이뤄지고, 여긴 그냥 ALT 계정 정보만 읽어옴)
const readConnection = new Connection(RPC_URL, "confirmed");
const altAccountCache = new Map();
async function resolveAddressLookupTableAccounts(altAddresses = []) {
  const results = await Promise.all(
    altAddresses.map(async (addr) => {
      if (altAccountCache.has(addr)) return altAccountCache.get(addr);
      const { value } = await readConnection.getAddressLookupTable(new PublicKey(addr));
      if (value) altAccountCache.set(addr, value);
      return value;
    })
  );
  return results.filter(Boolean);
}

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
  const { connect, disconnect, isConnected, isConnecting, wallet, error, signAndSendTransaction } = useWallet();

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
    // 서버가 조립해준 인스트럭션(JSON 직렬화된 형태)을 진짜 TransactionInstruction으로 복원해서
    // 이 지갑(패스키 스마트월렛)으로 직접 서명·전송함. altAddresses가 있으면 주소 룩업 테이블을
    // 같이 실어서 트랜잭션 크기를 줄인다(LazorKit CPI 서명 래핑 오버헤드가 커서, ALT 없이는
    // 인스트럭션 하나만으로도 Solana 트랜잭션 크기 한도를 넘기는 경우가 많음).
    window.LinkoWallet.signAndSendTransaction = async (serializedInstructions, altAddresses = []) => {
      const instructions = serializedInstructions.map(
        (ix) =>
          new TransactionInstruction({
            programId: new PublicKey(ix.programId),
            keys: ix.keys.map((k) => ({
              pubkey: new PublicKey(k.pubkey),
              isSigner: k.isSigner,
              isWritable: k.isWritable,
            })),
            data: Buffer.from(ix.data, "base64"),
          })
      );
      const addressLookupTableAccounts = await resolveAddressLookupTableAccounts(altAddresses);
      return await signAndSendTransaction({
        instructions,
        transactionOptions: addressLookupTableAccounts.length > 0 ? { addressLookupTableAccounts } : undefined,
      });
    };
  }, [connect, disconnect, signAndSendTransaction]);

  // 선언적 슬롯: [data-linko-connect] 요소를 찾아 연결 버튼/칩을 이식
  // 페이지 쪽(wallet-session.js 등)이 배너를 "런타임에 동적으로" DOM에 추가하는 경우가 많아서
  // 마운트 시 1회 스캔에 더해, window.LinkoWallet.registerConnectSlot(el)로 명시적으로도 등록 가능하게 함
  // (MutationObserver는 포탈 자체가 만드는 DOM 변경까지 다시 감지해서 무한 렌더 루프를 유발하므로 사용하지 않음)
  const [slots, setSlots] = useState(() => Array.from(document.querySelectorAll("[data-linko-connect]")));
  useEffect(() => {
    window.LinkoWallet.registerConnectSlot = (el) => {
      if (!el) return;
      setSlots((prev) => (prev.includes(el) ? prev : [...prev, el]));
    };
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
  window.LinkoWallet.signAndSendTransaction =
    window.LinkoWallet.signAndSendTransaction ||
    (() => Promise.reject(new Error("지갑 위젯이 아직 준비되지 않았어요.")));
  // Bridge가 아직 실제 구현을 등록하기 전(첫 렌더 이전)에 페이지 쪽에서 먼저 호출하는 경우를 대비
  window.LinkoWallet.registerConnectSlot =
    window.LinkoWallet.registerConnectSlot ||
    ((el) => setTimeout(() => window.LinkoWallet.registerConnectSlot?.(el), 30));

  let host = document.getElementById("__linko_wallet_root");
  if (!host) {
    host = document.createElement("div");
    host.id = "__linko_wallet_root";
    document.body.appendChild(host);
  }

  createRoot(host).render(
    <LazorkitProvider rpcUrl={RPC_URL} portalUrl={PORTAL_URL} paymasterConfig={PAYMASTER_CONFIG}>
      <Bridge />
    </LazorkitProvider>
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
