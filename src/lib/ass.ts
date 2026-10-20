import type { VideoSettings } from "../types";
import type { Cue } from "./subtitle";

/** MP4 書き出し用の ASS 字幕。白文字にキャラ色の縁取りをつける */
export function buildAss(cues: Cue[], video: VideoSettings): string {
  const styles = new Map<string, string>();
  for (const p of cues) {
    if (styles.has(p.character.id)) continue;
    styles.set(
      p.character.id,
      `Style: c${styles.size},${video.font},${video.fontSize},&H00FFFFFF,&H00FFFFFF,${assColor(p.character.color)},&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,${Math.round(video.height * 0.06)},1`,
    );
  }
  const styleName = new Map([...styles.keys()].map((id, i) => [id, `c${i}`]));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${video.width}`,
    `PlayResY: ${video.height}`,
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles.values(),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map(
      (p) =>
        `Dialogue: 0,${assTime(p.start)},${assTime(p.end)},${styleName.get(p.character.id)},,0,0,0,,${p.text.replace(/\n/g, "\\N")}`,
    ),
    "",
  ].join("\n");
}

export function assTime(sec: number): string {
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** #RRGGBB → &H00BBGGRR */
export function assColor(hex: string): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

/** 字幕だけ欲しい人向けの SRT */
export function buildSrt(cues: Cue[]): string {
  const t = (sec: number) => {
    const ms = Math.round(sec * 1000);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))},${pad(ms % 1000, 3)}`;
  };
  return cues.map((p, i) => `${i + 1}\n${t(p.start)} --> ${t(p.end)}\n${p.text}\n`).join("\n");
}
