import type { Character } from "../types";
import { EmotionSliders } from "./EmotionSliders";

interface Props {
  characters: Character[];
  narrators: string[];
  emotionsOf: (narrator: string) => string[];
  onChange: (c: Character) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function CharacterPanel({ characters, narrators, emotionsOf, onChange, onAdd, onRemove }: Props) {
  return (
    <section className="panel characters">
      <header>
        <h2>キャラクター</h2>
        <button onClick={onAdd}>＋ 追加</button>
      </header>
      {characters.map((c) => (
        <details key={c.id} className="character" style={{ borderLeftColor: c.color }}>
          <summary>
            <span className="dot" style={{ background: c.color }} />
            {c.name}
            <small>{c.narrator}</small>
          </summary>
          <label>
            名前
            <input value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} />
          </label>
          <label>
            ナレーター
            {narrators.length > 0 ? (
              <select value={c.narrator} onChange={(e) => onChange({ ...c, narrator: e.target.value, emotions: {} })}>
                {!narrators.includes(c.narrator) && <option>{c.narrator}</option>}
                {narrators.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input value={c.narrator} onChange={(e) => onChange({ ...c, narrator: e.target.value })} />
            )}
          </label>
          <label>
            字幕の色
            <input type="color" value={c.color} onChange={(e) => onChange({ ...c, color: e.target.value })} />
          </label>
          <p className="hint">ここの値は新しく追加する行の初期値になります。</p>
          <label>
            速さ {c.speed}
            <input type="range" min={50} max={200} value={c.speed} onChange={(e) => onChange({ ...c, speed: +e.target.value })} />
          </label>
          <label>
            高さ {c.pitch}
            <input type="range" min={-300} max={300} value={c.pitch} onChange={(e) => onChange({ ...c, pitch: +e.target.value })} />
          </label>
          <EmotionSliders
            names={emotionsOf(c.narrator)}
            values={c.emotions}
            onChange={(emotions) => onChange({ ...c, emotions })}
          />
          <button className="danger" disabled={characters.length <= 1} onClick={() => onRemove(c.id)}>
            このキャラを削除
          </button>
        </details>
      ))}
    </section>
  );
}
