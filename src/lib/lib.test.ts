import { describe, expect, it } from "vitest";
import { splitText } from "./split";
import { audioKey, layout, totalDuration } from "./timeline";
import { bgmSegments, buildExo, encodeExoText } from "./exo";
import { buildModel, chapters, cropModel, portraitFrames } from "./scene";
import { displayText, speechText } from "./reading";
import { assColor, assTime, buildAss, buildSrt } from "./ass";
import { buildCues, paginate, phrases, textWidth } from "./subtitle";
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

  it("声と字幕をキャラごとのレイヤーに置き、使わないレイヤーは詰める", () => {
    const p = emptyProject();
    p.lines[0].audio = { path: "C:\\a.wav", duration: 1, key: "" };
    p.lines[0].pause = 0;
    const exo = buildExo(buildModel(p), p.characters, p.video);
    // 声は 1 人目だけなのでレイヤー 1、字幕は 2 人ぶん 2〜3
    expect(exo).toContain("[0]\nstart=1\nend=30\nlayer=1\noverlay=1\naudio=1");
    expect(exo).toContain("file=C:\\a.wav");
    expect(exo).toContain("[1]\nstart=1\nend=30\nlayer=2");
    // 2 行目は音声なしなので字幕だけ
    expect(exo).toMatch(/\[2\]\nstart=31\nend=\d+\nlayer=3/);
  });

  it("立ち絵は口の形ごとのコマを 1 つのレイヤーにすき間なく並べる", () => {
    const p = emptyProject();
    p.characters[0].portrait = { closed: "c.png", open: "o.png", width: 400, height: 800, x: 0.8, scale: 50 };
    // 30fps で 0.1 秒閉じ → 0.2 秒開き → 0.1 秒閉じ
    p.lines[0].audio = { path: "a.wav", duration: 0.4, key: "", mouth: "000222222000" };
    p.lines[0].pause = 0;
    const exo = buildExo(buildModel(p), p.characters, p.video);
    expect(exo).toContain("[0]\nstart=1\nend=3\nlayer=1\noverlay=1\ncamera=0\n[0.0]\n_name=画像ファイル\nfile=c.png");
    expect(exo).toContain("[1]\nstart=4\nend=9\nlayer=1\noverlay=1\ncamera=0\n[1.0]\n_name=画像ファイル\nfile=o.png");
    expect(exo).toContain("[2]\nstart=10\nend=61\nlayer=1\noverlay=1\ncamera=0\n[2.0]\n_name=画像ファイル\nfile=c.png");
    // 中心から右へ 0.3 画面分、下端そろえ（1080/2 - 800*0.5/2）
    expect(exo).toContain("X=576.0\nY=340.0");
  });

  it("背景動画は一番下に置き、ほかのレイヤーはその上に積む", () => {
    const p = emptyProject();
    p.lines = p.lines.slice(0, 1);
    p.lines[0].audio = { path: "C:\\a.wav", duration: 1, key: "" };
    const movie = { path: "C:\\m.mp4", duration: 10, width: 1280, height: 720, volume: 40 };
    const exo = buildExo(buildModel({ ...p, movie }), p.characters, p.video, movie);
    expect(exo).toContain("length=300");
    expect(exo).toContain("[0]\nstart=1\nend=300\nlayer=1\noverlay=1\ncamera=0\n[0.0]\n_name=動画ファイル\n再生位置=1");
    // 1280x720 を 1920x1080 に合わせて 150%
    expect(exo).toContain("拡大率=150.00");
    expect(exo).toContain("[1]\nstart=1\nend=300\nlayer=2\noverlay=1\naudio=1");
    expect(exo).toContain("動画ファイルと連携=1\nfile=C:\\m.mp4");
    expect(exo).toContain("音量=40.0");
    expect(exo).toContain("[2]\nstart=1\nend=30\nlayer=3\noverlay=1\naudio=1");
  });

  it("画像・見出し・BGM を置く", () => {
    const p = emptyProject();
    const [a] = p.characters;
    p.lines = [newLine(a, "一"), newLine(a, "二"), newLine(a, "三")];
    p.lines.forEach((l) => {
      l.audio = { path: "x.wav", duration: 1, key: "" };
      l.pause = 0;
    });
    p.lines[0].title = "はじめに";
    p.lines[1].slide = { path: "表1.png", width: 960, height: 540, scale: 100 };
    p.lines[2].slide = null;
    const bgm = { path: "bgm.mp3", duration: 100, volume: 50, duck: 20 };
    const exo = buildExo(buildModel(p), p.characters, p.video, undefined, bgm);
    // 画像は 1〜2 秒。字幕の上（高さ 85%）に収まる大きさ 170%、中心は上に寄せる
    expect(exo).toContain("start=31\nend=60\nlayer=1\noverlay=1\ncamera=0\n[0.0]\n_name=画像ファイル\nfile=表1.png");
    expect(exo).toContain("Y=-81.0\nZ=0.0\n拡大率=170.00");
    // 見出しは字幕のあと、BGM は一番上。話している間だけ音量 10
    expect(exo).toMatch(/layer=4\noverlay=1\ncamera=0\n\[\d+\.0\]\n_name=テキスト\nサイズ=51/);
    expect(exo).toMatch(/start=1\nend=90\nlayer=5\noverlay=1\naudio=1\n\[\d+\.0\]\n_name=音声ファイル\n再生位置=0.00\n再生速度=100.0\nループ再生=1/);
    expect(exo).toContain("音量=10.0");
  });
});

