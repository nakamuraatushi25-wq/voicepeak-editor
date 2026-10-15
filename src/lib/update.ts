/** 最新の Release を置いている GitHub のリポジトリ */
export const RELEASES_API = "https://api.github.com/repos/nakamuraatushi25-wq/voicepeak-editor/releases/latest";

export interface Release {
  version: string;
  /** インストーラーの直接ダウンロード URL（なければ Release のページ） */
  downloadUrl: string;
  notes: string;
}

/** "v1.2.10" と "1.2.9" のような版番号を比べる。a が新しければ正 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body?: string | null;
  assets: { name: string; browser_download_url: string }[];
}

/** GitHub の応答から、今の版より新しい Release だけを取り出す */
export function pickUpdate(release: GitHubRelease, current: string): Release | null {
  if (compareVersions(release.tag_name, current) <= 0) return null;
  const installer = release.assets.find((a) => /setup\.exe$/i.test(a.name));
  return {
    version: release.tag_name.replace(/^v/, ""),
    downloadUrl: installer?.browser_download_url ?? release.html_url,
    notes: release.body ?? "",
  };
}

export async function checkForUpdate(current: string): Promise<Release | null> {
  const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  return pickUpdate((await res.json()) as GitHubRelease, current);
}
