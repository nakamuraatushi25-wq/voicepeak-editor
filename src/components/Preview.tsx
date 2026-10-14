import type { PlacedLine, VideoSettings } from "../types";

interface Props {
  placed: PlacedLine[];
  time: number;
  video: VideoSettings;
}

/** 書き出し結果に近い見た目で、いまの字幕を表示する */
export function Preview({ placed, time, video }: Props) {
  const current = placed.find((p) => time >= p.start && time < p.end);
  return (
    <div className="preview" style={{ aspectRatio: `${video.width} / ${video.height}`, background: video.background }}>
      {current && (
        <div
          className="subtitle"
          style={{
            fontFamily: video.font,
            fontSize: `${(video.fontSize / video.height) * 100}cqh`,
            WebkitTextStroke: `${(4 / video.height) * 100}cqh ${current.character.color}`,
          }}
        >
          {current.line.text}
        </div>
      )}
    </div>
  );
}
