import type { Bgm, Character, Movie, VideoSettings } from "../types";
import { slideBox, type Model } from "./scene";

/**
 * AviUtl 拡張編集のオブジェクトファイル（.exo）を作る。下から順に
 *   背景動画・その音声 → 画像（スライド） → キャラごとの立ち絵 → キャラごとの声
 *   → キャラごとの字幕 → 見出し → BGM
 * のレイヤーに置く。使わないものはレイヤーを詰める。
 * 書き出し時は Shift_JIS・CRLF に変換すること（Rust 側で行う）。
 */
export function buildExo(
  model: Model,
  characters: Character[],
  video: VideoSettings,
  movie?: Movie,
  bgm?: Bgm,
): string {
  const toFrame = (sec: number) => Math.round(sec * video.fps);
  const total = model.total;
  const length = Math.max(1, toFrame(total));
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
  let nextLayer = 1;
  const takeLayer = () => nextLayer++;
  /** 置けたら true。1 フレームに満たないものは置かない */
  const header = (startSec: number, endSec: number, layer: number, audio = false) => {
    const start = toFrame(startSec) + 1;
    const end = toFrame(endSec);
    if (end < start) return false;
    out.push(`[${obj}]`, `start=${start}`, `end=${end}`, `layer=${layer}`, "overlay=1", audio ? "audio=1" : "camera=0");
    return true;
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
  const sound = (file: string, startSec: number, endSec: number, layer: number, position: number, volume: number, loop = false, linked = false) => {
    if (!header(startSec, endSec, layer, true)) return;
    out.push(
      `[${obj}.0]`,
      "_name=音声ファイル",
      `再生位置=${position.toFixed(2)}`,
      "再生速度=100.0",
      `ループ再生=${loop ? 1 : 0}`,
      `動画ファイルと連携=${linked ? 1 : 0}`,
      `file=${file}`,
      `[${obj}.1]`,
      "_name=標準再生",
      `音量=${volume.toFixed(1)}`,
      "左右=0.0",
    );
    obj++;
  };
  const text = (body: string, startSec: number, endSec: number, layer: number, opts: { size: number; color: string; align: number; y: number }) => {
    if (!header(startSec, endSec, layer)) return;
    out.push(
      `[${obj}.0]`,
      "_name=テキスト",
      `サイズ=${opts.size}`,
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
      `align=${opts.align}`,
      "spacing_x=0",
      "spacing_y=0",
      "precision=1",
      `color=${opts.color.replace("#", "").toLowerCase()}`,
      "color2=000000",
      `font=${video.font}`,
      `text=${encodeExoText(body.replace(/\n/g, "\r\n"))}`,
    );
    draw(0, opts.y, 100);
    obj++;
  };

  // 背景動画。章だけ書き出すときは、その章の場面から再生する
  if (movie) {
    const videoLayer = takeLayer();
    const audioLayer = takeLayer();
    const end = Math.min(total, movie.duration - model.offset);
    if (header(0, end, videoLayer)) {
      const zoom = Math.min(video.width / movie.width, video.height / movie.height) * 100;
      out.push(
        `[${obj}.0]`,
        "_name=動画ファイル",
        `再生位置=${toFrame(model.offset) + 1}`,
        "再生速度=100.0",
        "ループ再生=0",
        "アルファチャンネルを読み込む=0",
        `file=${movie.path}`,
      );
      draw(0, 0, zoom);
      obj++;
      sound(movie.path, 0, end, audioLayer, model.offset, movie.volume, false, true);
    }
  }

  // 画像（スライド）。座標は画面中央が原点
  if (model.slides.length) {
    const layer = takeLayer();
    for (const s of model.slides) {
      if (!header(s.start, s.end, layer)) continue;
      const box = slideBox(s.value, video.width, video.height);
      out.push(`[${obj}.0]`, "_name=画像ファイル", `file=${s.value.path}`);
      draw(0, box.top + box.h / 2 - video.height / 2, box.zoom * 100);
      obj++;
    }
  }

  // 立ち絵。表情と口の形ごとのコマを 1 つのレイヤーにすき間なく並べる
  for (const c of characters) {
    const frames = model.frames.get(c.id);
    if (!c.portrait || !frames?.length) continue;
    const layer = takeLayer();
    const p = c.portrait;
    // 下端を画面の下端にそろえる
    const x = (p.x - 0.5) * video.width;
    const y = video.height / 2 - (p.height * p.scale) / 100 / 2;
    for (const f of frames) {
      if (!header(f.start, f.end, layer)) continue;
      out.push(`[${obj}.0]`, "_name=画像ファイル", `file=${f.value}`);
      draw(x, y, p.scale);
      obj++;
    }
  }

  const voiceLayers = new Map(characters.map((c) => [c.id, 0]));
  for (const c of characters) if (model.placed.some((p) => p.character.id === c.id && p.line.audio)) voiceLayers.set(c.id, takeLayer());
  for (const p of model.placed) {
    if (p.line.audio) sound(p.line.audio.path, p.start, p.end, voiceLayers.get(p.character.id)!, 0, 100);
  }

  const subtitleLayers = new Map(characters.map((c) => [c.id, 0]));
  for (const c of characters) if (model.cues.some((q) => q.character.id === c.id)) subtitleLayers.set(c.id, takeLayer());
  for (const cue of model.cues) {
    text(cue.text, cue.start, cue.end, subtitleLayers.get(cue.character.id)!, {
      size: video.fontSize,
      color: cue.character.color,
      align: 7,
      y: video.height * 0.38,
    });
  }

  // 見出しは画面の上に、字幕より少し小さく
  if (model.titles.length) {
    const layer = takeLayer();
    for (const t of model.titles) {
      text(t.value, t.start, t.end, layer, { size: Math.round(video.fontSize * 0.8), color: "#ffffff", align: 1, y: -video.height * 0.45 });
    }
  }

  // BGM。セリフの間だけ音量を下げた区切りに分けて並べる
  if (bgm) {
    const layer = takeLayer();
    for (const [start, end, speaking] of bgmSegments(model.speech, total)) {
      const position = bgm.duration > 0 ? (model.offset + start) % bgm.duration : 0;
      sound(bgm.path, start, end, layer, position, speaking ? (bgm.volume * bgm.duck) / 100 : bgm.volume, true);
    }
  }
  return out.join("\n") + "\n";
}

/** 0〜total を「話している区間」と「そうでない区間」に分ける */
export function bgmSegments(speech: [number, number][], total: number): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  let t = 0;
  for (const [s, e] of speech) {
    if (s > t) out.push([t, s, false]);
    out.push([Math.max(s, t), Math.min(e, total), true]);
    t = Math.min(e, total);
  }
  if (t < total) out.push([t, total, false]);
  return out.filter(([s, e]) => e > s);
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
