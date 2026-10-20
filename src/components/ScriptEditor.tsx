import { Fragment } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Character, Line, Reading } from "../types";
import { audioKey } from "../lib/timeline";
import { fileName } from "../lib/media";
import { EmotionSliders } from "./EmotionSliders";

interface Props {
  lines: Line[];
  characters: Character[];
  selectedId: string | null;
  busyId: string | null;
  /** 再生位置（「今の位置から話す」用） */
  currentTime: number;
  emotionsOf: (narrator: string) => string[];
  dictionary?: Reading[];
  /** 画像（スライド）を選ぶ */
  onPickImage: () => Promise<{ path: string; width: number; height: number } | null>;
  onSelect: (id: string) => void;
  onChange: (line: Line) => void;
  onAdd: (afterId: string | null) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onGenerate: (line: Line) => void;
  onPlay: (line: Line) => void;
}

export function ScriptEditor(props: Props) {
  const { lines, characters, selectedId, busyId, emotionsOf } = props;
  const byId = new Map(characters.map((c) => [c.id, c]));

  return (
    <section className="panel script">
      <header>
        <h2>台本</h2>
        <button onClick={() => props.onAdd(selectedId)}>＋ 行を追加</button>
      </header>
      <ol>
        {lines.map((line) => {
          const c = byId.get(line.characterId) ?? characters[0];
          const fresh = line.audio && line.audio.key === audioKey(line, c, props.dictionary);
          const selected = line.id === selectedId;
          const expressions = Object.keys(c.portrait?.expressions ?? {});
          const pickSlide = async () => {
            const img = await props.onPickImage();
            if (img) props.onChange({ ...line, slide: { ...img, scale: line.slide?.scale ?? 90 } });
          };
          const marks = [
            line.slide ? `🖼 ${fileName(line.slide.path)}` : line.slide === null ? "🖼 画像を消す" : "",
            line.title === "" ? "見出しを消す" : "",
            line.expression ? `😀 ${line.expression}` : "",
          ].filter(Boolean);
          return (
            <Fragment key={line.id}>
            {line.title && <li className="chapter-head">▍{line.title}</li>}
            <li
              className={selected ? "line selected" : "line"}
              style={{ borderLeftColor: c.color }}
              onClick={() => props.onSelect(line.id)}
            >
              <div className="row">
                <select
                  value={line.characterId}
                  onChange={(e) => {
                    const next = byId.get(e.target.value)!;
                    props.onChange({ ...line, characterId: next.id, emotions: { ...next.emotions }, speed: next.speed, pitch: next.pitch });
                  }}
                >
                  {characters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={Math.min(4, Math.max(1, Math.ceil(line.text.length / 22)))}
                  value={line.text}
                  placeholder="セリフを入力"
                  onChange={(e) => props.onChange({ ...line, text: e.target.value })}
                />
                <span className={fresh ? "badge ok" : "badge"} title={line.at !== undefined ? `${line.at.toFixed(1)}秒から話す` : undefined}>
                  {line.at !== undefined && "⏱ "}
                  {busyId === line.id ? "生成中…" : fresh ? `${line.audio!.duration.toFixed(1)}秒` : "未生成"}
                </span>
                <button title="この行を生成" disabled={!!busyId || !line.text.trim()} onClick={() => props.onGenerate(line)}>
                  🔊
                </button>
                <button title="試聴" disabled={!line.audio} onClick={() => props.onPlay(line)}>
                  ▶
                </button>
              </div>
              {marks.length > 0 && !selected && <div className="marks">{marks.map((m) => <span key={m}>{m}</span>)}</div>}
              {selected && (
                <div className="details">
                  <div className="scene-row">
                    <span>見出し（章）</span>
                    <select
                      value={line.title === undefined ? "keep" : line.title === "" ? "clear" : "set"}
                      onChange={(e) => {
                        const v = e.target.value;
                        props.onChange({ ...line, title: v === "keep" ? undefined : v === "clear" ? "" : line.title || "新しい章" });
                      }}
                    >
                      <option value="keep">前のまま</option>
                      <option value="set">この行から変える</option>
                      <option value="clear">この行で消す</option>
                    </select>
                    {line.title && <input type="text" value={line.title} onChange={(e) => props.onChange({ ...line, title: e.target.value || "新しい章" })} />}
                  </div>
                  <div className="scene-row">
                    <span>画像</span>
                    <select
                      value={line.slide === undefined ? "keep" : line.slide === null ? "clear" : "set"}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "set") pickSlide();
                        else props.onChange({ ...line, slide: v === "keep" ? undefined : null });
                      }}
                    >
                      <option value="keep">前のまま</option>
                      <option value="set">この行から出す</option>
                      <option value="clear">この行で消す</option>
                    </select>
                    {line.slide && (
                      <>
                        <img src={convertFileSrc(line.slide.path)} alt="" />
                        <button onClick={pickSlide}>別の画像</button>
                        <label>
                          大きさ {line.slide.scale}%
                          <input
                            type="range"
                            min={20}
                            max={100}
                            value={line.slide.scale}
                            onChange={(e) => props.onChange({ ...line, slide: { ...line.slide!, scale: +e.target.value } })}
                          />
                        </label>
                      </>
                    )}
                  </div>
                  {expressions.length > 0 && (
                    <div className="scene-row">
                      <span>表情</span>
                      <select value={line.expression ?? ""} onChange={(e) => props.onChange({ ...line, expression: e.target.value || undefined })}>
                        <option value="">いつもの絵</option>
                        {expressions.map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <label>
                    速さ {line.speed}
                    <input type="range" min={50} max={200} value={line.speed} onChange={(e) => props.onChange({ ...line, speed: +e.target.value })} />
                  </label>
                  <label>
                    高さ {line.pitch}
                    <input type="range" min={-300} max={300} value={line.pitch} onChange={(e) => props.onChange({ ...line, pitch: +e.target.value })} />
                  </label>
                  <label>
                    後の間 {line.pause.toFixed(1)}秒
                    <input type="range" min={0} max={3} step={0.1} value={line.pause} onChange={(e) => props.onChange({ ...line, pause: +e.target.value })} />
                  </label>
                  <div className="start-row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={line.at !== undefined}
                        onChange={(e) =>
                          props.onChange({ ...line, at: e.target.checked ? Math.round(props.currentTime * 10) / 10 : undefined })
                        }
                      />
                      話し始める時刻を決める
                    </label>
                    {line.at !== undefined && (
                      <>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={line.at}
                          onChange={(e) => props.onChange({ ...line, at: Math.max(0, +e.target.value) })}
                        />
                        秒から
                        <button onClick={() => props.onChange({ ...line, at: Math.round(props.currentTime * 10) / 10 })}>
                          今の再生位置にする
                        </button>
                      </>
                    )}
                  </div>
                  <EmotionSliders names={emotionsOf(c.narrator)} values={line.emotions} onChange={(emotions) => props.onChange({ ...line, emotions })} />
                  <div className="actions">
                    <button onClick={() => props.onMove(line.id, -1)}>↑ 上へ</button>
                    <button onClick={() => props.onMove(line.id, 1)}>↓ 下へ</button>
                    <button className="danger" onClick={() => props.onRemove(line.id)}>
                      削除
                    </button>
                  </div>
                </div>
              )}
            </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
