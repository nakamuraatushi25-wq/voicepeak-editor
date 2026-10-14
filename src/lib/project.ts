import type { Character, Line, Project } from "../types";

export const uid = () => Math.random().toString(36).slice(2, 10);

const PALETTE = ["#4fc3f7", "#f48fb1", "#aed581", "#ffb74d", "#ba68c8", "#4db6ac"];

export function newCharacter(index: number, narrator = "Japanese Female 1"): Character {
  return {
    id: uid(),
    name: `キャラ${index + 1}`,
    narrator,
    color: PALETTE[index % PALETTE.length],
    emotions: {},
    speed: 100,
    pitch: 0,
  };
}

export function newLine(character: Character, text = ""): Line {
  return {
    id: uid(),
    characterId: character.id,
    text,
    emotions: { ...character.emotions },
    speed: character.speed,
    pitch: character.pitch,
    pause: 0.3,
  };
}

export function emptyProject(): Project {
  const a = newCharacter(0, "Japanese Female 1");
  const b = newCharacter(1, "Japanese Male 1");
  return {
    version: 1,
    characters: [a, b],
    lines: [newLine(a, "こんにちは。今日はVOICEPEAKの使い方を紹介します。"), newLine(b, "よろしくお願いします。")],
    video: {
      width: 1920,
      height: 1080,
      fps: 30,
      background: "#202020",
      font: "メイリオ",
      fontSize: 64,
    },
  };
}

export function parseProject(json: string): Project {
  const p = JSON.parse(json) as Project;
  if (p.version !== 1 || !Array.isArray(p.characters) || !Array.isArray(p.lines)) {
    throw new Error("このファイルはプロジェクトとして読み込めません");
  }
  return p;
}

/**
 * 「名前：セリフ」形式のテキストを行に変換する。名前が見つからない行は直前のキャラで読む。
 * 台本をまとめて貼り付けるとき用。
 */
export function importScript(text: string, characters: Character[]): Line[] {
  const byName = new Map(characters.map((c) => [c.name, c]));
  let current = characters[0];
  const lines: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const row = raw.trim();
    if (!row) continue;
    const m = row.match(/^(.+?)[：:](.+)$/);
    if (m && byName.has(m[1].trim())) {
      current = byName.get(m[1].trim())!;
      lines.push(newLine(current, m[2].trim()));
    } else if (current) {
      lines.push(newLine(current, row));
    }
  }
  return lines;
}
