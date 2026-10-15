import { describe, expect, it } from "vitest";
import { splitText } from "./split";
import { audioKey, layout, totalDuration } from "./timeline";
import { buildExo, encodeExoText } from "./exo";
import { assColor, assTime, buildAss, buildSrt } from "./ass";
import { buildCues, paginate, phrases, textWidth } from "./subtitle";
import { mouthSegments } from "./mouth";
import { emptyProject, importScript, newCharacter, newLine } from "./project";
import { compareVersions, pickUpdate } from "./update";

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

  it("時刻を決めた行はそこから話し、次の行はそのあとに続く", () => {
    const p = emptyProject();
    const [a, b] = p.characters;
    p.lines = [newLine(a, "一"), newLine(b, "二"), newLine(b, "三")];
    p.lines.forEach((l) => {
      l.audio = { path: "x.wav", duration: 1, key: "" };
      l.pause = 0;
    });
    p.lines[1].at = 5;
    const placed = layout(p.lines, p.characters);
    expect(placed.map((x) => x.start)).toEqual([0, 5, 6]);
    // 背景動画のほうが長ければ全体の長さは動画に合わせる
    expect(totalDuration(placed, 10)).toBe(10);
  });

  it("同じキャラのセリフは重ならないよう後ろにずらす", () => {
    const p = emptyProject();
    const [a] = p.characters;
    p.lines = [newLine(a, "一"), newLine(a, "二")];
    p.lines.forEach((l) => (l.audio = { path: "x.wav", duration: 2, key: "" }));
    p.lines[1].at = 1;
    expect(layout(p.lines, p.characters).map((x) => x.start)).toEqual([0, 2]);
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
    const placed = layout(p.lines, p.characters);
    const exo = buildExo(placed, buildCues(placed, p.video), p.characters, p.video);
    // キャラ 2 人なので 音声 5〜6、字幕 7〜8
    expect(exo).toContain("[0]\nstart=1\nend=30\nlayer=5\noverlay=1\naudio=1");
    expect(exo).toContain("file=C:\\a.wav");
    expect(exo).toContain("[1]\nstart=1\nend=30\nlayer=7");
    // 2 行目は音声なしなので字幕だけ
    expect(exo).toMatch(/\[2\]\nstart=31\nend=\d+\nlayer=8/);
  });

  it("立ち絵を下に置き、口が開いている区間に口開き画像を重ねる", () => {
    const p = emptyProject();
    p.characters[0].portrait = { closed: "c.png", open: "o.png", width: 400, height: 800, x: 0.8, scale: 50 };
    // 30fps で 0.1 秒閉じ → 0.2 秒開き → 0.1 秒閉じ
    p.lines[0].audio = { path: "a.wav", duration: 0.4, key: "", mouth: "000222222000" };
    p.lines[0].pause = 0;
    const placed = layout(p.lines, p.characters);
    const exo = buildExo(placed, buildCues(placed, p.video), p.characters, p.video);
    expect(exo).toContain("[0]\nstart=1\nend=61\nlayer=1\noverlay=1\ncamera=0\n[0.0]\n_name=画像ファイル\nfile=c.png");
    expect(exo).toContain("[1]\nstart=4\nend=9\nlayer=2\noverlay=1\ncamera=0\n[1.0]\n_name=画像ファイル\nfile=o.png");
    // 中心から右へ 0.3 画面分、下端そろえ（1080/2 - 800*0.5/2）
    expect(exo).toContain("X=576.0\nY=340.0");
    expect(mouthSegments(placed, p.characters[0])).toEqual([[0.1, 0.3, 2]]);
  });
});

