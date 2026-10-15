mod audio;
mod voicepeak;

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SynthRequest {
    exe: String,
    /// 140 文字以内に分割済みの本文
    chunks: Vec<String>,
    narrator: String,
    emotions: Vec<(String, u32)>,
    speed: u32,
    pitch: i32,
    out: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SynthResult {
    path: String,
    duration: f64,
    mouth: String,
}

/// プレビュー用の口パクは 30fps で持つ
const MOUTH_FPS: u32 = 30;

fn mouth_string(path: &Path) -> Result<String, String> {
    Ok(audio::mouth_levels(path, MOUTH_FPS)?.iter().map(|l| char::from(b'0' + l)).collect())
}

#[tauri::command]
fn detect_voicepeak() -> Option<String> {
    voicepeak::detect()
}

#[tauri::command]
async fn list_narrators(exe: String) -> Result<Vec<String>, String> {
    voicepeak::list_narrators(&exe)
}

#[tauri::command]
async fn list_emotions(exe: String, narrator: String) -> Result<Vec<String>, String> {
    voicepeak::list_emotions(&exe, &narrator)
}

#[tauri::command]
async fn synthesize(req: SynthRequest) -> Result<SynthResult, String> {
    let out = PathBuf::from(&req.out);
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let voice = voicepeak::Voice {
        narrator: &req.narrator,
        emotions: &req.emotions,
        speed: req.speed,
        pitch: req.pitch,
    };
    if req.chunks.len() <= 1 {
        let text = req.chunks.first().map(String::as_str).unwrap_or("");
        voicepeak::synthesize_chunk(&req.exe, text, &voice, &out)?;
    } else {
        let parts: Vec<PathBuf> =
            (0..req.chunks.len()).map(|i| out.with_extension(format!("part{i}.wav"))).collect();
        for (text, part) in req.chunks.iter().zip(&parts) {
            voicepeak::synthesize_chunk(&req.exe, text, &voice, part)?;
        }
        let refs: Vec<&Path> = parts.iter().map(PathBuf::as_path).collect();
        audio::concat(&refs, &out)?;
        for p in &parts {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(SynthResult {
        path: req.out.clone(),
        duration: audio::duration_sec(&out)?,
        mouth: mouth_string(&out)?,
    })
}

/// 口パクデータを持っていない古い音声用
#[tauri::command]
async fn analyze_mouth(path: String) -> Result<String, String> {
    mouth_string(Path::new(&path))
}

#[tauri::command]
fn image_size(path: String) -> Result<(usize, usize), String> {
    let s = imagesize::size(&path).map_err(|e| format!("画像を読めません: {e}"))?;
    Ok((s.width, s.height))
}

#[tauri::command]
fn audio_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("audio");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// encoding が "shift_jis" なら変換して書く（AviUtl の .exo 用）
#[tauri::command]
fn write_text_file(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    let bytes = match encoding.as_deref() {
        Some("shift_jis") => {
            let crlf = content.replace('\n', "\r\n");
            let (b, _, _) = encoding_rs::SHIFT_JIS.encode(&crlf);
            b.into_owned()
        }
        _ => content.into_bytes(),
    };
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipIn {
    path: String,
    start: f64,
}

#[tauri::command]
async fn export_wav(clips: Vec<ClipIn>, total: f64, out: String) -> Result<(), String> {
    let clips: Vec<audio::Clip> =
        clips.iter().map(|c| audio::Clip { path: Path::new(&c.path), start_sec: c.start }).collect();
    audio::mix(&clips, Path::new(&out), total)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortraitTrack {
    closed: String,
    open: String,
    half: Option<String>,
    /// 画面幅に対する中心の位置（0〜1）
    x: f64,
    /// 拡大率（%）
    scale: f64,
    /// 口が開いている区間 (開始秒, 終了秒, 1 半開き / 2 開き)。重ならず昇順
    segments: Vec<(f64, f64, u8)>,
}

/// ffmpeg の concat 用リスト。口の状態ごとに画像を切り替えた動画として読ませる
fn concat_list(p: &PortraitTrack, total: f64) -> String {
    let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let image = |level: u8| match level {
        0 => &p.closed,
        1 => p.half.as_ref().unwrap_or(&p.open),
        _ => &p.open,
    };
    let mut out = String::from("ffconcat version 1.0\n");
    let mut push = |level: u8, dur: f64| {
        if dur > 0.0005 {
            out += &format!("file {}\nduration {:.4}\n", quote(image(level)), dur);
        }
    };
    let mut t = 0.0;
    for &(start, end, level) in &p.segments {
        push(0, start - t);
        push(level, end - start.max(t));
        t = end.max(t);
    }
    push(0, (total - t).max(0.04));
    // 最後の画像は duration が無視されるのでもう一度並べる
    out += &format!("file {}\n", quote(&p.closed));
    out
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mp4Request {
    ffmpeg: String,
    portraits: Vec<PortraitTrack>,
    clips: Vec<ClipIn>,
    total: f64,
    ass: String,
    width: u32,
    height: u32,
    fps: u32,
    background: String,
    out: String,
}

#[tauri::command]
async fn export_mp4(req: Mp4Request) -> Result<(), String> {
    // 字幕フィルタのパス指定を避けるため、作業フォルダに置いて相対名で渡す
    let work = std::env::temp_dir().join(format!("voicepeak-editor-{}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let wav = work.join("mix.wav");
    let clips: Vec<audio::Clip> = req
        .clips
        .iter()
        .map(|c| audio::Clip { path: Path::new(&c.path), start_sec: c.start })
        .collect();
    audio::mix(&clips, &wav, req.total)?;
    std::fs::write(work.join("subs.ass"), &req.ass).map_err(|e| e.to_string())?;

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c={}:s={}x{}:r={}", req.background, req.width, req.height, req.fps),
        "-i".into(),
        "mix.wav".into(),
    ];
    // 立ち絵は 1 キャラ 1 入力。下から順に重ね、最後に字幕をのせる
    let mut graph = String::from("[0:v]null[v0]");
    for (i, p) in req.portraits.iter().enumerate() {
        let list = format!("portrait{i}.txt");
        std::fs::write(work.join(&list), concat_list(p, req.total)).map_err(|e| e.to_string())?;
        args.extend(["-f", "concat", "-safe", "0", "-i"].map(String::from));
        args.push(list);
        let input = i + 2;
        let s = p.scale / 100.0;
        graph += &format!(
            ";[{input}:v]scale=iw*{s}:ih*{s},format=rgba[p{i}];[v{i}][p{i}]overlay=x=main_w*{x}-overlay_w/2:y=main_h-overlay_h:eof_action=repeat[v{n}]",
            x = p.x,
            n = i + 1
        );
    }
    graph += &format!(";[v{}]subtitles=subs.ass[out]", req.portraits.len());
    args.extend(
        [
            "-filter_complex", &graph, "-map", "[out]", "-map", "1:a", "-r",
            &req.fps.to_string(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-shortest", &req.out,
        ]
        .map(String::from),
    );

    let mut cmd = Command::new(&req.ffmpeg);
    cmd.current_dir(&work).args(&args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let output = cmd.output().map_err(|e| format!("ffmpeg を起動できません: {e}"))?;
    let _ = std::fs::remove_dir_all(&work);
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = err.lines().rev().take(5).collect();
        return Err(format!("ffmpeg が失敗しました: {}", tail.into_iter().rev().collect::<Vec<_>>().join("\n")));
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detect_voicepeak,
            list_narrators,
            list_emotions,
            synthesize,
            analyze_mouth,
            image_size,
            audio_dir,
            read_text_file,
            write_text_file,
            export_wav,
            export_mp4
        ])
        .run(tauri::generate_context!())
        .expect("アプリの起動に失敗しました");
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// VOICEPEAK の代わりに -o の場所へ 1 秒の WAV を書く偽物
    fn fake_voicepeak(dir: &Path) -> String {
        let exe = dir.join("voicepeak");
        std::fs::write(
            &exe,
            "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = -o ]; then out=$2; fi; shift; done\n\
             ffmpeg -loglevel error -y -f lavfi -i sine=d=1:r=48000 -ac 1 \"$out\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        exe.to_string_lossy().into_owned()
    }

    #[test]
    #[ignore = "ffmpeg が必要"]
    fn synthesize_chunks_then_export_mp4() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake_voicepeak(dir.path());
        let wav = dir.path().join("line.wav").to_string_lossy().into_owned();
        let res = tauri::async_runtime::block_on(synthesize(SynthRequest {
            exe,
            chunks: vec!["前半".into(), "後半".into()],
            narrator: "Japanese Female 1".into(),
            emotions: vec![("happy".into(), 50)],
            speed: 100,
            pitch: 0,
            out: wav.clone(),
        }))
        .unwrap();
        assert!((res.duration - 2.0).abs() < 0.01);

        let mp4 = dir.path().join("out.mp4");
        assert_eq!(res.mouth.len(), 60);

        // 立ち絵の代わりに色付きの半透明 PNG を 2 枚作る
        let closed = dir.path().join("closed.png");
        let open = dir.path().join("open.png");
        for (p, c) in [(&closed, "blue"), (&open, "red")] {
            let ok = Command::new("ffmpeg")
                .args(["-loglevel", "error", "-y", "-f", "lavfi", "-i"])
                .arg(format!("color=c={c}@0.8:s=60x90,format=rgba"))
                .args(["-frames:v", "1"])
                .arg(p)
                .status()
                .unwrap();
            assert!(ok.success());
        }
        let portrait = |x: f64| PortraitTrack {
            closed: closed.to_string_lossy().into_owned(),
            open: open.to_string_lossy().into_owned(),
            half: None,
            x,
            scale: 100.0,
            segments: vec![(0.2, 0.5, 2), (0.6, 1.0, 1)],
        };

        tauri::async_runtime::block_on(export_mp4(Mp4Request {
            ffmpeg: "ffmpeg".into(),
            portraits: vec![portrait(0.2), portrait(0.8)],
            clips: vec![ClipIn { path: wav.clone(), start: 0.0 }, ClipIn { path: wav, start: 2.5 }],
            total: 4.5,
            ass: "[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: c0,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00F7C34F,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.00,c0,,0,0,0,,テスト\n".into(),
            width: 320,
            height: 180,
            fps: 30,
            background: "#202020".into(),
            out: mp4.to_string_lossy().into_owned(),
        }))
        .unwrap();
        assert!(std::fs::metadata(&mp4).unwrap().len() > 1000);

        // 0.3 秒の時点では右のキャラ（x=0.8）の口が開いて赤くなっている
        let probe = |t: &str| {
            Command::new("ffmpeg")
                .args(["-loglevel", "error", "-y", "-ss", t, "-i"])
                .arg(&mp4)
                .args(["-frames:v", "1", "-vf", "crop=4:4:254:148", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap()
                .stdout
        };
        let open_px = probe("0.3");
        let closed_px = probe("1.5");
        assert!(open_px[0] > open_px[2], "開いた口は赤: {open_px:?}");
        assert!(closed_px[2] > closed_px[0], "閉じた口は青: {closed_px:?}");
    }

    #[test]
    fn concat_list_fills_gaps_with_closed_mouth() {
        let p = PortraitTrack {
            closed: "C:\\a\\closed.png".into(),
            open: "it's.png".into(),
            half: None,
            x: 0.5,
            scale: 100.0,
            segments: vec![(1.0, 1.5, 2)],
        };
        let list = concat_list(&p, 3.0);
        assert_eq!(
            list,
            "ffconcat version 1.0\nfile 'C:\\a\\closed.png'\nduration 1.0000\nfile 'it'\\''s.png'\nduration 0.5000\nfile 'C:\\a\\closed.png'\nduration 1.5000\nfile 'C:\\a\\closed.png'\n"
        );
    }
}
