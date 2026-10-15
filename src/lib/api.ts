import { invoke } from "@tauri-apps/api/core";

export interface SynthRequest {
  exe: string;
  chunks: string[];
  narrator: string;
  emotions: [string, number][];
  speed: number;
  pitch: number;
  out: string;
}

export interface Clip {
  path: string;
  start: number;
}

export const api = {
  detectVoicepeak: () => invoke<string | null>("detect_voicepeak"),
  listNarrators: (exe: string) => invoke<string[]>("list_narrators", { exe }),
  listEmotions: (exe: string, narrator: string) =>
    invoke<string[]>("list_emotions", { exe, narrator }),
  synthesize: (req: SynthRequest) =>
    invoke<{ path: string; duration: number; mouth: string }>("synthesize", { req }),
  analyzeMouth: (path: string) => invoke<string>("analyze_mouth", { path }),
  imageSize: (path: string) => invoke<[number, number]>("image_size", { path }),
  audioDir: () => invoke<string>("audio_dir"),
  readText: (path: string) => invoke<string>("read_text_file", { path }),
  writeText: (path: string, content: string, encoding?: "shift_jis") =>
    invoke<void>("write_text_file", { path, content, encoding }),
  exportWav: (clips: Clip[], total: number, out: string) =>
    invoke<void>("export_wav", { clips, total, out }),
  exportMp4: (req: {
    ffmpeg: string;
    portraits: {
      closed: string;
      open: string;
      half?: string;
      x: number;
      scale: number;
      segments: [number, number, number][];
    }[];
    clips: Clip[];
    total: number;
    ass: string;
    width: number;
    height: number;
    fps: number;
    background: string;
    movie?: { path: string; volume: number };
    out: string;
  }) => invoke<void>("export_mp4", { req }),
};
