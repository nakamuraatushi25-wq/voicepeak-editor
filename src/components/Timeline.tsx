import { useRef } from "react";
import type { Character, PlacedLine } from "../types";

interface Props {
  placed: PlacedLine[];
  characters: Character[];
  total: number;
  time: number;
  selectedId: string | null;
  pxPerSec: number;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
}

const LANE_HEIGHT = 36;

export function Timeline({ placed, characters, total, time, selectedId, pxPerSec, onSeek, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = Math.max(600, (total + 5) * pxPerSec);

  const seekFromEvent = (e: React.MouseEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    onSeek((e.clientX - rect.left) / pxPerSec);
  };

  return (
    <section className="panel timeline">
      <div className="lane-names">
        <div className="ruler-space" />
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
          {characters.map((c) => (
            <div key={c.id} className="lane" style={{ height: LANE_HEIGHT }} onMouseDown={seekFromEvent} />
          ))}
          {placed.map((p) => (
            <div
              key={p.line.id}
              className={[
                "clip",
                p.line.audio ? "" : "pending",
                p.line.id === selectedId ? "selected" : "",
              ].join(" ")}
              title={p.line.text}
              style={{
                left: p.start * pxPerSec,
                width: Math.max(4, (p.end - p.start) * pxPerSec),
                top: 24 + p.layer * LANE_HEIGHT + 3,
                height: LANE_HEIGHT - 6,
                background: p.character.color,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                onSelect(p.line.id);
              }}
            >
              {p.line.text}
            </div>
          ))}
          <div className="playhead" style={{ left: time * pxPerSec }} />
        </div>
      </div>
    </section>
  );
}
