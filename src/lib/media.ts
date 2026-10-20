import { convertFileSrc } from "@tauri-apps/api/core";

/** 動画の長さと大きさをブラウザに読ませて調べる */
export function videoInfo(path: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (!Number.isFinite(v.duration) || !v.videoWidth) {
        reject(new Error("動画の長さか大きさがわかりませんでした"));
        return;
      }
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => reject(new Error("この動画は読み込めません。H.264 の MP4 に変換してから試してください"));
    v.src = convertFileSrc(path);
  });
}

/** 音声ファイルの長さ（秒）をブラウザに読ませて調べる */
export function audioInfo(path: string): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.onloadedmetadata = () =>
      Number.isFinite(a.duration) ? resolve({ duration: a.duration }) : reject(new Error("音声の長さがわかりませんでした"));
    a.onerror = () => reject(new Error("この音声は読み込めません。MP3 か WAV を試してください"));
    a.src = convertFileSrc(path);
  });
}

/** 表示用のファイル名。体験版のファイルは blob:…#名前 の形 */
export function fileName(path: string): string {
  if (path.startsWith("blob:")) return decodeURIComponent(path.split("#").pop() ?? path);
  return path.split(/[\\/]/).pop() ?? path;
}
