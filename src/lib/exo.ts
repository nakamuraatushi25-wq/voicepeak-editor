import type { PlacedLine, VideoSettings } from "../types";

/**
 * AviUtl 拡張編集のオブジェクトファイル（.exo）を作る。
 * キャラ i の音声をレイヤー 2i+1、字幕をレイヤー 2i+2 に置く。
 * 書き出し時は Shift_JIS・CRLF に変換すること（Rust 側で行う）。
 */
export function buildExo(placed: PlacedLine[], video: VideoSettings): string {
  const toFrame = (sec: number) => Math.round(sec * video.fps);
  const length = Math.max(1, toFrame(placed.reduce((m, p) => Math.max(m, p.end), 0)));
  const out: string[] = [
    "[exedit]",
    `width=${video.width}`,
    `height=${video.height}`,
    `rate=${video.fps}`,
    "scale=1",
    `length=${length}`,
    "audio_rate=48000",
    "audio_ch=2",
  ];

  let n = 0;
  for (const p of placed) {
    const start = toFrame(p.start) + 1;
    const end = Math.max(start, toFrame(p.end));
    if (p.line.audio) {
      out.push(
        `[${n}]`,
        `start=${start}`,
        `end=${end}`,
        `layer=${p.layer * 2 + 1}`,
        "overlay=1",
        "audio=1",
        `[${n}.0]`,
        "_name=音声ファイル",
        "再生位置=0.00",
        "再生速度=100.0",
        "ループ再生=0",
        "動画ファイルと連携=0",
        `file=${p.line.audio.path}`,
        `[${n}.1]`,
        "_name=標準再生",
        "音量=100.0",
        "左右=0.0",
      );
      n++;
    }
    out.push(
      `[${n}]`,
      `start=${start}`,
      `end=${end}`,
      `layer=${p.layer * 2 + 2}`,
      "overlay=1",
      "camera=0",
      `[${n}.0]`,
      "_name=テキスト",
      `サイズ=${video.fontSize}`,
      "表示速度=0.0",
      "文字毎に個別オブジェクト=0",
      "移動座標上に表示する=0",
      "自動スクロール=0",
      "B=0",
      "I=0",
      "type=1",
      "autoadjust=0",
      "soft=1",
      "monospace=0",
      "align=7",
      "spacing_x=0",
      "spacing_y=0",
      "precision=1",
      `color=${p.character.color.replace("#", "").toLowerCase()}`,
      "color2=000000",
      `font=${video.font}`,
      `text=${encodeExoText(p.line.text)}`,
      `[${n}.1]`,
      "_name=標準描画",
      "X=0.0",
      `Y=${Math.round(video.height * 0.38)}.0`,
      "Z=0.0",
      "拡大率=100.00",
      "透明度=0.0",
      "回転=0.00",
      "blend=0",
    );
    n++;
  }
  return out.join("\n") + "\n";
}

/** テキストは UTF-16LE の 16 進表記を 4096 桁まで 0 埋めする */
export function encodeExoText(text: string): string {
  let hex = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    hex += (c & 0xff).toString(16).padStart(2, "0") + (c >> 8).toString(16).padStart(2, "0");
  }
  return hex.slice(0, 4096).padEnd(4096, "0");
}
