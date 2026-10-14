import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri が使う固定ポートで起動する
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", outDir: "dist" },
});
