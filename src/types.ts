/** 立ち絵。口の形ごとに同じ大きさの画像を用意する */
export interface Portrait {
  closed: string;
  open: string;
  /** なければ open を使う */
  half?: string;
  /** 画像の大きさ（px） */
  width: number;
  height: number;
  /** 画面幅に対する中心の位置（0 左端〜1 右端） */
  x: number;
  /** 拡大率（%） */
  scale: number;
}

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
  portrait?: Portrait;
}

export interface GeneratedAudio {
  path: string;
  duration: number;
  /** 生成時の設定。変わっていたら作り直す */
  key: string;
  /** 口パク。MOUTH_FPS ごとの開き具合 "0" 閉じ / "1" 半開き / "2" 開き */
  mouth?: string;
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
