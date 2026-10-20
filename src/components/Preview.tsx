import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Character, Movie, PlacedLine, VideoSettings } from "../types";
import type { Cue } from "../lib/subtitle";
import { mouthAt } from "../lib/mouth";

interface Props {
  placed: PlacedLine[];
  cues: Cue[];
  characters: Character[];
  time: number;
  playing: boolean;
  video: VideoSettings;
  movie?: Movie;
}

/** 書き出し結果に近い見た目で、立ち絵といまの字幕を表示する */
export function Preview({ placed, cues, characters, time, playing, video, movie }: Props) {
  const current = cues.find((c) => time >= c.start && time < c.end);
  return (
    <div className="preview" style={{ aspectRatio: `${video.width} / ${video.height}`, background: video.background }}>
      {movie && <MoviePlayer movie={movie} time={time} playing={playing} />}
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

/** 背景動画。再生中は動画に任せ、ずれたときと止まっているときだけ位置を合わせる */
function MoviePlayer({ movie, time, playing }: { movie: Movie; time: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const inRange = time < movie.duration;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, movie.volume / 100));
    if (playing && inRange) {
      if (Math.abs(v.currentTime - time) > 0.25) v.currentTime = time;
      if (v.paused) v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - time) > 0.04) v.currentTime = Math.min(time, movie.duration);
    }
  }, [time, playing, inRange, movie.volume, movie.duration]);

  return <video ref={ref} className="movie" src={convertFileSrc(movie.path)} preload="auto" playsInline />;
}
