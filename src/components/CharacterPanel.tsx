import { convertFileSrc } from "@tauri-apps/api/core";
import type { Character, MouthImages, Portrait } from "../types";
import { fileName } from "../lib/media";
import { EmotionSliders } from "./EmotionSliders";

interface Props {
  characters: Character[];
  narrators: string[];
  emotionsOf: (narrator: string) => string[];
  onChange: (c: Character) => void;
  onPickImage: () => Promise<{ path: string; width: number; height: number } | null>;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function CharacterPanel({ characters, narrators, emotionsOf, onChange, onPickImage, onAdd, onRemove }: Props) {
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
          <PortraitEditor
            character={c}
            index={characters.indexOf(c)}
            onPick={onPickImage}
            onChange={(portrait) => onChange({ ...c, portrait })}
          />
          <button className="danger" disabled={characters.length <= 1} onClick={() => onRemove(c.id)}>
            このキャラを削除
          </button>
        </details>
      ))}
    </section>
  );
}

const SLOTS: { key: "closed" | "half" | "open"; label: string }[] = [
  { key: "closed", label: "口閉じ" },
  { key: "half", label: "半開き（なくてもOK）" },
  { key: "open", label: "口開き" },
];

type Picked = { path: string; width: number; height: number };

/** 口の形 3 枚の画像を選ぶ枠 */
function MouthSlots(props: { images?: Partial<MouthImages>; onPick: (key: (typeof SLOTS)[number]["key"]) => void }) {
  return (
    <div className="slots">
      {SLOTS.map((s) => {
        const file = props.images?.[s.key];
        return (
          <button key={s.key} className="slot" onClick={() => props.onPick(s.key)} title={file ? fileName(file) : "画像を選ぶ"}>
            {file ? <img src={convertFileSrc(file)} alt={s.label} /> : <span>＋</span>}
            <small>{s.label}</small>
          </button>
        );
      })}
    </div>
  );
}

/** 立ち絵の画像と位置。口閉じと口開きの 2 枚があれば口パクする。表情差分も追加できる */
function PortraitEditor(props: {
  character: Character;
  index: number;
  onPick: Props["onPickImage"];
  onChange: (p: Portrait | undefined) => void;
}) {
  const p = props.character.portrait;
  const pick = async (key: (typeof SLOTS)[number]["key"]) => {
    const img: Picked | null = await props.onPick();
    if (!img) return;
    const base: Portrait = p ?? {
      closed: img.path,
      open: img.path,
      width: img.width,
      height: img.height,
      // 1 人目は右、2 人目は左…と交互に置く
      x: props.index % 2 === 0 ? 0.8 : 0.2,
      scale: 100,
    };
    props.onChange({ ...base, [key]: img.path, width: img.width, height: img.height });
  };
  const expressions = Object.entries(p?.expressions ?? {});
  const setExpressions = (list: [string, MouthImages][]) => p && props.onChange({ ...p, expressions: Object.fromEntries(list) });
  const pickExpression = async (index: number, key: (typeof SLOTS)[number]["key"]) => {
    const img = await props.onPick();
    if (!img) return;
    setExpressions(expressions.map(([name, e], i) => [name, i === index ? { ...e, [key]: img.path } : e]));
  };
  const addExpression = () => {
    if (!p) return;
    let n = expressions.length + 1;
    while (p.expressions?.[`表情${n}`]) n++;
    setExpressions([...expressions, [`表情${n}`, { closed: p.closed, open: p.open, half: p.half }]]);
  };
  return (
    <div className="portrait-editor">
      <h3>立ち絵</h3>
      <MouthSlots images={p} onPick={pick} />
      {p ? (
        <>
          {p.closed === p.open && <p className="hint">口開きの画像も選ぶと口パクします。</p>}
          <label>
            横位置 {Math.round(p.x * 100)}%
            <input type="range" min={0} max={100} value={Math.round(p.x * 100)} onChange={(e) => props.onChange({ ...p, x: +e.target.value / 100 })} />
          </label>
          <label>
            大きさ {p.scale}%
            <input type="range" min={10} max={300} value={p.scale} onChange={(e) => props.onChange({ ...p, scale: +e.target.value })} />
          </label>
          <div className="expressions">
            <h3>表情差分</h3>
            <p className="hint">名前をつけた表情を作ると、セリフごとに選べます（「笑顔」「驚き」など）。画像はいつもの絵と同じ大きさにしてください。</p>
            {expressions.map(([name, e], i) => (
              <div key={i} className="expression">
                <div className="row">
                  <input
                    value={name}
                    onChange={(ev) => setExpressions(expressions.map(([n, x], k) => [k === i ? ev.target.value : n, x]))}
                  />
                  <button className="danger" onClick={() => setExpressions(expressions.filter((_, k) => k !== i))}>
                    削除
                  </button>
                </div>
                <MouthSlots images={e} onPick={(key) => pickExpression(i, key)} />
              </div>
            ))}
            <button onClick={addExpression}>＋ 表情を追加</button>
          </div>
          <button onClick={() => props.onChange(undefined)}>立ち絵を外す</button>
        </>
      ) : (
        <p className="hint">同じ大きさの PNG を口の形ごとに用意してください。</p>
      )}
    </div>
  );
}
