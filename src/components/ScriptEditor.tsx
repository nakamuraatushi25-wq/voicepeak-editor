import type { Character, Line } from "../types";
import { audioKey } from "../lib/timeline";
import { EmotionSliders } from "./EmotionSliders";

interface Props {
  lines: Line[];
  characters: Character[];
  selectedId: string | null;
  busyId: string | null;
  /** 再生位置（「今の位置から話す」用） */
  currentTime: number;
  emotionsOf: (narrator: string) => string[];
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
          const fresh = line.audio && line.audio.key === audioKey(line, c);
          const selected = line.id === selectedId;
          return (
            <li
              key={line.id}
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
              {selected && (
                <div className="details">
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
          );
        })}
      </ol>
    </section>
  );
}
