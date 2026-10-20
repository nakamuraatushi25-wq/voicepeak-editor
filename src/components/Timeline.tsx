import { useRef, useState } from "react";
import type { Character, Movie, PlacedLine } from "../types";
import { fileName } from "../lib/media";
import { displayText } from "../lib/reading";

interface Props {
  placed: PlacedLine[];
  characters: Character[];
  movie?: Movie;
  total: number;
  time: number;
  selectedId: string | null;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  /** クリップを左右に動かしたとき。話し始める時刻（秒）を返す */
  onMoveStart: (id: string, at: number) => void;
}

const LANE_HEIGHT = 36;
const RULER = 24;

export function Timeline(props: Props) {
  const { placed, characters, movie, total, time, selectedId, pxPerSec, onSeek, onSelect } = props;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; start: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; at: number } | null>(null);
  const width = Math.max(600, (total + 5) * pxPerSec);
  const top = RULER + (movie ? LANE_HEIGHT : 0);

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / pxPerSec);
  };

  // クリップをつまんで左右に動かすと、その時刻から話すようになる。動かさずに離せば選択だけ
  const onPointerDown = (e: React.PointerEvent, p: PlacedLine) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: p.line.id, x: e.clientX, start: p.start, moved: false };
    onSelect(p.line.id);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    setDragging({ id: d.id, at: Math.max(0, Math.round((d.start + dx / pxPerSec) * 10) / 10) });
  };
  const onPointerUp = () => {
    if (drag.current?.moved && dragging) props.onMoveStart(dragging.id, dragging.at);
    drag.current = null;
    setDragging(null);
  };

  return (
    <section className="panel timeline">
      <div className="lane-names">
        <div className="ruler-space" />
        {movie && (
          <div className="lane-name" style={{ height: LANE_HEIGHT }}>
            動画
          </div>
        )}
        {characters.map((c) => (
          <div key={c.id} className="lane-name" style={{ height: LANE_HEIGHT, color: c.color }}>
            {c.name}
          </div>
        ))}
      </div>
      <div className="scroll">
        <div ref={ref} className="tracks" style={{ width }}>
          <div className="ruler" onMouseDown={seekFromEvent}>
            {Array.from({ length: Math.ceil(width / pxPerSec) }, (_, s) => (
              <span key={s} style={{ left: s * pxPerSec }}>
                {s % 5 === 0 ? `${s}s` : ""}
              </span>
            ))}
          </div>
          {movie && (
            <div className="lane" style={{ height: LANE_HEIGHT }} onMouseDown={seekFromEvent}>
              <div
                className="movie-clip"
                style={{ left: 0, width: movie.duration * pxPerSec, top: RULER + 3, height: LANE_HEIGHT - 6, lineHeight: `${LANE_HEIGHT - 6}px` }}
              >
                {fileName(movie.path)}
              </div>
            </div>
          )}
          {characters.map((c) => (
            <div key={c.id} className="lane" style={{ height: LANE_HEIGHT }} onMouseDown={seekFromEvent} />
          ))}
          {placed.map((p) => {
            const at = dragging?.id === p.line.id ? dragging.at : p.start;
            return (
              <div
                key={p.line.id}
                className={[
                  "clip",
                  p.line.audio ? "" : "pending",
                  p.line.id === selectedId ? "selected" : "",
                  p.line.at !== undefined ? "timed" : "",
                ].join(" ")}
                title={displayText(p.line.text)}
                style={{
                  left: at * pxPerSec,
                  width: Math.max(4, (p.end - p.start) * pxPerSec),
                  top: top + p.layer * LANE_HEIGHT + 3,
                  height: LANE_HEIGHT - 6,
                  background: p.character.color,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => onPointerDown(e, p)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {displayText(p.line.text)}
              </div>
            );
          })}
          <div className="playhead" style={{ left: time * pxPerSec }} />
        </div>
      </div>
    </section>
  );
}
