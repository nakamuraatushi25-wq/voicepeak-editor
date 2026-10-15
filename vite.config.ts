import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri が使う固定ポートで起動する。
// `--mode demo` はブラウザで動く体験版を dist-demo に 1 つの JS としてまとめる
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  base: mode === "demo" ? "./" : "/",
  build: {
    target: "es2021",
    outDir: mode === "demo" ? "dist-demo" : "dist",
    rollupOptions: mode === "demo" ? { output: { inlineDynamicImports: true } } : {},
  },
}));
