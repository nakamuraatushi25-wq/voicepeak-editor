interface Props {
  names: string[];
  values: Record<string, number>;
  onChange: (v: Record<string, number>) => void;
}

/** ナレーターごとの感情パラメータ（0〜100） */
export function EmotionSliders({ names, values, onChange }: Props) {
  if (names.length === 0) {
    return <p className="hint">感情は VOICEPEAK の場所を設定すると選べます。</p>;
  }
  return (
    <div className="emotions">
      {names.map((name) => (
        <label key={name}>
          {name} {values[name] ?? 0}
          <input
            type="range"
            min={0}
            max={100}
            value={values[name] ?? 0}
            onChange={(e) => onChange({ ...values, [name]: +e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}
