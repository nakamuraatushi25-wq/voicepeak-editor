import type { Reading } from "../types";

/** 「{鴎外|おうがい}」のように、その場で読み方を指定する書き方 */
const RUBY = /\{([^{}|]+)\|([^{}]+)\}/g;

/** 字幕に出す文字。{表記|よみ} は表記だけにする */
export function displayText(text: string): string {
  return text.replace(RUBY, "$1");
}

/**
 * VOICEPEAK に渡す文字。{表記|よみ} はよみに、辞書の語は読み方に置き換える。
 * 辞書は長い語から当てるので「森鴎外」と「鴎外」が両方あっても長いほうが勝つ。
 */
export function speechText(text: string, dictionary: Reading[] = []): string {
  const words = dictionary.filter((d) => d.word && d.reading).sort((a, b) => b.word.length - a.word.length);
  // その場の指定は辞書より優先するので、先に取り出して印に置き換えておく
  const inline: string[] = [];
  let out = text.replace(RUBY, (_, _word, reading: string) => {
    inline.push(reading);
    return `\u0000${inline.length - 1}\u0000`;
  });
  if (words.length) {
    const pattern = new RegExp(words.map((d) => escape(d.word)).join("|"), "g");
    const map = new Map(words.map((d) => [d.word, d.reading]));
    out = out
      .split(/(\u0000\d+\u0000)/)
      .map((part) => (part.startsWith("\u0000") ? part : part.replace(pattern, (w) => map.get(w)!)))
      .join("");
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => inline[Number(i)]);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
