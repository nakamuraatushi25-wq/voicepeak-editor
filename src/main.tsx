import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import type { Project } from "./types";
import "./styles.css";

async function start() {
  let initial: Project | undefined;
  // 体験版（ブラウザで動かすとき）は Tauri の代わりを先に入れておく
  if (import.meta.env.VITE_DEMO) {
    const demo = await import("./demo/mock");
    initial = demo.demoProject();
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App initialProject={initial} demo={!!initial} />
    </React.StrictMode>,
  );
}

start();