describe("exo（背景動画あり）", () => {
  it("1 に動画、2 にその音声を置き、ほかのレイヤーを 2 つ上げる", () => {
    const p = emptyProject();
    p.lines[0].audio = { path: "C:\\a.wav", duration: 1, key: "" };
    const placed = layout(p.lines.slice(0, 1), p.characters);
    const movie = { path: "C:\\m.mp4", duration: 10, width: 1280, height: 720, volume: 40 };
    const exo = buildExo(placed, buildCues(placed, p.video), p.characters, p.video, movie);
    expect(exo).toContain("length=300");
    expect(exo).toContain("[0]\nstart=1\nend=300\nlayer=1\noverlay=1\ncamera=0\n[0.0]\n_name=動画ファイル");
    // 1280x720 を 1920x1080 に合わせて 150%
    expect(exo).toContain("拡大率=150.00");
    expect(exo).toContain("[1]\nstart=1\nend=300\nlayer=2\noverlay=1\naudio=1");
    expect(exo).toContain("動画ファイルと連携=1\nfile=C:\\m.mp4");
    expect(exo).toContain("音量=40.0");
    // 1 人目の声は 5 → 7
    expect(exo).toContain("[2]\nstart=1\nend=30\nlayer=7\noverlay=1\naudio=1");
  });
});

describe("字幕の改行", () => {
  it("助詞や句読点を前の語にくっつけ、カタカナ語は切らない", () => {
    expect(phrases("今日はVOICEPEAKの使い方を紹介します。").map((r) => r.join(""))).toEqual([
      "今日は",
      "VOICEPEAKの",
      "使い方を",
      "紹介します。",
    ]);
    expect(phrases("プラグインを入れる").map((r) => r.join(""))[0]).toBe("プラグインを");
  });

  it("1 行の幅に収め、2 行ごとにページを分ける", () => {
    const pages = paginate("ありがとうございます、これからもよろしくお願いします！", 14);
    expect(pages).toEqual([["ありがとうございます、", "これからもよろしく"], ["お願いします！"]]);
    for (const line of pages.flat()) expect(textWidth(line)).toBeLessThanOrEqual(14);
  });

  it("手で入れた改行はそのまま使う", () => {
    expect(paginate("一行目\n二行目", 20)).toEqual([["一行目", "二行目"]]);
  });

  it("ページが分かれたら文字数に比例して時間を割る", () => {
    const p = emptyProject();
    p.video.fontSize = 200; // 1 行 8 文字
    p.lines = [p.lines[0]];
    p.lines[0].text = "あいうえおかきく、けこさしすせそた";
    p.lines[0].audio = { path: "a.wav", duration: 4, key: "" };
    const cues = buildCues(layout(p.lines, p.characters), p.video);
    // 読点が行頭に来ないよう、語の切れ目で改行される
    expect(cues.map((c) => c.text)).toEqual(["あいうえ\nおかきく、", "けこさしすせそた"]);
    expect(cues[0].end).toBeCloseTo((4 * 9) / 17);
    expect(cues[1].end).toBe(4);
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
    const cues = buildCues(placed, p.video);
    const ass = buildAss(cues, p.video);
    expect(ass.match(/^Dialogue:/gm)?.length).toBe(2);
    expect(buildSrt(cues)).toContain("1\n00:00:00,000 --> ");
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

describe("更新の確認", () => {
  const release = (tag: string) => ({
    tag_name: tag,
    html_url: "https://example.com/release",
    body: "変更点",
    assets: [
      { name: "latest.json", browser_download_url: "https://example.com/latest.json" },
      { name: "VOICEPEAK.編集ソフト_0.3.0_x64-setup.exe", browser_download_url: "https://example.com/setup.exe" },
    ],
  });

  it("版番号を数字として比べる", () => {
    expect(compareVersions("v0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "v0.2.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.2.1")).toBeLessThan(0);
  });

  it("新しい版があればインストーラーの URL を返す", () => {
    expect(pickUpdate(release("v0.3.0"), "0.2.0")).toEqual({
      version: "0.3.0",
      downloadUrl: "https://example.com/setup.exe",
      notes: "変更点",
    });
  });

  it("同じか古い版なら何も返さない", () => {
    expect(pickUpdate(release("v0.2.0"), "0.2.0")).toBeNull();
    expect(pickUpdate(release("v0.1.0"), "0.2.0")).toBeNull();
  });
});
