import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type State =
  | { kind: "idle" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number | null }
  | { kind: "error"; message: string };

/** 起動時に新しい版を探し、あればツールバーに「更新する」ボタンを出す */
export function UpdateBanner({ hasUnsaved }: { hasUnsaved: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    // 配布ページに届かないとき（オフライン・非公開など）は何も出さない
    check().then((u) => u && setState({ kind: "available", update: u }), () => undefined);
  }, []);

  const install = async (update: Update) => {
    if (hasUnsaved && !confirm("保存していない変更は消えます。更新しますか？")) return;
    let total = 0;
    let done = 0;
    setState({ kind: "downloading", percent: null });
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "downloading", percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  switch (state.kind) {
    case "idle":
      return null;
    case "available":
      return (
        <button className="update" onClick={() => install(state.update)} title={state.update.body ?? ""}>
          ⬆ 新しい版 {state.update.version} に更新
        </button>
      );
    case "downloading":
      return <span className="update">更新中… {state.percent !== null ? `${state.percent}%` : ""}</span>;
    case "error":
      return (
        <span className="update error" title={state.message}>
          更新に失敗しました
        </span>
      );
  }
}
