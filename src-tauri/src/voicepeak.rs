//! VOICEPEAK のコマンドライン実行を包む。
//! VOICEPEAK は同時に複数起動すると落ちやすいので、呼び出しはすべて 1 つのロックで直列化する。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static LOCK: Mutex<()> = Mutex::new(());

const TIMEOUT: Duration = Duration::from_secs(60);
const RETRIES: usize = 3;

pub fn default_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if cfg!(windows) {
        for base in ["C:\\Program Files", "C:\\Program Files (x86)"] {
            v.push(PathBuf::from(base).join("VOICEPEAK").join("voicepeak.exe"));
        }
    } else if cfg!(target_os = "macos") {
        v.push(PathBuf::from("/Applications/voicepeak.app/Contents/MacOS/voicepeak"));
    } else {
        v.push(PathBuf::from("/usr/local/bin/voicepeak"));
    }
    v
}

pub fn detect() -> Option<String> {
    default_paths()
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
}

fn command(exe: &str) -> Command {
    let mut cmd = Command::new(exe);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// タイムアウト付きで実行し、標準出力を返す
fn run(mut cmd: Command) -> Result<String, String> {
    let mut child = cmd.spawn().map_err(|e| format!("VOICEPEAK を起動できません: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => break,
            None if start.elapsed() > TIMEOUT => {
                let _ = child.kill();
                return Err("VOICEPEAK が応答しません（タイムアウト）".into());
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("VOICEPEAK がエラーで終了しました: {}", stderr.trim()));
    }
    Ok(stdout)
}

pub fn parse_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('['))
        .map(String::from)
        .collect()
}

pub fn list_narrators(exe: &str) -> Result<Vec<String>, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cmd = command(exe);
    cmd.arg("--list-narrator");
    run(cmd).map(|s| parse_list(&s))
}

pub fn list_emotions(exe: &str, narrator: &str) -> Result<Vec<String>, String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut cmd = command(exe);
    cmd.arg("--list-emotion").arg(narrator);
    run(cmd).map(|s| parse_list(&s))
}

pub struct Voice<'a> {
    pub narrator: &'a str,
    pub emotions: &'a [(String, u32)],
    pub speed: u32,
    pub pitch: i32,
}

pub fn build_args(text: &str, voice: &Voice, out: &Path) -> Vec<String> {
    let mut args = vec!["-s".into(), text.into(), "-n".into(), voice.narrator.into()];
    let emotions: Vec<String> = voice
        .emotions
        .iter()
        .filter(|(_, v)| *v > 0)
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    if !emotions.is_empty() {
        args.push("-e".into());
        args.push(emotions.join(","));
    }
    args.push("--speed".into());
    args.push(voice.speed.clamp(50, 200).to_string());
    args.push("--pitch".into());
    args.push(voice.pitch.clamp(-300, 300).to_string());
    args.push("-o".into());
    args.push(out.to_string_lossy().into_owned());
    args
}

/// 1 チャンク（140 文字以内）を WAV にする。失敗したら数回やり直す。
pub fn synthesize_chunk(exe: &str, text: &str, voice: &Voice, out: &Path) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut last_err = String::new();
    for _ in 0..RETRIES {
        let _ = std::fs::remove_file(out);
        let mut cmd = command(exe);
        cmd.args(build_args(text, voice, out));
        match run(cmd) {
            Ok(_) if out.exists() => return Ok(()),
            Ok(_) => last_err = "VOICEPEAK が音声ファイルを出力しませんでした".into(),
            Err(e) => last_err = e,
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err(last_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_skip_zero_emotions_and_clamp() {
        let emotions = vec![("happy".to_string(), 50), ("sad".to_string(), 0)];
        let v = Voice { narrator: "Japanese Female 1", emotions: &emotions, speed: 500, pitch: -999 };
        let args = build_args("こんにちは", &v, Path::new("out.wav"));
        assert_eq!(
            args,
            [
                "-s", "こんにちは", "-n", "Japanese Female 1", "-e", "happy=50", "--speed", "200",
                "--pitch", "-300", "-o", "out.wav"
            ]
        );
    }

    #[test]
    fn list_parsing_drops_blank_and_log_lines() {
        let out = "[debug] init\nJapanese Male 1\n\nJapanese Female 1\r\n";
        assert_eq!(parse_list(out), ["Japanese Male 1", "Japanese Female 1"]);
    }
}
