import type { Character, Line, PlacedLine } from "../types";

/** 音声がまだない行に仮で割り当てる長さ（1 文字あたり秒） */
const SEC_PER_CHAR = 0.15;

export function estimateDuration(text: string): number {
  return Math.max(0.5, text.length * SEC_PER_CHAR);
}

/**
 * 台本の行を順番どおりに並べ、開始・終了時刻とキャラごとのレイヤーを決める。
 * レイヤーはキャラの登録順（0 始まり）。
 * 時刻を指定した行はその時刻から話し、次の行はそのあとに続く。
 * 同じキャラのセリフは重ならないよう、前のセリフが終わるまで後ろにずらす。
 */
export function layout(lines: Line[], characters: Character[]): PlacedLine[] {
  const byId = new Map(characters.map((c, i) => [c.id, { c, i }]));
  const placed: PlacedLine[] = [];
  const busyUntil = new Map<string, number>();
  let t = 0;
  for (const line of lines) {
    const found = byId.get(line.characterId);
    if (!found) continue;
    const duration = line.audio?.duration ?? estimateDuration(line.text);
    const start = Math.max(line.at ?? t, busyUntil.get(found.c.id) ?? 0);
    const end = start + duration;
    placed.push({ line, character: found.c, layer: found.i, start, end });
    busyUntil.set(found.c.id, end);
    t = end + Math.max(0, line.pause);
  }
  return placed;
}

/** 全体の長さ。背景動画があればそれより短くはしない */
export function totalDuration(placed: PlacedLine[], minimum = 0): number {
  return placed.reduce((m, p) => Math.max(m, p.end), minimum);
}

/** 音声を作り直す必要があるか判定するためのキー */
export function audioKey(line: Line, character: Character): string {
  return JSON.stringify([character.narrator, line.text, line.emotions, line.speed, line.pitch]);
}
