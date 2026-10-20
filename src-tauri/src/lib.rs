mod audio;
mod mp4;
mod voicepeak;

use mp4::{ClipIn, Mp4Request};

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


#[tauri::command]
async fn export_wav(clips: Vec<ClipIn>, total: f64, out: String) -> Result<(), String> {
    let clips: Vec<audio::Clip> =
        clips.iter().map(|c| audio::Clip { path: Path::new(&c.path), start_sec: c.start }).collect();
    audio::mix(&clips, Path::new(&out), total)
}

/// 動画に音声トラックがあるか。ffmpeg -i が出すストリーム一覧で判定する
fn has_audio(ffmpeg: &str, path: &str) -> bool {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-i", path]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output()
        .map(|o| String::from_utf8_lossy(&o.stderr).contains("Audio:"))
        .unwrap_or(false)
}

#[tauri::command]
async fn export_mp4(req: Mp4Request) -> Result<(), String> {
    // 字幕フィルタのパス指定を避けるため、作業フォルダに置いて相対名で渡す
    let work = std::env::temp_dir().join(format!("voicepeak-editor-{}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = run_mp4(&req, &work);
    let _ = std::fs::remove_dir_all(&work);
    result
}

fn run_mp4(req: &Mp4Request, work: &Path) -> Result<(), String> {
    let clips: Vec<audio::Clip> = req
        .clips
        .iter()
        .map(|c| audio::Clip { path: Path::new(&c.path), start_sec: c.start })
        .collect();
    audio::mix(&clips, &work.join("mix.wav"), req.total)?;
    let movie_audio = req.movie.as_ref().is_some_and(|m| has_audio(&req.ffmpeg, &m.path));
    let (args, files) = mp4::build(req, movie_audio);
    for (name, content) in files {
        std::fs::write(work.join(name), content).map_err(|e| e.to_string())?;
    }

    let mut cmd = Command::new(&req.ffmpeg);
    cmd.current_dir(work).args(&args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let output = cmd.output().map_err(|e| format!("ffmpeg を起動できません: {e}"))?;
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
        .plugin(tauri_plugin_opener::init())
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
        let (c, o) = (closed.to_string_lossy().into_owned(), open.to_string_lossy().into_owned());
        let portrait = |x: f64| mp4::PortraitTrack {
            frames: vec![(0.0, 0.2, c.clone()), (0.2, 0.5, o.clone()), (0.5, 0.6, c.clone()), (0.6, 1.0, o.clone()), (1.0, 4.5, c.clone())],
            x,
            scale: 100.0,
        };
        // 左上に 0〜1 秒だけ緑の画像（スライド）
        let slide = dir.path().join("slide.png");
        let ok = Command::new("ffmpeg")
            .args(["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=lime:s=50x25", "-frames:v", "1"])
            .arg(&slide)
            .status()
            .unwrap();
        assert!(ok.success());

        tauri::async_runtime::block_on(export_mp4(Mp4Request {
            ffmpeg: "ffmpeg".into(),
            portraits: vec![portrait(0.2), portrait(0.8)],
            slides: vec![mp4::SlideIn {
                path: slide.to_string_lossy().into_owned(),
                start: 0.0,
                end: 1.0,
                left: 10.0,
                top: 10.0,
                width: 100.0,
                height: 50.0,
            }],
            clips: vec![ClipIn { path: wav.clone(), start: 0.0 }, ClipIn { path: wav, start: 2.5 }],
            total: 4.5,
            ass: "[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 180\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: c0,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00F7C34F,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.00,c0,,0,0,0,,テスト\n".into(),
            width: 320,
            height: 180,
            fps: 30,
            background: "#202020".into(),
            movie: None,
            bgm: None,
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
        // スライドは 0〜1 秒だけ、拡大して左上に出る
        let at = |t: &str| {
            Command::new("ffmpeg")
                .args(["-loglevel", "error", "-y", "-ss", t, "-i"])
                .arg(&mp4)
                .args(["-frames:v", "1", "-vf", "crop=4:4:90:50", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap()
                .stdout
        };
        let shown = at("0.5");
        let hidden = at("2.0");
        assert!(shown[1] > 200 && shown[0] < 60, "スライドは緑: {shown:?}");
        assert!(hidden[1] < 60, "1 秒を過ぎたら消える: {hidden:?}");
    }

    #[test]
    #[ignore = "ffmpeg が必要"]
    fn export_mp4_over_movie() {
        let dir = tempfile::tempdir().unwrap();
        // 赤い 2 秒の背景動画（音つき）と 1 秒の声
        let movie = dir.path().join("movie.mp4");
        let ok = Command::new("ffmpeg")
            .args(["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=2"])
            .args(["-f", "lavfi", "-i", "sine=f=220:d=2", "-shortest", "-pix_fmt", "yuv420p"])
            .arg(&movie)
            .status()
            .unwrap();
        assert!(ok.success());
        let wav = dir.path().join("line.wav");
        let ok = Command::new("ffmpeg")
            .args(["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=d=1:r=48000", "-ac", "1"])
            .arg(&wav)
            .status()
            .unwrap();
        assert!(ok.success());

        let mp4 = dir.path().join("out.mp4");
        tauri::async_runtime::block_on(export_mp4(Mp4Request {
            ffmpeg: "ffmpeg".into(),
            portraits: vec![],
            slides: vec![],
            clips: vec![ClipIn { path: wav.to_string_lossy().into_owned(), start: 0.5 }],
            total: 3.0,
            ass: "[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n".into(),
            width: 320,
            height: 180,
            fps: 30,
            background: "#000000".into(),
            movie: Some(mp4::MovieIn { path: movie.to_string_lossy().into_owned(), volume: 50.0, offset: 0.0 }),
            // BGM は動画の音声を使い回す（ループさせ、セリフの間は小さく）
            bgm: Some(mp4::BgmIn {
                path: movie.to_string_lossy().into_owned(),
                volume: 30.0,
                duck: 20.0,
                speech: vec![(0.5, 1.5)],
                offset: 0.0,
            }),
            out: mp4.to_string_lossy().into_owned(),
        }))
        .unwrap();

        let probe = |t: &str| {
            Command::new("ffmpeg")
                .args(["-loglevel", "error", "-y", "-ss", t, "-i"])
                .arg(&mp4)
                .args(["-frames:v", "1", "-vf", "crop=4:4:158:88", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                .output()
                .unwrap()
                .stdout
        };
        let during = probe("1.0");
        let after = probe("2.5");
        assert!(during[0] > 200 && during[2] < 60, "動画の間は赤: {during:?}");
        assert!(after[0] < 40, "動画が終わったら背景色: {after:?}");
        // 長さは total に合わせる
        let out = Command::new("ffmpeg").args(["-hide_banner", "-i"]).arg(&mp4).output().unwrap();
        let info = String::from_utf8_lossy(&out.stderr);
        assert!(info.contains("Duration: 00:00:03.0") || info.contains("Duration: 00:00:02.9"), "{info}");
        assert!(info.contains("Audio:"));
    }
}
