import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// 순수 HTML/JS 페이지(public/*.html)에 <script> 한 줄로 넣을 수 있는
// 자체 완결형(iife) 번들을 만듭니다. 결과물은 ../public/js/wallet-widget.js.
export default defineConfig({
  plugins: [react(), nodePolyfills({ globals: { Buffer: true } })],
  build: {
    outDir: "../public/js",
    emptyOutDir: false,
    lib: {
      entry: "src/main.jsx",
      name: "LinkoWalletLib",
      formats: ["iife"],
      fileName: () => "wallet-widget.js",
    },
    rollupOptions: {
      output: {
        // 위젯 코드가 자체적으로 window.LinkoWallet 을 등록하므로
        // lib 모드의 export 값(LinkoWalletLib)은 실사용하지 않습니다.
        extend: true,
      },
    },
  },
});
