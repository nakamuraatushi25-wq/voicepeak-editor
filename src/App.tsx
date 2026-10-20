import { useCallback, useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Character, Line, Project, Reading, Settings } from "./types";
import { api } from "./lib/api";
import { splitText } from "./lib/split";
import { audioKey } from "./lib/timeline";
import { buildExo } from "./lib/exo";
import { buildAss, buildSrt } from "./lib/ass";
import { buildModel, chapters, cropModel, slideBox, type Model } from "./lib/scene";
import { speechText } from "./lib/reading";
import { audioInfo, fileName, videoInfo } from "./lib/media";
import { emptyProject, importScript, newCharacter, newLine, parseProject } from "./lib/project";
import { playOnce, usePlayer } from "./lib/player";
import { CharacterPanel } from "./components/CharacterPanel";
import { ScriptEditor } from "./components/ScriptEditor";
import { Timeline } from "./components/Timeline";
import { Preview } from "./components/Preview";
import { UpdateBanner } from "./components/UpdateBanner";

const SETTINGS_KEY = "voicepeak-editor.settings";

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { voicepeakPath: s.voicepeakPath ?? "", ffmpegPath: s.ffmpegPath ?? "ffmpeg" };
  } catch {
    return { voicepeakPath: "", ffmpegPath: "ffmpeg" };
  }
}

