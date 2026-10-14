export interface Character {
  id: string;
  name: string;
  /** VOICEPEAK のナレーター名（--list-narrator の表記） */
  narrator: string;
  color: string;
  /** 新しい行に入れる初期値 */
  emotions: Record<string, number>;
  speed: number;
  pitch: number;
}

export interface GeneratedAudio {
  path: string;
  duration: number;
  /** 生成時の設定。変わっていたら作り直す */
  key: string;
}

export interface Line {
  id: string;
  characterId: string;
  text: string;
  emotions: Record<string, number>;
  speed: number;
  pitch: number;
  /** この行のあとに空ける秒数 */
  pause: number;
  audio?: GeneratedAudio;
}

export interface VideoSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
  font: string;
  fontSize: number;
}

export interface Project {
  version: 1;
  characters: Character[];
  lines: Line[];
  video: VideoSettings;
}

export interface Settings {
  voicepeakPath: string;
  ffmpegPath: string;
}

/** タイムライン上に配置済みの行 */
export interface PlacedLine {
  line: Line;
  character: Character;
  layer: number;
  start: number;
  end: number;
}
