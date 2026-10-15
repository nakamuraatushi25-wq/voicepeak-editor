import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdate, type Release } from "../lib/update";

/**
 * 起動時に新しい版を探し、あればツールバーにボタンを出す。
 * 押すとブラウザでインストーラーをダウンロードするので、それを実行すれば上書きで更新される。
 */
export function UpdateBanner() {
  const [release, setRelease] = useState<Release | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    // オフラインなどで確認できないときは何も出さない
    getVersion()
      .then(checkForUpdate)
      .then(setRelease, () => undefined);
  }, []);

  if (!release) return null;
  if (opened) {
    return <span className="update">ダウンロードしたインストーラーを実行すると更新されます</span>;
  }
  return (
    <button
      className="update"
      title={release.notes}
      onClick={() => openUrl(release.downloadUrl).then(() => setOpened(true), () => undefined)}
    >
      ⬆ 新しい版 {release.version} があります
    </button>
  );
}
