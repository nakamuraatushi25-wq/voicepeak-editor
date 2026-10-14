/** VOICEPEAK が一度に読める上限 */
export const MAX_CHARS = 140;

const SENTENCE_END = /[。！？!?\n]/;
const SOFT_BREAK = /[、，,　 ]/;

/**
 * 長い文章を MAX_CHARS 以内のかたまりに分ける。
 * なるべく文末、次に読点で切り、どちらもなければ文字数で切る。
 */
export function splitText(text: string, max = MAX_CHARS): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = findCut(rest, max);
    const head = rest.slice(0, cut).trim();
    if (head) chunks.push(head);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function findCut(text: string, max: number): number {
  for (const re of [SENTENCE_END, SOFT_BREAK]) {
    for (let i = max - 1; i > max / 3; i--) {
      if (re.test(text[i])) return i + 1;
    }
  }
  return max;
}
