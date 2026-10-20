import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Bgm, Character, Movie, VideoSettings } from "../types";
import { slideBox, spanAt, type Model } from "../lib/scene";

interface Props {
  model: Model;
  characters: Character[];
  time: number;
  playing: boolean;
  video: VideoSettings;
  movie?: Movie;
  bgm?: Bgm;
}

/** 書き出し結果に近い見た目で、背景動画・画像・立ち絵・字幕・見出しを重ねて表示する */
export function Preview({ model, characters, time, playing, video, movie, bgm }: Props) {
  const current = model.cues.find((c) => time >= c.start && time < c.end);
  const slide = spanAt(model.slides, time);
  const title = spanAt(model.titles, time);
  const speaking = model.speech.some(([s, e]) => time >= s && time < e);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className="preview" style={{ aspectRatio: `${video.width} / ${video.height}`, background: video.background }}>
      {movie && <MoviePlayer movie={movie} time={time} playing={playing} />}
      {bgm && <BgmPlayer bgm={bgm} time={time} playing={playing} speaking={speaking} />}
      {slide &&
        (() => {
          const b = slideBox(slide, video.width, video.height);
          return (
            <img
              className="slide"
              src={convertFileSrc(slide.path)}
              alt=""
              style={{ left: pct(b.left, video.width), top: pct(b.top, video.height), width: pct(b.w, video.width), height: pct(b.h, video.height) }}
            />
          );
        })()}
      {characters.map((c) => {
        const p = c.portrait;
        const file = spanAt(model.frames.get(c.id) ?? [], Math.min(time, model.total - 1e-6));
        if (!p || !file) return null;
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
      {title && (
        <div className="title-telop" style={{ fontFamily: video.font, fontSize: `${((video.fontSize * 0.8) / video.height) * 100}cqh` }}>
          {title}
        </div>
      )}
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

/** 再生中はメディアに任せ、ずれたときと止まっているときだけ位置を合わせる */
function useSync(ref: React.RefObject<HTMLMediaElement | null>, position: number, playing: boolean, volume: number) {
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.volume = Math.max(0, Math.min(1, volume));
    if (playing) {
      if (Math.abs(m.currentTime - position) > 0.25) m.currentTime = position;
      if (m.paused) m.play().catch(() => undefined);
    } else {
      if (!m.paused) m.pause();
      if (Math.abs(m.currentTime - position) > 0.04) m.currentTime = position;
    }
  }, [ref, position, playing, volume]);
}

function MoviePlayer({ movie, time, playing }: { movie: Movie; time: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const inRange = time < movie.duration;
  useSync(ref, Math.min(time, movie.duration), playing && inRange, movie.volume / 100);
  return <video ref={ref} className="movie" src={convertFileSrc(movie.path)} preload="auto" playsInline />;
}

/** BGM はループさせ、誰かが話している間は小さくする */
function BgmPlayer({ bgm, time, playing, speaking }: { bgm: Bgm; time: number; playing: boolean; speaking: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const position = bgm.duration > 0 ? time % bgm.duration : 0;
  const volume = (bgm.volume / 100) * (speaking ? bgm.duck / 100 : 1);
  useSync(ref, position, playing, volume);
  return <audio ref={ref} src={convertFileSrc(bgm.path)} loop preload="auto" />;
}