/** 体験版の素材は埋め込みデータなので、exo では読みやすいファイル名に置き換える */
function friendlyPaths(exo: string): string {
  const names = new Map<string, string>();
  return exo.replace(/^file=(data:|blob:)(.*)$/gm, (_, kind: string, rest: string) => {
    if (kind === "blob:" && rest.includes("#")) return `file=C:\\素材\\${decodeURIComponent(rest.split("#").pop()!)}`;
    if (!names.has(rest)) names.set(rest, `見本の画像${names.size + 1}.png`);
    return `file=C:\\素材\\${names.get(rest)}`;
  });
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App({ initialProject, demo = false }: { initialProject?: Project; demo?: boolean }) {
  const [project, setProject] = useState<Project>(() => initialProject ?? emptyProject());
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [narrators, setNarrators] = useState<string[]>([]);
  const [emotionMap, setEmotionMap] = useState<Record<string, string[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<"settings" | "import" | "dictionary" | null>(null);
  /** 書き出す範囲。-1 は全体、0 以上は章の番号 */
  const [range, setRange] = useState(-1);
  /** 体験版で書き出しの代わりに中身を見せる */
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);
  const [pxPerSec, setPxPerSec] = useState(60);

  const model = useMemo(() => buildModel(project), [project]);
  const { placed, total } = model;
  const chapterList = useMemo(() => chapters(model), [model]);
  const player = usePlayer(placed, total);

  // 設定の保存と VOICEPEAK の自動検出
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* 保存できなくても動作は続ける */
    }
  }, [settings]);

  useEffect(() => {
    if (settings.voicepeakPath) return;
    api.detectVoicepeak().then((p) => p && setSettings((s) => ({ ...s, voicepeakPath: p })), () => undefined);
  }, [settings.voicepeakPath]);

  useEffect(() => {
    if (!settings.voicepeakPath) return;
    api.listNarrators(settings.voicepeakPath).then(setNarrators, (e) => setMessage(errorText(e)));
  }, [settings.voicepeakPath]);

  // 使っているナレーターの感情一覧を取りに行く
  const usedNarrators = project.characters.map((c) => c.narrator).join("\n");
  useEffect(() => {
    if (!settings.voicepeakPath) return;
    for (const n of new Set(usedNarrators.split("\n"))) {
      if (emotionMap[n]) continue;
      api.listEmotions(settings.voicepeakPath, n).then(
        (list) => setEmotionMap((m) => ({ ...m, [n]: list })),
        () => setEmotionMap((m) => ({ ...m, [n]: [] })),
      );
    }
  }, [usedNarrators, settings.voicepeakPath, emotionMap]);

  const emotionsOf = useCallback((n: string) => emotionMap[n] ?? [], [emotionMap]);

  const updateLines = (fn: (lines: Line[]) => Line[]) => setProject((p) => ({ ...p, lines: fn(p.lines) }));
  const updateLine = (line: Line) => updateLines((ls) => ls.map((l) => (l.id === line.id ? line : l)));
  const updateCharacter = (c: Character) =>
    setProject((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? c : x)) }));

  // ---- 音声生成 ----
  const generate = async (line: Line): Promise<Line> => {
    const c = project.characters.find((x) => x.id === line.characterId);
    if (!c) throw new Error("キャラが見つかりません");
    if (!settings.voicepeakPath) throw new Error("先に設定で VOICEPEAK の場所を指定してください");
    const key = audioKey(line, c, project.dictionary);
    const dir = await api.audioDir();
    const sep = dir.includes("\\") ? "\\" : "/";
    const res = await api.synthesize({
      exe: settings.voicepeakPath,
      chunks: splitText(speechText(line.text, project.dictionary)),
      narrator: c.narrator,
      emotions: Object.entries(line.emotions),
      speed: line.speed,
      pitch: line.pitch,
      out: `${dir}${sep}${line.id}_${Date.now()}.wav`,
    });
    return { ...line, audio: { ...res, key } };
  };

  const generateOne = async (line: Line) => {
    setBusyId(line.id);
    try {
      updateLine(await generate(line));
      setMessage("");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const generateAll = async () => {
    const byId = new Map(project.characters.map((c) => [c.id, c]));
    const targets = project.lines.filter((l) => {
      const c = byId.get(l.characterId);
      return c && l.text.trim() && l.audio?.key !== audioKey(l, c, project.dictionary);
    });
    let done = 0;
    for (const line of targets) {
      setBusyId(line.id);
      setMessage(`生成中 ${done + 1} / ${targets.length}`);
      try {
        const next = await generate(line);
        updateLines((ls) => ls.map((l) => (l.id === next.id ? { ...l, audio: next.audio } : l)));
        done++;
      } catch (e) {
        setMessage(`${done + 1} 行目で止まりました: ${errorText(e)}`);
        setBusyId(null);
        return;
      }
    }
    setBusyId(null);
    setMessage(targets.length ? `${done} 行を生成しました` : "すべて生成済みです");
  };

  // ---- ファイル ----
  const saveProject = async (as = false) => {
    if (demo) {
      setMessage("体験版では保存できません。パソコン版で使えます");
      return;
    }
    let path = projectPath;
    if (!path || as) {
      path = await save({ filters: [{ name: "プロジェクト", extensions: ["vpe.json"] }], defaultPath: "project.vpe.json" });
      if (!path) return;
    }
    await api.writeText(path, JSON.stringify(project, null, 2));
    setProjectPath(path);
    setMessage("保存しました");
  };

  const openProject = async () => {
    const path = await open({ filters: [{ name: "プロジェクト", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      setProject(parseProject(await api.readText(path)));
      setProjectPath(path);
      setSelectedId(null);
      player.seek(0);
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  const missingAudio = () => placed.some((p) => !p.line.audio);

  /** 口パクデータのない古い音声を解析して反映し、書き出しに使う全体の組み立てを返す */
  const readyModel = async (): Promise<Model> => {
    const missing = placed.filter((p) => p.line.audio && !p.line.audio.mouth);
    if (missing.length === 0 || !project.characters.some((c) => c.portrait)) return model;
    const mouths = new Map<string, string>();
    for (const p of missing) mouths.set(p.line.id, await api.analyzeMouth(p.line.audio!.path));
    const patch = (ls: Line[]) =>
      ls.map((l) => (mouths.has(l.id) && l.audio ? { ...l, audio: { ...l.audio, mouth: mouths.get(l.id) } } : l));
    updateLines(patch);
    return buildModel({ ...project, lines: patch(project.lines) });
  };

  /** 選んだ範囲（全体か章）だけにする */
  const inRange = (m: Model): Model => {
    const ch = range >= 0 ? chapters(m)[range] : undefined;
    return ch ? cropModel(m, ch.start, ch.end) : m;
  };
  const rangeName = range >= 0 && chapterList[range] ? `_${range + 1}` : "";

  const exportAs = async (kind: "exo" | "wav" | "srt" | "mp4") => {
    if (demo) return previewExport(kind);
    const out = await save({ filters: [{ name: kind.toUpperCase(), extensions: [kind] }], defaultPath: `output${rangeName}.${kind}` });
    if (!out) return;
    try {
      if (kind !== "srt" && missingAudio()) {
        setMessage("未生成の行があります。先に「すべて生成」をしてください");
        return;
      }
      setMessage("書き出し中…");
      const m = inRange(kind === "srt" ? model : await readyModel());
      const v = project.video;
      const clips = m.placed.flatMap((p) => (p.line.audio ? [{ path: p.line.audio.path, start: p.start }] : []));
      if (kind === "exo") await api.writeText(out, buildExo(m, project.characters, v, project.movie, project.bgm), "shift_jis");
      if (kind === "srt") await api.writeText(out, buildSrt(m.cues));
      if (kind === "wav") await api.exportWav(clips, m.total, out);
      if (kind === "mp4") {
        await api.exportMp4({
          ffmpeg: settings.ffmpegPath || "ffmpeg",
          portraits: project.characters.flatMap((c) =>
            c.portrait && m.frames.get(c.id)?.length
              ? [
                  {
                    frames: m.frames.get(c.id)!.map((f) => [f.start, f.end, f.value] as [number, number, string]),
                    x: c.portrait.x,
                    scale: c.portrait.scale,
                  },
                ]
              : [],
          ),
          slides: m.slides.map((s) => {
            const b = slideBox(s.value, v.width, v.height);
            return { path: s.value.path, start: s.start, end: s.end, left: b.left, top: b.top, width: b.w, height: b.h };
          }),
          clips,
          total: m.total,
          ass: buildAss(m.cues, v, m.titles),
          width: v.width,
          height: v.height,
          fps: v.fps,
          background: v.background,
          movie: project.movie && { path: project.movie.path, volume: project.movie.volume, offset: m.offset },
          bgm: project.bgm && {
            path: project.bgm.path,
            volume: project.bgm.volume,
            duck: project.bgm.duck,
            speech: m.speech,
            offset: project.bgm.duration > 0 ? m.offset % project.bgm.duration : 0,
          },
          out,
        });
      }
      setMessage(`${out} に書き出しました`);
    } catch (e) {
      setMessage(errorText(e));
    }
  };

  /** 体験版：ファイルに書く代わりに、書き出す中身をそのまま見せる */
  const previewExport = (kind: "exo" | "wav" | "srt" | "mp4") => {
    if (kind === "wav" || kind === "mp4") {
      setMessage(`${kind === "wav" ? "音声" : "動画"}の書き出しはパソコン版だけです。exo と字幕は中身を見られます`);
      return;
    }
    if (kind === "exo" && missingAudio()) {
      setMessage("未生成の行があります。先に「すべて生成」をしてください");
      return;
    }
    const m = inRange(model);
    setOutput(
      kind === "exo"
        ? { title: "AviUtl（.exo）の中身", text: friendlyPaths(buildExo(m, project.characters, project.video, project.movie, project.bgm)) }
        : { title: "字幕（.srt）の中身", text: buildSrt(m.cues) },
    );
  };

  /** 画像を選んで、その大きさと一緒に返す */
  const pickImage = async (): Promise<{ path: string; width: number; height: number } | null> => {
    const path = await open({ filters: [{ name: "画像", extensions: ["png", "webp", "jpg", "jpeg"] }] });
    if (typeof path !== "string") return null;
    try {
      const [width, height] = await api.imageSize(path);
      return { path, width, height };
    } catch (e) {
      setMessage(errorText(e));
      return null;
    }
  };

  /** 背景動画を選ぶ。画面の大きさは変えず、動画のほうを画面に収める */
  const pickMovie = async () => {
    const path = await open({ filters: [{ name: "動画", extensions: ["mp4", "mov", "webm", "m4v"] }] });
    if (typeof path !== "string") return;
    try {
      const info = await videoInfo(path);
      setProject((p) => ({
        ...p,
        movie: { path, ...info, volume: p.movie?.volume ?? 100 },
      }));
      player.seek(0);
      setMessage(`動画を読み込みました（${info.duration.toFixed(1)} 秒）。セリフを選んで「話し始める時刻」を決めると好きな場面で話します`);
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  const setMovie = (movie: Project["movie"]) => setProject((p) => ({ ...p, movie }));

  /** BGM を選ぶ。最初はやや小さめ、セリフの間はさらに小さく */
  const pickBgm = async () => {
    const path = await open({ filters: [{ name: "音声", extensions: ["mp3", "wav", "ogg", "m4a"] }] });
    if (typeof path !== "string") return;
    try {
      const { duration } = await audioInfo(path);
      setProject((p) => ({ ...p, bgm: { path, duration, volume: p.bgm?.volume ?? 40, duck: p.bgm?.duck ?? 30 } }));
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  const setBgm = (bgm: Project["bgm"]) => setProject((p) => ({ ...p, bgm }));

  // ---- 行の操作 ----
  const addLine = (afterId: string | null) => {
    const after = project.lines.find((l) => l.id === afterId);
    const c = project.characters.find((x) => x.id === after?.characterId) ?? project.characters[0];
    const line = newLine(c);
    updateLines((ls) => {
      const i = after ? ls.indexOf(after) + 1 : ls.length;
      return [...ls.slice(0, i), line, ...ls.slice(i)];
    });
    setSelectedId(line.id);
  };

  const moveLine = (id: string, delta: -1 | 1) =>
    updateLines((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + delta;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">VOICEPEAK 編集ソフト</strong>
        <button onClick={() => { setProject(emptyProject()); setProjectPath(null); }}>新規</button>
        <button onClick={openProject}>開く</button>
        <button onClick={() => saveProject()}>保存</button>
        <button onClick={() => saveProject(true)}>名前を付けて保存</button>
        <span className="sep" />
        <button onClick={() => setDialog("import")}>台本を貼り付け</button>
        <button className="primary" disabled={!!busyId} onClick={generateAll}>すべて生成</button>
        <span className="sep" />
        <button onClick={player.playing ? player.stop : player.play}>{player.playing ? "■ 停止" : "▶ 再生"}</button>
        <span className="time">{player.time.toFixed(1)} / {total.toFixed(1)} 秒</span>
        <span className="sep" />
        {chapterList.length > 0 && (
          <select value={range < chapterList.length ? range : -1} onChange={(e) => setRange(+e.target.value)} title="書き出す範囲">
            <option value={-1}>範囲：全体</option>
            {chapterList.map((c, i) => (
              <option key={i} value={i}>
                {i + 1}. {c.title}（{c.start.toFixed(0)}〜{c.end.toFixed(0)} 秒）
              </option>
            ))}
          </select>
        )}
        <select value="" onChange={(e) => e.target.value && exportAs(e.target.value as "exo")}>
          <option value="">書き出し…</option>
          <option value="exo">AviUtl（.exo）</option>
          <option value="mp4">動画（.mp4）</option>
          <option value="wav">音声（.wav）</option>
          <option value="srt">字幕（.srt）</option>
        </select>
        <button onClick={() => setDialog("dictionary")}>読み方</button>
        <button onClick={() => setDialog("settings")}>設定</button>
        {!demo && <UpdateBanner />}
        {demo && (
          <p className="demo-note">
            体験版です。声は VOICEPEAK の代わりの仮の音で、保存と書き出しはパソコン版で使えます。
          </p>
        )}
      </header>

      <main className="workspace">
        <CharacterPanel
          characters={project.characters}
          narrators={narrators}
          emotionsOf={emotionsOf}
          onChange={updateCharacter}
          onPickImage={pickImage}
          onAdd={() => setProject((p) => ({ ...p, characters: [...p.characters, newCharacter(p.characters.length, narrators[0])] }))}
          onRemove={(id) =>
            setProject((p) => ({
              ...p,
              characters: p.characters.filter((c) => c.id !== id),
              lines: p.lines.filter((l) => l.characterId !== id),
            }))
          }
        />
        <ScriptEditor
          lines={project.lines}
          characters={project.characters}
          selectedId={selectedId}
          busyId={busyId}
          currentTime={player.time}
          emotionsOf={emotionsOf}
          dictionary={project.dictionary}
          onPickImage={pickImage}
          onSelect={setSelectedId}
          onChange={updateLine}
          onAdd={addLine}
          onRemove={(id) => updateLines((ls) => ls.filter((l) => l.id !== id))}
          onMove={moveLine}
          onGenerate={generateOne}
          onPlay={(l) => l.audio && playOnce(l.audio.path)}
        />
        <section className="panel side">
          <Preview
            model={model}
            characters={project.characters}
            time={player.time}
            playing={player.playing}
            video={project.video}
            movie={project.movie}
            bgm={project.bgm}
          />
          <div className="movie-box">
            <h2>背景動画</h2>
            {project.movie ? (
              <>
                <span className="name" title={project.movie.path}>
                  {fileName(project.movie.path)}（{project.movie.duration.toFixed(1)} 秒）
                </span>
                <label>
                  もとの音の大きさ {project.movie.volume}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={project.movie.volume}
                    onChange={(e) => setMovie({ ...project.movie!, volume: +e.target.value })}
                  />
                </label>
                <div className="row">
                  <button onClick={pickMovie}>別の動画にする</button>
                  <button onClick={() => setMovie(undefined)}>外す</button>
                </div>
              </>
            ) : (
              <>
                <p className="hint">動画を読み込むと、その上にセリフ・字幕・立ち絵を重ねられます。</p>
                <div className="row">
                  <button onClick={pickMovie}>動画を読み込む</button>
                </div>
              </>
            )}
          </div>
          <div className="movie-box">
            <h2>BGM</h2>
            {project.bgm ? (
              <>
                <span className="name" title={project.bgm.path}>
                  {fileName(project.bgm.path)}（{project.bgm.duration.toFixed(1)} 秒・くり返し）
                </span>
                <label>
                  音量 {project.bgm.volume}%
                  <input type="range" min={0} max={100} value={project.bgm.volume} onChange={(e) => setBgm({ ...project.bgm!, volume: +e.target.value })} />
                </label>
                <label>
                  セリフの間 {project.bgm.duck}%（BGM の音量に対して）
                  <input type="range" min={0} max={100} value={project.bgm.duck} onChange={(e) => setBgm({ ...project.bgm!, duck: +e.target.value })} />
                </label>
                <div className="row">
                  <button onClick={pickBgm}>別の曲にする</button>
                  <button onClick={() => setBgm(undefined)}>外す</button>
                </div>
              </>
            ) : (
              <>
                <p className="hint">BGM はくり返し流れ、セリフの間は自動で小さくなります。</p>
                <div className="row">
                  <button onClick={pickBgm}>BGM を読み込む</button>
                </div>
              </>
            )}
          </div>
          <label className="zoom">
            拡大
            <input type="range" min={10} max={200} value={pxPerSec} onChange={(e) => setPxPerSec(+e.target.value)} />
          </label>
        </section>
      </main>

      <Timeline
        placed={placed}
        characters={project.characters}
        total={total}
        time={player.time}
        selectedId={selectedId}
        movie={project.movie}
        pxPerSec={pxPerSec}
        onSeek={player.seek}
        onSelect={setSelectedId}
        onMoveStart={(id, at) => updateLines((ls) => ls.map((l) => (l.id === id ? { ...l, at } : l)))}
      />

      <footer className="status">{message || "準備完了"}</footer>

      {dialog === "settings" && (
        <SettingsDialog
          settings={settings}
          project={project}
          onClose={() => setDialog(null)}
          onSave={(s, video) => {
            setSettings(s);
            setProject((p) => ({ ...p, video }));
            setDialog(null);
          }}
        />
      )}
      {output && (
        <div className="modal" onMouseDown={() => setOutput(null)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{output.title}</h2>
            <p className="hint">パソコン版ではこの内容がファイルに保存されます。</p>
            <textarea className="output" readOnly rows={16} value={output.text} />
            <footer>
              <button className="primary" onClick={() => setOutput(null)}>閉じる</button>
            </footer>
          </div>
        </div>
      )}
      {dialog === "dictionary" && (
        <DictionaryDialog
          dictionary={project.dictionary ?? []}
          onClose={() => setDialog(null)}
          onSave={(dictionary) => {
            setProject((p) => ({ ...p, dictionary }));
            setDialog(null);
            setMessage("読み方を保存しました。読みが変わった行は「すべて生成」で作り直されます");
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          characters={project.characters}
          onClose={() => setDialog(null)}
          onImport={(lines, replace) => {
            updateLines((ls) => (replace ? lines : [...ls, ...lines]));
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function SettingsDialog(props: {
  settings: Settings;
  project: Project;
  onClose: () => void;
  onSave: (s: Settings, video: Project["video"]) => void;
}) {
  const [s, setS] = useState(props.settings);
  const [v, setV] = useState(props.project.video);
  const pickExe = async (key: keyof Settings) => {
    const p = await open({ filters: [{ name: "実行ファイル", extensions: ["exe", "*"] }] });
    if (typeof p === "string") setS({ ...s, [key]: p });
  };
  return (
    <div className="modal" onMouseDown={props.onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>設定</h2>
        <label>
          VOICEPEAK の場所
          <div className="row">
            <input value={s.voicepeakPath} placeholder="C:\Program Files\VOICEPEAK\voicepeak.exe" onChange={(e) => setS({ ...s, voicepeakPath: e.target.value })} />
            <button onClick={() => pickExe("voicepeakPath")}>参照</button>
          </div>
        </label>
        <label>
          ffmpeg の場所（MP4 書き出し用）
          <div className="row">
            <input value={s.ffmpegPath} onChange={(e) => setS({ ...s, ffmpegPath: e.target.value })} />
            <button onClick={() => pickExe("ffmpegPath")}>参照</button>
          </div>
        </label>
        <h3>動画</h3>
        <div className="grid">
          <label>幅<input type="number" value={v.width} onChange={(e) => setV({ ...v, width: +e.target.value })} /></label>
          <label>高さ<input type="number" value={v.height} onChange={(e) => setV({ ...v, height: +e.target.value })} /></label>
          <label>フレームレート<input type="number" value={v.fps} onChange={(e) => setV({ ...v, fps: +e.target.value })} /></label>
          <label>背景色<input type="color" value={v.background} onChange={(e) => setV({ ...v, background: e.target.value })} /></label>
          <label>フォント<input value={v.font} onChange={(e) => setV({ ...v, font: e.target.value })} /></label>
          <label>文字サイズ<input type="number" value={v.fontSize} onChange={(e) => setV({ ...v, fontSize: +e.target.value })} /></label>
        </div>
        <footer>
          <button onClick={props.onClose}>キャンセル</button>
          <button className="primary" onClick={() => props.onSave(s, v)}>保存</button>
        </footer>
      </div>
    </div>
  );
}

function ImportDialog(props: {
  characters: Character[];
  onClose: () => void;
  onImport: (lines: Line[], replace: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const names = props.characters.map((c) => c.name);
  return (
    <div className="modal" onMouseDown={props.onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>台本を貼り付け</h2>
        <p className="hint">
          1 行に 1 セリフ。「{names[0]}：セリフ」のように名前をつけるとそのキャラで読みます（使える名前: {names.join("、")}）。
        </p>
        <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${names[0]}：こんにちは\n${names[1] ?? names[0]}：よろしく`} />
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          今の台本を置き換える
        </label>
        <footer>
          <button onClick={props.onClose}>キャンセル</button>
          <button className="primary" disabled={!text.trim()} onClick={() => props.onImport(importScript(text, props.characters), replace)}>
            取り込む
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 読み方の辞書。字幕は表記のまま、声だけ読み方で読ませる */
function DictionaryDialog(props: { dictionary: Reading[]; onClose: () => void; onSave: (d: Reading[]) => void }) {
  const [rows, setRows] = useState<Reading[]>(() => (props.dictionary.length ? props.dictionary : [{ word: "", reading: "" }]));
  const set = (i: number, r: Reading) => setRows(rows.map((x, k) => (k === i ? r : x)));
  return (
    <div className="modal" onMouseDown={props.onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>読み方</h2>
        <p className="hint">
          字幕は「表記」のまま出し、声だけ「読み方」で読みます。1 か所だけ変えたいときは、セリフに「{"{"}鴎外|おうがい{"}"}」のように書けます。
        </p>
        <div className="dict-scroll">
          <table className="dict-table">
            <thead>
              <tr>
                <td className="hint">表記</td>
                <td className="hint">読み方</td>
                <td />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <input value={r.word} placeholder="鴎外" onChange={(e) => set(i, { ...r, word: e.target.value })} />
                  </td>
                  <td>
                    <input value={r.reading} placeholder="おうがい" onChange={(e) => set(i, { ...r, reading: e.target.value })} />
                  </td>
                  <td>
                    <button className="danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={() => setRows([...rows, { word: "", reading: "" }])}>＋ 追加</button>
        <footer>
          <button onClick={props.onClose}>キャンセル</button>
          <button className="primary" onClick={() => props.onSave(rows.filter((r) => r.word.trim() && r.reading.trim()))}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
