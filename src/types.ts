/** 口の形ごとの画像。同じ大きさにそろえる */
export interface MouthImages {
  closed: string;
  open: string;
  /** なければ open を使う */
  half?: string;
}

/** 立ち絵。口の形ごとに同じ大きさの画像を用意する */
export interface Portrait extends MouthImages {
  /** 表情差分。名前ごとに口の形 3 枚（いつもの絵と同じ大きさ） */
  expressions?: Record<string, MouthImages>;
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
  /** 話し始める時刻（秒）。なければ前の行のあとに続ける */
  at?: number;
  /** この行から出す画像。null でこの行から消す、なければ前のまま */
  slide?: Slide | null;
  /** この行から出す見出し（章の区切りにもなる）。"" で消す、なければ前のまま */
  title?: string;
  /** この行を話す間の表情（立ち絵の expressions の名前）。なければいつもの絵 */
  expression?: string;
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

/** 背景に敷く動画。セリフはこの上に重ねる */
export interface Movie {
  path: string;
  /** 長さ（秒） */
  duration: number;
  width: number;
  height: number;
  /** 動画のもとの音の大きさ（0〜100） */
  volume: number;
}

/** 場面ごとに出す画像（表や図のスライドなど） */
export interface Slide {
  path: string;
  width: number;
  height: number;
  /** 画面（字幕の上の部分）に収まる大きさに対する割合（%） */
  scale: number;
}

/** BGM。セリフの間は自動で小さくする */
export interface Bgm {
  path: string;
  duration: number;
  /** 音量（0〜100） */
  volume: number;
  /** セリフの間の音量。volume に対する割合（%） */
  duck: number;
}

/** 読み方の辞書。字幕は word のまま、声は reading で読む */
export interface Reading {
  word: string;
  reading: string;
}

export interface Project {
  version: 1;
  characters: Character[];
  lines: Line[];
  video: VideoSettings;
  movie?: Movie;
  bgm?: Bgm;
  dictionary?: Reading[];
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
