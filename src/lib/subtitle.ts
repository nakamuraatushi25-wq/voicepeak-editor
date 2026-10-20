import type { Character, PlacedLine, VideoSettings } from "../types";

/** 画面に出す字幕 1 枚分 */
export interface Cue {
  start: number;
  end: number;
  /** 改行は \n */
  text: string;
  character: Character;
}

/** 1 枚に出す最大行数 */
export const MAX_LINES = 2;

const PUNCT = /^[、。，．,.!！?？」』）)】〉》…ー〜～・]+$/;
/** 前の語にくっつける助詞・助動詞など */
const KANA_TAIL =
  /^(?:[ぁ-ゖー]|から|まで|より|けど|けれど|ので|のに|って|ます|ました|ません|です|でした|ない|なかった|たい|ている|てる|られ|れる|られる|せる|させる|ござい|という|だろう|でしょう|だけ|など|なら|ば|ちゃう|じゃない)$/;
const KATAKANA = /^[ァ-ヺー]+$/;
const BREAK_AFTER = /[、。，,!！?？]$/;

/** 全角 1、半角 0.5 で数えた見た目の幅 */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u0000-ÿ｡-ﾟ]/.test(ch) ? 0.5 : 1;
  return w;
}

/** 字幕 1 行に入る全角文字数（左右に 5% ずつ余白） */
export function charsPerLine(video: VideoSettings): number {
  return Math.max(4, Math.floor((video.width * 0.9) / video.fontSize));
}

/**
 * 単語の途中や助詞の前で切らないよう、文節に近いかたまりに分ける。
 * 句読点・閉じかっこ・短いひらがな（助詞や「ます」など）は直前にくっつける。
 * 戻り値はかたまりごとの単語の並び。
 */
export function phrases(text: string): string[][] {
  const seg = new Intl.Segmenter("ja", { granularity: "word" });
  const out: string[][] = [];
  for (const { segment } of seg.segment(text)) {
    const run = out[out.length - 1];
    const prev = run?.[run.length - 1];
    const attach =
      prev !== undefined &&
      !/\s$/.test(prev) &&
      (PUNCT.test(segment) ||
        (KANA_TAIL.test(segment) && !BREAK_AFTER.test(prev)) ||
        (KATAKANA.test(segment) && KATAKANA.test(prev))); // 「プラグ|イン」のような分割を戻す
    if (attach) run.push(segment);
    else out.push([segment]);
  }
  return out;
}

/** 1 段落を幅 max 以内の行に分ける */
function wrapParagraph(text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) lines.push(cur.trim());
    cur = "";
  };
  // 入りきらなければ改行してから置く。それでも長すぎるものは文字で切る
  const place = (piece: string) => {
    if (cur && textWidth(cur + piece) > max) flush();
    if (!cur) piece = piece.trimStart();
    while (textWidth(piece) > max) {
      let i = 0;
      let w = 0;
      for (const ch of piece) {
        if (w + textWidth(ch) > max) break;
        w += textWidth(ch);
        i += ch.length;
      }
      lines.push(piece.slice(0, i));
      piece = piece.slice(i);
    }
    cur += piece;
  };
  for (const run of phrases(text)) {
    const joined = run.join("");
    if (textWidth(joined) <= max) place(joined);
    else run.forEach(place); // かたまりが 1 行より長いときだけ、単語の切れ目で切る
    // 読点や句点で行の半分を超えていたら、そこで改行すると読みやすい
    if (BREAK_AFTER.test(cur) && textWidth(cur) >= max * 0.6) flush();
  }
  flush();
  return lines;
}

/** セリフを「最大 MAX_LINES 行 × max 文字」のページに分ける。手で入れた改行は尊重する */
export function paginate(text: string, max: number, maxLines = MAX_LINES): string[][] {
  const lines = text.split(/\r?\n/).flatMap((para) => (para.trim() ? wrapParagraph(para.trim(), max) : []));
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += maxLines) pages.push(lines.slice(i, i + maxLines));
  return pages.length ? pages : [[""]];
}

/** 配置済みの行を字幕に変える。ページが複数ある行は文字数に比例して時間を割る */
export function buildCues(placed: PlacedLine[], video: VideoSettings): Cue[] {
  const max = charsPerLine(video);
  const cues: Cue[] = [];
  for (const p of placed) {
    const pages = paginate(p.line.text, max);
    const weights = pages.map((pg) => Math.max(1, textWidth(pg.join(""))));
    const sum = weights.reduce((a, b) => a + b, 0);
    let t = p.start;
    pages.forEach((pg, i) => {
      const end = i === pages.length - 1 ? p.end : t + ((p.end - p.start) * weights[i]) / sum;
      cues.push({ start: t, end, text: pg.join("\n"), character: p.character });
      t = end;
    });
  }
  return cues;
}