describe("場面の組み立て", () => {
  const project = () => {
    const p = emptyProject();
    const [a, b] = p.characters;
    p.lines = [newLine(a, "一"), newLine(b, "二"), newLine(a, "三"), newLine(b, "四")];
    p.lines.forEach((l) => {
      l.audio = { path: "x.wav", duration: 1, key: "", mouth: "000222" };
      l.pause = 0;
    });
    return p;
  };

  it("画像と見出しは指定した行から次の指定まで続く", () => {
    const p = project();
    p.lines[1].title = "1 はじめに";
    p.lines[1].slide = { path: "a.png", width: 10, height: 10, scale: 100 };
    p.lines[3].title = "2 結果";
    p.lines[3].slide = null;
    const m = buildModel(p);
    expect(m.titles.map((t) => [t.start, t.end, t.value])).toEqual([
      [1, 3, "1 はじめに"],
      [3, 4, "2 結果"],
    ]);
    expect(m.slides.map((t) => [t.start, t.end])).toEqual([[1, 3]]);
    expect(chapters(m).map((c) => [c.title, c.start, c.end])).toEqual([
      ["はじめ", 0, 1],
      ["1 はじめに", 1, 3],
      ["2 結果", 3, 4],
    ]);
  });

  it("章だけ切り出すと 0 秒から始まり、範囲外のものは入らない", () => {
    const p = project();
    p.lines[1].title = "前半";
    p.lines[3].title = "後半";
    const m = buildModel(p);
    const c = cropModel(m, 1, 3);
    expect(c.offset).toBe(1);
    expect(c.total).toBe(2);
    expect(c.placed.map((x) => [x.line.text, x.start, x.end])).toEqual([
      ["二", 0, 1],
      ["三", 1, 2],
    ]);
    expect(c.titles.map((t) => [t.start, t.end, t.value])).toEqual([[0, 2, "前半"]]);
    expect(c.speech).toEqual([[0, 2]]);
  });

  it("表情はそのセリフから次のセリフまで続き、口パクもその表情の絵を使う", () => {
    const p = project();
    const a = p.characters[0];
    a.portrait = {
      closed: "c.png",
      open: "o.png",
      width: 1,
      height: 1,
      x: 0.5,
      scale: 100,
      expressions: { 笑顔: { closed: "sc.png", open: "so.png" } },
    };
    p.lines[2].expression = "笑顔";
    const frames = portraitFrames(layout(p.lines, p.characters), a, 4);
    expect(frames.map((f) => [f.start, f.end, f.value])).toEqual([
      [0, 0.1, "c.png"],
      [0.1, 0.2, "o.png"],
      [0.2, 2, "c.png"],
      [2, 2.1, "sc.png"],
      [2.1, 2.2, "so.png"],
      [2.2, 4, "sc.png"],
    ]);
  });

  it("BGM の区切り：話している区間とそうでない区間に分ける", () => {
    expect(bgmSegments([[1, 2], [3, 4]], 5)).toEqual([
      [0, 1, false],
      [1, 2, true],
      [2, 3, false],
      [3, 4, true],
      [4, 5, false],
    ]);
  });

  it("見出しは ASS の上寄せのスタイルで出す", () => {
    const p = project();
    p.lines[0].title = "要旨";
    const m = buildModel(p);
    const ass = buildAss(m.cues, p.video, m.titles);
    expect(ass).toContain("Style: title,メイリオ,51,");
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:04.00,title,,0,0,0,,要旨");
  });
});

describe("読み方", () => {
  it("字幕は表記のまま、声は読み方で読む", () => {
    const dict = [
      { word: "鴎外", reading: "おうがい" },
      { word: "森鴎外", reading: "もりおうがい" },
    ];
    const text = "森鴎外と鴎外、{漱石|そうせき}と{鴎外|かもめそと}";
    expect(displayText(text)).toBe("森鴎外と鴎外、漱石と鴎外");
    expect(speechText(text, dict)).toBe("もりおうがいとおうがい、そうせきとかもめそと");
  });

  it("辞書を変えると、読みが変わる行だけ作り直しになる", () => {
    const p = emptyProject();
    const [a] = p.characters;
    const hit = newLine(a, "鴎外の作品");
    const miss = newLine(a, "漱石の作品");
    const dict = [{ word: "鴎外", reading: "おうがい" }];
    expect(audioKey(hit, a, dict)).not.toBe(audioKey(hit, a));
    expect(audioKey(miss, a, dict)).toBe(audioKey(miss, a));
  });

  it("字幕には読み方の指定を出さない", () => {
    const p = emptyProject();
    p.lines = [newLine(p.characters[0], "{鴎外|おうがい}です")];
    expect(buildModel(p).cues[0].text).toBe("鴎外です");
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
