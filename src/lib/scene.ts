/**
 * タイムライン全体の「いつ何を出すか」をまとめたもの。
 * プレビューとすべての書き出しがこれを使うので、見た目と書き出し結果がそろう。
 */
import type { Character, MouthImages, PlacedLine, Project, Slide } from "../types";
import { layout, totalDuration } from "./timeline";
import { buildCues, type Cue } from "./subtitle";
import { MOUTH_FPS } from "./mouth";

/** start〜end 秒のあいだ value を出す */
export interface Span<T> {
  start: number;
  end: number;
  value: T;
}

/** 立ち絵の 1 コマ：この画像を start〜end 秒に出す */
export type Frame = Span<string>;

export interface Model {
  /** この範囲の長さ（秒） */
  total: number;
  /** 全体のタイムラインのどこから始まる範囲か（章だけ書き出すときに 0 以外） */
  offset: number;
  placed: PlacedLine[];
  cues: Cue[];
  /** キャラ id → 立ち絵のコマ（0〜total をすき間なく覆う） */
  frames: Map<string, Frame[]>;
  slides: Span<Slide>[];
  titles: Span<string>[];
  /** 誰かが話している区間（BGM を小さくする） */
  speech: [number, number][];
}

export interface Chapter {
  title: string;
  start: number;
  end: number;
}

export function buildModel(project: Project): Model {
  const placed = layout(project.lines, project.characters);
  const total = totalDuration(placed, project.movie?.duration);
  const frames = new Map<string, Frame[]>();
  for (const c of project.characters) if (c.portrait) frames.set(c.id, portraitFrames(placed, c, total));
  return {
    total,
    offset: 0,
    placed,
    cues: buildCues(placed, project.video),
    frames,
    slides: stateSpans(placed, total, (l) => l.slide),
    titles: stateSpans(placed, total, (l) => (l.title === undefined ? undefined : l.title || null)),
    speech: speechSpans(placed),
  };
}

/**
 * 行ごとの「ここから変える」指定を区間にする。
 * undefined は前のまま、null はそこで消す。
 */
function stateSpans<T>(placed: PlacedLine[], total: number, pick: (l: PlacedLine["line"]) => T | null | undefined): Span<T>[] {
  const out: Span<T>[] = [];
  let cur: Span<T> | null = null;
  for (const p of placed) {
    const v = pick(p.line);
    if (v === undefined) continue;
    if (cur) cur.end = p.start;
    cur = v === null ? null : { start: p.start, end: total, value: v };
    if (cur) out.push(cur);
  }
  return out.filter((s) => s.end > s.start);
}

/** 話している区間をまとめる（重なりやすき間 0.05 秒未満はつなげる） */
export function speechSpans(placed: PlacedLine[]): [number, number][] {
  const spans = placed.map((p) => [p.start, p.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of spans) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 0.05) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** 表情の名前から口の形 3 枚を選ぶ。知らない名前ならいつもの絵 */
export function expressionImages(c: Character, name?: string): MouthImages {
  const p = c.portrait!;
  return (name && p.expressions?.[name]) || p;
}

/**
 * キャラの立ち絵を、表情と口パクに合わせたコマの並びにする。
 * 表情はそのキャラの次のセリフまで続き、口はセリフの音量に合わせて開く。
 */
export function portraitFrames(placed: PlacedLine[], c: Character, total: number): Frame[] {
  const out: Frame[] = [];
  const push = (start: number, end: number, value: string) => {
    if (end - start < 1e-6) return;
    const last = out[out.length - 1];
    if (last && last.value === value && Math.abs(last.end - start) < 1e-6) last.end = end;
    else out.push({ start, end, value });
  };
  let face = expressionImages(c);
  let t = 0;
  for (const p of placed) {
    if (p.character.id !== c.id) continue;
    push(t, p.start, face.closed);
    face = expressionImages(c, p.line.expression);
    const m = p.line.audio?.mouth ?? "";
    let at = p.start;
    let i = 0;
    while (i < m.length && at < p.end) {
      let j = i;
      while (j < m.length && m[j] === m[i]) j++;
      const end = Math.min(p.end, p.start + j / MOUTH_FPS);
      const img = m[i] === "2" ? face.open : m[i] === "1" ? (face.half ?? face.open) : face.closed;
      push(at, end, img);
      at = end;
      i = j;
    }
    push(at, p.end, face.closed);
    t = Math.max(t, p.end);
  }
  push(t, Math.max(total, t), face.closed);
  return out;
}

/** 時刻 t に出ている区間の値 */
export function spanAt<T>(spans: Span<T>[], t: number): T | undefined {
  return spans.find((s) => t >= s.start && t < s.end)?.value;
}

/** 見出しで区切った章。最初の見出しより前があれば「はじめ」とする */
export function chapters(model: Model): Chapter[] {
  const starts = model.placed.filter((p) => p.line.title).map((p) => ({ title: p.line.title!, start: p.start }));
  if (starts.length === 0) return [];
  if (starts[0].start > 0.01) starts.unshift({ title: "はじめ", start: 0 });
  return starts.map((s, i) => ({ ...s, end: starts[i + 1]?.start ?? model.total }));
}

function crop<T extends { start: number; end: number }>(items: T[], from: number, to: number): T[] {
  return items
    .filter((x) => x.end > from && x.start < to)
    .map((x) => ({ ...x, start: Math.max(0, x.start - from), end: Math.min(to, x.end) - from }));
}

/** from〜to 秒だけを切り出し、0 秒から始まるようにずらす */
export function cropModel(model: Model, from: number, to: number): Model {
  // セリフは途中で切らず、始まりが範囲に入る行をまるごと入れる
  const placed = model.placed
    .filter((p) => p.start >= from - 1e-6 && p.start < to)
    .map((p) => ({ ...p, start: p.start - from, end: p.end - from }));
  const end = Math.max(to, ...placed.map((p) => p.end + from));
  const total = end - from;
  const frames = new Map<string, Frame[]>();
  for (const [id, f] of model.frames) frames.set(id, crop(f, from, end));
  return {
    total,
    offset: model.offset + from,
    placed,
    cues: model.cues.filter((c) => c.start >= from - 1e-6 && c.start < end).map((c) => ({ ...c, start: c.start - from, end: c.end - from })),
    frames,
    slides: crop(model.slides, from, end),
    titles: crop(model.titles, from, end),
    speech: model.speech
      .filter(([s, e]) => e > from && s < end)
      .map(([s, e]) => [Math.max(0, s - from), Math.min(end, e) - from] as [number, number]),
  };
}

/** 画像を字幕の上の部分（画面の高さ 85%）に収めるときの、表示の大きさ（px） */
export function slideBox(slide: Slide, width: number, height: number) {
  const fit = Math.min(width / slide.width, (height * 0.85) / slide.height) * (slide.scale / 100);
  const w = slide.width * fit;
  const h = slide.height * fit;
  return { zoom: fit, w, h, left: (width - w) / 2, top: (height * 0.85 - h) / 2 };
}
