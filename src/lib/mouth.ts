import type { Character, PlacedLine } from "../types";

/** 口パクデータのフレームレート（Rust 側と合わせる） */
export const MOUTH_FPS = 30;

/** 口が開いている区間。開始・終了は秒、level は 1 半開き / 2 開き */
export type MouthSegment = [start: number, end: number, level: 1 | 2];

/** あるキャラの口パク区間をタイムライン全体で求める（昇順・重なりなし） */
export function mouthSegments(placed: PlacedLine[], character: Character): MouthSegment[] {
  const out: MouthSegment[] = [];
  for (const p of placed) {
    if (p.character.id !== character.id || !p.line.audio?.mouth) continue;
    const m = p.line.audio.mouth;
    let i = 0;
    while (i < m.length) {
      const level = Number(m[i]);
      let j = i;
      while (j < m.length && m[j] === m[i]) j++;
      if (level > 0) {
        const start = p.start + i / MOUTH_FPS;
        const end = Math.min(p.end, p.start + j / MOUTH_FPS);
        if (end > start) out.push([start, end, level as 1 | 2]);
      }
      i = j;
    }
  }
  return out;
}

/** プレビュー用：時刻 t のキャラの口の開き具合 */
export function mouthAt(placed: PlacedLine[], character: Character, t: number): 0 | 1 | 2 {
  const p = placed.find((x) => x.character.id === character.id && t >= x.start && t < x.end);
  const m = p?.line.audio?.mouth;
  if (!p || !m) return 0;
  return (Number(m[Math.floor((t - p.start) * MOUTH_FPS)] ?? 0) as 0 | 1 | 2);
}
