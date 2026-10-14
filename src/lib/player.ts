import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PlacedLine } from "../types";

/** タイムラインを再生する。各行の開始時刻を過ぎたらその行の音声を鳴らす */
export function usePlayer(placed: PlacedLine[], total: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const origin = useRef(0);
  const fromTime = useRef(0);
  const started = useRef(new Set<string>());
  const audios = useRef<HTMLAudioElement[]>([]);

  const stopAudio = () => {
    audios.current.forEach((a) => a.pause());
    audios.current = [];
  };

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stopAudio();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stopAudio();
    fromTime.current = time >= total ? 0 : time;
    origin.current = performance.now();
    // 再生位置より前に始まった行は鳴らさない
    started.current = new Set(placed.filter((p) => p.start < fromTime.current).map((p) => p.line.id));
    setPlaying(true);
    const tick = () => {
      const t = fromTime.current + (performance.now() - origin.current) / 1000;
      for (const p of placed) {
        if (t >= p.start && !started.current.has(p.line.id)) {
          started.current.add(p.line.id);
          if (p.line.audio) {
            const a = new Audio(convertFileSrc(p.line.audio.path));
            a.play().catch(() => undefined);
            audios.current.push(a);
          }
        }
      }
      if (t >= total) {
        setTime(total);
        setPlaying(false);
        return;
      }
      setTime(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [placed, time, total]);

  const seek = useCallback(
    (t: number) => {
      stop();
      setTime(Math.max(0, Math.min(total, t)));
    },
    [stop, total],
  );

  useEffect(() => stop, [stop]);

  return { time, playing, play, stop, seek };
}

/** 1 行だけ試聴する */
export function playOnce(path: string) {
  new Audio(convertFileSrc(path)).play().catch(() => undefined);
}
