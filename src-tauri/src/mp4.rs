//! MP4 書き出し。画面の組み立てはフロント側で済ませ、ここでは ffmpeg の引数にするだけ。
//! 重ねる順（下から）: 単色 → 背景動画 → 画像（スライド） → 立ち絵 → 字幕・見出し

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipIn {
    pub path: String,
    pub start: f64,
}

/// 立ち絵 1 人分。frames は 0〜total をすき間なく覆う (開始秒, 終了秒, 画像)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortraitTrack {
    pub frames: Vec<(f64, f64, String)>,
    /// 画面幅に対する中心の位置（0〜1）
    pub x: f64,
    /// 拡大率（%）
    pub scale: f64,
}

/// 画像（スライド）。left/top/width/height は書き出す画面上の px
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideIn {
    pub path: String,
    pub start: f64,
    pub end: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovieIn {
    pub path: String,
    /// もとの音の大きさ（0〜100）
    pub volume: f64,
    /// 動画のどこから使うか（秒）。章だけ書き出すときに 0 以外
    #[serde(default)]
    pub offset: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BgmIn {
    pub path: String,
    /// 音量（0〜100）
    pub volume: f64,
    /// セリフの間の音量（volume に対する %）
    pub duck: f64,
    /// セリフが鳴っている区間
    pub speech: Vec<(f64, f64)>,
    #[serde(default)]
    pub offset: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp4Request {
    pub ffmpeg: String,
    pub portraits: Vec<PortraitTrack>,
    #[serde(default)]
    pub slides: Vec<SlideIn>,
    pub clips: Vec<ClipIn>,
    pub total: f64,
    pub ass: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub background: String,
    #[serde(default)]
    pub movie: Option<MovieIn>,
    #[serde(default)]
    pub bgm: Option<BgmIn>,
    pub out: String,
}

/// 作業フォルダに置くファイル（名前, 中身）
pub type WorkFile = (String, String);

/// ffmpeg の concat 用リスト。コマごとに画像を切り替えた動画として読ませる
pub fn concat_list(frames: &[(f64, f64, String)], total: f64) -> String {
    let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let mut out = String::from("ffconcat version 1.0\n");
    let mut last = None;
    for (i, (start, end, file)) in frames.iter().enumerate() {
        // 最後のコマは動画の終わりまで伸ばす
        let end = if i + 1 == frames.len() { end.max(total) } else { *end };
        let dur = end - start;
        if dur > 0.0005 {
            out += &format!("file {}\nduration {:.4}\n", quote(file), dur);
            last = Some(file);
        }
    }
    // 最後の画像は duration が無視されるのでもう一度並べる
    if let Some(file) = last {
        out += &format!("file {}\n", quote(file));
    }
    out
}

/// ある区間のあいだだけ 1 になる ffmpeg の式
fn between_any(spans: &[(f64, f64)]) -> String {
    if spans.is_empty() {
        return "0".into();
    }
    spans.iter().map(|(s, e)| format!("between(t,{s:.3},{e:.3})")).collect::<Vec<_>>().join("+")
}

/// ffmpeg の引数と、作業フォルダに書くファイルを作る。
/// 入力 0 は単色、1 は声を混ぜた mix.wav（呼び出し側で用意する）。
/// movie_audio / bgm は音を混ぜるかどうか（動画に音声トラックがあるか）。
pub fn build(req: &Mp4Request, movie_audio: bool) -> (Vec<String>, Vec<WorkFile>) {
    let mut files: Vec<WorkFile> = vec![("subs.ass".into(), req.ass.clone())];
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c={}:s={}x{}:r={}", req.background, req.width, req.height, req.fps),
        "-i".into(),
        "mix.wav".into(),
    ];
    let mut next_input = 2;
    let mut input = |args: &mut Vec<String>, pre: &[String], path: String| {
        args.extend(pre.iter().cloned());
        args.extend(["-i".into(), path]);
        next_input += 1;
        next_input - 1
    };

    let mut graph: Vec<String> = Vec::new();
    let mut audio: Vec<String> = vec!["[1:a]".into()];
    let mut cur = String::from("[0:v]");
    let mut n = 0;
    let mut label = |prefix: &str| {
        n += 1;
        format!("[{prefix}{n}]")
    };

    if let Some(m) = &req.movie {
        let i = input(&mut args, &["-ss".into(), format!("{:.3}", m.offset)], m.path.clone());
        let (mv, out) = (label("mv"), label("v"));
        graph.push(format!(
            "[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,setsar=1,fps={fps},setpts=PTS-STARTPTS{mv}",
            w = req.width,
            h = req.height,
            fps = req.fps
        ));
        graph.push(format!("{cur}{mv}overlay=x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:eof_action=pass{out}"));
        cur = out;
        if movie_audio && m.volume > 0.0 {
            let a = label("ma");
            graph.push(format!("[{i}:a]volume={:.3}{a}", m.volume / 100.0));
            audio.push(a);
        }
    }

    for s in &req.slides {
        // 静止画は 1 コマ/秒で十分。表示する区間だけ重ねる
        let pre = ["-loop".into(), "1".into(), "-framerate".into(), "1".into(), "-t".into(), format!("{:.3}", s.end + 1.0)];
        let i = input(&mut args, &pre, s.path.clone());
        let (sl, out) = (label("s"), label("v"));
        graph.push(format!(
            "[{i}:v]scale={w:.0}:{h:.0},format=rgba{sl}",
            w = s.width.round().max(1.0),
            h = s.height.round().max(1.0)
        ));
        graph.push(format!(
            "{cur}{sl}overlay=x={x:.0}:y={y:.0}:eof_action=pass:enable='between(t,{a:.3},{b:.3})'{out}",
            x = s.left,
            y = s.top,
            a = s.start,
            b = s.end
        ));
        cur = out;
    }

    for (k, p) in req.portraits.iter().enumerate() {
        let list = format!("portrait{k}.txt");
        files.push((list.clone(), concat_list(&p.frames, req.total)));
        let pre = ["-f".into(), "concat".into(), "-safe".into(), "0".into()];
        let i = input(&mut args, &pre, list);
        let s = p.scale / 100.0;
        let (pl, out) = (label("p"), label("v"));
        graph.push(format!("[{i}:v]scale=iw*{s}:ih*{s},format=rgba{pl}"));
        graph.push(format!("{cur}{pl}overlay=x=main_w*{x}-overlay_w/2:y=main_h-overlay_h:eof_action=repeat{out}", x = p.x));
        cur = out;
    }
    graph.push(format!("{cur}subtitles=subs.ass[vout]"));

    if let Some(b) = &req.bgm {
        let pre = ["-stream_loop".into(), "-1".into(), "-ss".into(), format!("{:.3}", b.offset)];
        let i = input(&mut args, &pre, b.path.clone());
        let a = label("bgm");
        let loud = b.volume / 100.0;
        let quiet = loud * b.duck / 100.0;
        graph.push(format!(
            "[{i}:a]asetpts=PTS-STARTPTS,volume='if({cond},{quiet:.4},{loud:.4})':eval=frame{a}",
            cond = between_any(&b.speech)
        ));
        audio.push(a);
    }

    let audio_out = if audio.len() == 1 {
        "1:a".to_string()
    } else {
        graph.push(format!("{}amix=inputs={}:duration=first:normalize=0[aout]", audio.join(""), audio.len()));
        "[aout]".to_string()
    };

    args.extend(
        [
            "-filter_complex".to_string(),
            graph.join(";"),
            "-map".into(),
            "[vout]".into(),
            "-map".into(),
            audio_out,
            "-r".into(),
            req.fps.to_string(),
            "-c:v".into(),
            "libx264".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-t".into(),
            format!("{:.3}", req.total),
            req.out.clone(),
        ],
    );
    (args, files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concat_list_extends_last_frame() {
        let frames = vec![(0.0, 1.0, "C:\\a\\closed.png".into()), (1.0, 1.5, "it's.png".into()), (1.5, 2.0, "C:\\a\\closed.png".into())];
        assert_eq!(
            concat_list(&frames, 3.0),
            "ffconcat version 1.0\nfile 'C:\\a\\closed.png'\nduration 1.0000\nfile 'it'\\''s.png'\nduration 0.5000\nfile 'C:\\a\\closed.png'\nduration 1.5000\nfile 'C:\\a\\closed.png'\n"
        );
    }

    #[test]
    fn bgm_ducks_while_speaking() {
        let req = Mp4Request {
            ffmpeg: "ffmpeg".into(),
            portraits: vec![],
            slides: vec![],
            clips: vec![],
            total: 10.0,
            ass: String::new(),
            width: 320,
            height: 180,
            fps: 30,
            background: "#000000".into(),
            movie: None,
            bgm: Some(BgmIn { path: "bgm.mp3".into(), volume: 50.0, duck: 20.0, speech: vec![(1.0, 2.0), (3.0, 4.5)], offset: 0.0 }),
            out: "out.mp4".into(),
        };
        let (args, _) = build(&req, false);
        let graph = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("volume='if(between(t,1.000,2.000)+between(t,3.000,4.500),0.1000,0.5000)':eval=frame"), "{graph}");
        assert!(graph.contains("amix=inputs=2"), "{graph}");
        assert!(args.windows(2).any(|w| w[0] == "-stream_loop" && w[1] == "-1"));
    }
}
