# VOICEPEAK Editor

VOICEPEAK で台本を一括読み上げし、音声と字幕をタイムラインに並べて、AviUtl 用の `.exo` や MP4 に書き出す編集ソフトです。

![画面](docs/screenshot.png)

## できること

- キャラクターごとにナレーター・感情・速さ・高さを設定
- 台本を 1 行ずつ編集、または「名前：セリフ」形式でまとめて貼り付け
- 「すべて生成」で VOICEPEAK を呼び出して全行の音声を作成（変更した行だけ作り直し）
- 140 文字を超える行は自動で分割して生成し、1 つの音声につなげる
- タイムラインで並びを確認し、字幕つきでプレビュー再生
- 書き出し
  - **AviUtl（.exo）**: キャラごとに音声レイヤーと字幕レイヤーを配置。拡張編集にドラッグ＆ドロップで読み込めます
  - **動画（.mp4）**: 単色背景＋字幕＋音声（ffmpeg が必要）
  - **音声（.wav）** / **字幕（.srt）**

## 必要なもの

- Windows 10 / 11（macOS でも動く想定）
- VOICEPEAK（`C:\Program Files\VOICEPEAK\voicepeak.exe` なら自動で見つけます）
- MP4 書き出しをする場合は [ffmpeg](https://ffmpeg.org/)

## 開発の始め方

[Node.js](https://nodejs.org/) 20 以上と [Rust](https://www.rust-lang.org/ja/tools/install) を入れてから:

```sh
npm install
npm run tauri dev     # 開発モードで起動
npm run tauri build   # インストーラーを作る（src-tauri/target/release/bundle/）
```

テスト:

```sh
npm test                            # 画面側（台本分割・タイムライン・exo・字幕）
cd src-tauri && cargo test          # 音声処理・VOICEPEAK 呼び出し
cargo test -- --include-ignored     # ffmpeg を使った MP4 書き出しまで（Linux/macOS）
```

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/` | 画面（React + TypeScript） |
| `src/lib/exo.ts` | AviUtl `.exo` の生成 |
| `src/lib/ass.ts` | MP4 用字幕（ASS）と SRT |
| `src/lib/split.ts` | 140 文字ごとの分割 |
| `src-tauri/src/voicepeak.rs` | VOICEPEAK のコマンドライン呼び出し（同時実行しないよう直列化、失敗時は再試行） |
| `src-tauri/src/audio.rs` | WAV の長さ取得・連結・ミックス |

## 注意

- VOICEPEAK のコマンドライン機能は公式マニュアルに載っていない機能です。バージョンによって動きが変わる可能性があります。
- 生成した音声はアプリのデータフォルダ（`%APPDATA%\com.voicepeak-editor.app\audio`）に保存されます。
- `.exo` は Shift_JIS で書き出します。
