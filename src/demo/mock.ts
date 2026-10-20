/**
 * ブラウザで動かす体験版のための、Tauri 側の機能の代わり。
 * VOICEPEAK の代わりに仮の声（ブザー音）を作り、ファイル選択はブラウザのものを使う。
 */
import type { Character, Project } from "../types";
import { emptyProject, newLine } from "../lib/project";
import { MOUTH_FPS } from "../lib/mouth";

const NARRATORS = ["Japanese Female 1", "Japanese Male 1", "Japanese Female Child"];
const EMOTIONS = ["happy", "fun", "angry", "sad"];
const RATE = 22050;

// ---- 仮の声 ----

const PUNCT = /[、。，．,.！？!?…\s]/;
const SMALL = /[ゃゅょャュョぁぃぅぇぉァィゥェォ]/;

interface SynthReq {
  chunks: string[];
  narrator: string;
  emotions: [string, number][];
  speed: number;
  pitch: number;
}

/** 文字ごとに音節を鳴らした WAV を作り、口パクデータと一緒に返す */
function synthesize(req: SynthReq) {
  const text = req.chunks.join("");
  const emo = Object.fromEntries(req.emotions);
  const base =
    (/Child/.test(req.narrator) ? 300 : /Male/.test(req.narrator) ? 120 : 220) *
    2 ** (req.pitch / 1200) *
    (1 + ((emo.happy ?? 0) + (emo.fun ?? 0)) / 400 - (emo.sad ?? 0) / 600);
  const syl = 0.11 * (100 / req.speed);

  // 音節の並び（文字, 長さ, 声を出すか）
  const units: { dur: number; voiced: boolean }[] = [];
  for (const ch of text) {
    if (PUNCT.test(ch)) units.push({ dur: /[、,，\s]/.test(ch) ? 0.18 : 0.3, voiced: false });
    else if (SMALL.test(ch)) continue;
    else units.push({ dur: /[ーっッ]/.test(ch) ? syl * 0.7 : syl, voiced: !/[っッ]/.test(ch) });
  }
  while (units.length && !units[units.length - 1].voiced) units.pop();
  const duration = Math.max(0.3, units.reduce((s, u) => s + u.dur, 0) + 0.1);

  const n = Math.ceil(duration * RATE);
  const pcm = new Float32Array(n);
  let t0 = 0;
  let phase = 0;
  units.forEach((u, k) => {
    const start = Math.floor(t0 * RATE);
    const len = Math.floor(u.dur * RATE);
    t0 += u.dur;
    if (!u.voiced) return;
    // 文の終わりに向かって少し下がる抑揚
    const f = base * (1.08 - 0.16 * (k / units.length)) * (1 + 0.04 * Math.sin(k * 1.7));
    const formant = 2 + ((k * 7) % 5);
    for (let i = 0; i < len && start + i < n; i++) {
      const x = i / len;
      const env = Math.sin(Math.PI * Math.min(1, x * 1.25)) ** 0.6;
      phase += (2 * Math.PI * f) / RATE;
      let s = 0;
      for (let h = 1; h <= 6; h++) s += Math.sin(phase * h) / (1 + Math.abs(h - formant));
      pcm[start + i] = s * env * 0.18;
    }
  });

  // 口パク：フレームごとの音量から 0/1/2 を決める
  const per = RATE / MOUTH_FPS;
  const rms: number[] = [];
  for (let i = 0; i < n; i += per) {
    let sum = 0;
    const end = Math.min(n, i + per);
    for (let j = Math.floor(i); j < end; j++) sum += pcm[j] * pcm[j];
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  const peak = Math.max(...rms, 1e-6);
  const mouth = rms.map((r) => (r > peak * 0.55 ? "2" : r > peak * 0.2 ? "1" : "0")).join("");

  return { path: wavUrl(pcm), duration, mouth };
}

function wavUrl(pcm: Float32Array) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// ---- 見本の立ち絵 ----

const PORTRAIT_W = 400;
const PORTRAIT_H = 640;

/** 口の形だけ違う 3 枚の SVG 立ち絵 */
function portraitSvg(hair: string, outfit: string, mouth: 0 | 1 | 2, long: boolean) {
  const m =
    mouth === 0
      ? `<path d="M186 262 q14 8 28 0" stroke="#7a3b3b" stroke-width="4" fill="none" stroke-linecap="round"/>`
      : mouth === 1
        ? `<ellipse cx="200" cy="264" rx="13" ry="8" fill="#9c3d48"/>`
        : `<ellipse cx="200" cy="268" rx="17" ry="17" fill="#9c3d48"/><ellipse cx="200" cy="278" rx="10" ry="5" fill="#e88a95"/>`;
  const back = long ? `<path d="M96 170 q-20 200 30 330 h148 q50-130 30-330z" fill="${hair}"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTRAIT_W}" height="${PORTRAIT_H}" viewBox="0 0 ${PORTRAIT_W} ${PORTRAIT_H}">
${back}
<path d="M70 640 q10-200 130-230 q120 30 130 230z" fill="${outfit}"/>
<path d="M170 330 h60 v60 q-30 20 -60 0z" fill="#f6d5c0"/>
<ellipse cx="200" cy="220" rx="100" ry="115" fill="#fbe2d2"/>
<path d="M96 210 q0-130 104-130 q104 0 104 130 q-30-70-104-70 q-60 0-104 70z" fill="${hair}"/>
<path d="M120 150 q40 40 80 10 q40 30 90 -10 q-20-60-90-60 q-70 0-80 60z" fill="${hair}"/>
<ellipse cx="160" cy="220" rx="13" ry="20" fill="#2b2b3a"/><ellipse cx="240" cy="220" rx="13" ry="20" fill="#2b2b3a"/>
<circle cx="165" cy="212" r="5" fill="#fff"/><circle cx="245" cy="212" r="5" fill="#fff"/>
<ellipse cx="140" cy="250" rx="14" ry="7" fill="#f7b5b5" opacity=".6"/><ellipse cx="260" cy="250" rx="14" ry="7" fill="#f7b5b5" opacity=".6"/>
${m}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function samplePortrait(hair: string, outfit: string, long: boolean, x: number) {
  return {
    closed: portraitSvg(hair, outfit, 0, long),
    half: portraitSvg(hair, outfit, 1, long),
    open: portraitSvg(hair, outfit, 2, long),
    width: PORTRAIT_W,
    height: PORTRAIT_H,
    x,
    scale: 130,
  };
}

/** 体験版の最初に開いておくプロジェクト */
export function demoProject(): Project {
  const p = emptyProject();
  const [a, b]: Character[] = p.characters;
  a.name = "あおい";
  a.portrait = samplePortrait("#4a6fa5", "#e8eef7", true, 0.78);
  b.name = "そら";
  b.portrait = samplePortrait("#6b4a3a", "#3f5f4a", false, 0.22);
  p.lines = [
    newLine(a, "こんにちは、あおいです。今日はこの編集ソフトでできることを紹介します。"),
    newLine(b, "セリフを打ち込んで生成を押すだけで、声がつくんですよね。"),
    newLine(a, "はい。字幕は画面の幅に合わせて自動で改行されるので、長いセリフでもはみ出しません。"),
    newLine(b, "立ち絵も音声に合わせて口パクします。"),
    newLine(a, "できあがったらAviUtlのexoや動画に書き出せます。"),
  ];
  return p;
}

// ---- Tauri の代わり ----

/** ブラウザのファイル選択。選ばれたファイルは blob URL で返す */
function pickFile(filters?: { extensions: string[] }[]): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const exts = (filters ?? []).flatMap((f) => f.extensions).filter((e) => e !== "*");
    if (exts.some((e) => ["png", "jpg", "jpeg", "webp"].includes(e))) input.accept = "image/*";
    else if (exts.length) input.accept = exts.map((e) => `.${e.split(".").pop()}`).join(",");
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? URL.createObjectURL(f) : null);
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function imageSize(src: string): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
    img.onerror = () => reject(new Error("画像を読み込めませんでした"));
    img.src = src;
  });
}

const unavailable = () => Promise.reject(new Error("体験版ではファイルの保存や書き出しはできません"));

async function invoke(cmd: string, args: Record<string, any> = {}) {
  switch (cmd) {
    case "detect_voicepeak":
      return "（体験版）";
    case "list_narrators":
      return NARRATORS;
    case "list_emotions":
      return EMOTIONS;
    case "synthesize":
      // 本物っぽく少し待つ
      await new Promise((r) => setTimeout(r, 250));
      return synthesize(args.req);
    case "analyze_mouth":
      return "";
    case "image_size":
      return imageSize(args.path);
    case "audio_dir":
      return "/demo";
    case "read_text_file":
      return (await fetch(args.path)).text();
    case "plugin:dialog|open":
      return pickFile(args.options?.filters);
    case "plugin:dialog|save":
      return null;
    case "plugin:app|version":
      return "0.2.0";
    default:
      return unavailable();
  }
}

(window as any).__TAURI_INTERNALS__ = {
  invoke,
  convertFileSrc: (path: string) => path,
  transformCallback: () => 0,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
};
