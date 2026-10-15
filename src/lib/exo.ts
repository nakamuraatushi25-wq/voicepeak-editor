import type { Character, PlacedLine, VideoSettings } from "../types";
import type { Cue } from "./subtitle";
import { mouthSegments } from "./mouth";

/**
 * AviUtl 拡張編集のオブジェクトファイル（.exo）を作る。
 * キャラ数を n、キャラの番号を i（0 始まり）として、下から
 *   立ち絵（口閉じ）: 2i+1 / 口パク: 2i+2 / 音声: 2n+i+1 / 字幕: 3n+i+1
 * の順に重ねる。書き出し時は Shift_JIS・CRLF に変換すること（Rust 側で行う）。
 */
export function buildExo(placed: PlacedLine[], cues: Cue[], characters: Character[], video: VideoSettings): string {
  const toFrame = (sec: number) => Math.round(sec * video.fps);
  const total = placed.reduce((m, p) => Math.max(m, p.end), 0);
  const length = Math.max(1, toFrame(total));
  const n = characters.length;
  const index = new Map(characters.map((c, i) => [c.id, i]));
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

  let obj = 0;
  const header = (startSec: number, endSec: number, layer: number, audio = false) => {
    const start = toFrame(startSec) + 1;
    const end = Math.max(start, toFrame(endSec));
    out.push(`[${obj}]`, `start=${start}`, `end=${end}`, `layer=${layer}`, "overlay=1", audio ? "audio=1" : "camera=0");
  };
  const draw = (x: number, y: number, zoom: number) =>
    out.push(
      `[${obj}.1]`,
      "_name=標準描画",
      `X=${x.toFixed(1)}`,
      `Y=${y.toFixed(1)}`,
      "Z=0.0",
      `拡大率=${zoom.toFixed(2)}`,
      "透明度=0.0",
      "回転=0.00",
      "blend=0",
    );
  const image = (file: string, startSec: number, endSec: number, layer: number, c: Character) => {
    const p = c.portrait!;
    header(startSec, endSec, layer);
    out.push(`[${obj}.0]`, "_name=画像ファイル", `file=${file}`);
    // 座標は画面中央が原点。画像の下端を画面の下端にそろえる
    const x = (p.x - 0.5) * video.width;
    const y = video.height / 2 - (p.height * p.scale) / 100 / 2;
    draw(x, y, p.scale);
    obj++;
  };

  characters.forEach((c, i) => {
    if (!c.portrait || total <= 0) return;
    image(c.portrait.closed, 0, total, 2 * i + 1, c);
    for (const [start, end, level] of mouthSegments(placed, c)) {
      if (toFrame(end) <= toFrame(start)) continue;
      const file = level === 1 ? (c.portrait.half ?? c.portrait.open) : c.portrait.open;
      image(file, start, end, 2 * i + 2, c);
    }
  });

  for (const p of placed) {
    if (!p.line.audio) continue;
    header(p.start, p.end, 2 * n + index.get(p.character.id)! + 1, true);
    out.push(
      `[${obj}.0]`,
      "_name=音声ファイル",
      "再生位置=0.00",
      "再生速度=100.0",
      "ループ再生=0",
      "動画ファイルと連携=0",
      `file=${p.line.audio.path}`,
      `[${obj}.1]`,
      "_name=標準再生",
      "音量=100.0",
      "左右=0.0",
    );
    obj++;
  }

  for (const cue of cues) {
    header(cue.start, cue.end, 3 * n + index.get(cue.character.id)! + 1);
    out.push(
      `[${obj}.0]`,
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
      `color=${cue.character.color.replace("#", "").toLowerCase()}`,
      "color2=000000",
      `font=${video.font}`,
      `text=${encodeExoText(cue.text.replace(/\n/g, "\r\n"))}`,
    );
    draw(0, video.height * 0.38, 100);
    obj++;
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
