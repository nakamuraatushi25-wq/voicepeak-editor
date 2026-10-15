import { convertFileSrc } from "@tauri-apps/api/core";
import type { Character, PlacedLine, VideoSettings } from "../types";
import type { Cue } from "../lib/subtitle";
import { mouthAt } from "../lib/mouth";

interface Props {
  placed: PlacedLine[];
  cues: Cue[];
  characters: Character[];
  time: number;
  video: VideoSettings;
}

/** 書き出し結果に近い見た目で、立ち絵といまの字幕を表示する */
export function Preview({ placed, cues, characters, time, video }: Props) {
  const current = cues.find((c) => time >= c.start && time < c.end);
  return (
    <div className="preview" style={{ aspectRatio: `${video.width} / ${video.height}`, background: video.background }}>
      {characters.map((c) => {
        const p = c.portrait;
        if (!p) return null;
        const level = mouthAt(placed, c, time);
        const file = level === 0 ? p.closed : level === 1 ? (p.half ?? p.open) : p.open;
        const h = (p.height * p.scale) / 100 / video.height;
        return (
          <img
            key={c.id}
            className="portrait"
            src={convertFileSrc(file)}
            alt={c.name}
            style={{ height: `${h * 100}%`, left: `${p.x * 100}%` }}
          />
        );
      })}
      {current && (
        <div
          className="subtitle"
          style={{
            fontFamily: video.font,
            fontSize: `${(video.fontSize / video.height) * 100}cqh`,
            WebkitTextStroke: `${(4 / video.height) * 100}cqh ${current.character.color}`,
          }}
        >
          {current.text}
        </div>
      )}
    </div>
  );
}
