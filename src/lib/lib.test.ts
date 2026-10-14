import { describe, expect, it } from "vitest";
import { splitText } from "./split";
import { audioKey, layout, totalDuration } from "./timeline";
import { buildExo, encodeExoText } from "./exo";
import { assColor, assTime, buildAss, buildSrt } from "./ass";
import { emptyProject, importScript, newCharacter } from "./project";

describe("splitText", () => {
  it("短い文はそのまま", () => {
    expect(splitText("こんにちは。")).toEqual(["こんにちは。"]);
  });

  it("140 文字を超えたら文末で切る", () => {
    const s = "あ".repeat(100) + "。" + "い".repeat(100) + "。";
    const chunks = splitText(s);
    expect(chunks).toEqual(["あ".repeat(100) + "。", "い".repeat(100) + "。"]);
    expect(chunks.every((c) => c.length <= 140)).toBe(true);
  });

  it("区切りがなければ文字数で切る", () => {
    const chunks = splitText("あ".repeat(300));
    expect(chunks.map((c) => c.length)).toEqual([140, 140, 20]);
  });
});

describe("layout", () => {
  it("行を順番に並べ、音声の長さと間を足していく", () => {
    const p = emptyProject();
    p.lines[0].audio = { path: "a.wav", duration: 2, key: "" };
    p.lines[0].pause = 0.5;
    p.lines[1].audio = { path: "b.wav", duration: 1, key: "" };
    const placed = layout(p.lines, p.characters);
    expect(placed.map((x) => [x.start, x.end, x.layer])).toEqual([
      [0, 2, 0],
      [2.5, 3.5, 1],
    ]);
    expect(totalDuration(placed)).toBe(3.5);
  });

  it("設定が変わるとキーも変わる", () => {
    const p = emptyProject();
    const before = audioKey(p.lines[0], p.characters[0]);
    p.lines[0].speed = 120;
    expect(audioKey(p.lines[0], p.characters[0])).not.toBe(before);
  });
});

describe("exo", () => {
  it("テキストは UTF-16LE の 16 進で 4096 桁", () => {
    const hex = encodeExoText("あA");
    expect(hex.startsWith("42304100")).toBe(true);
    expect(hex.length).toBe(4096);
  });

  it("音声と字幕をキャラごとのレイヤーに置く", () => {
    const p = emptyProject();
    p.lines[0].audio = { path: "C:\\a.wav", duration: 1, key: "" };
    p.lines[0].pause = 0;
    const exo = buildExo(layout(p.lines, p.characters), p.video);
    expect(exo).toContain("[0]\nstart=1\nend=30\nlayer=1");
    expect(exo).toContain("file=C:\\a.wav");
    expect(exo).toContain("[1]\nstart=1\nend=30\nlayer=2");
    // 2 行目は音声なしなので字幕だけ、キャラ 2 の字幕レイヤー 4
    expect(exo).toContain("[2]\nstart=31\n");
    expect(exo).toMatch(/\[2\]\nstart=31\nend=\d+\nlayer=4/);
  });
});

describe("ass / srt", () => {
  it("時刻と色を変換する", () => {
    expect(assTime(3725.5)).toBe("1:02:05.50");
    expect(assColor("#4fc3f7")).toBe("&H00F7C34F");
  });

  it("行ごとに Dialogue を出す", () => {
    const p = emptyProject();
    const placed = layout(p.lines, p.characters);
    const ass = buildAss(placed, p.video);
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(2);
    expect(buildSrt(placed)).toContain("1\n00:00:00,000 --> ");
  });
});

describe("importScript", () => {
  it("名前：セリフ 形式を読み、名前がなければ直前のキャラ", () => {
    const a = { ...newCharacter(0), name: "ずん" };
    const b = { ...newCharacter(1), name: "めたん" };
    const lines = importScript("ずん：やあ\nめたん: こんにちは\n続きです\n", [a, b]);
    expect(lines.map((l) => [l.characterId, l.text])).toEqual([
      [a.id, "やあ"],
      [b.id, "こんにちは"],
      [b.id, "続きです"],
    ]);
  });
});
