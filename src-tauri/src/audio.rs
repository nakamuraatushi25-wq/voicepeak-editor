//! WAV の長さ取得・連結・ミックス。VOICEPEAK の出力は 16bit PCM なのでそれを前提にする。

use std::path::Path;

pub struct Pcm {
    pub rate: u32,
    /// モノラルに落とした -1.0..1.0 のサンプル
    pub samples: Vec<f32>,
}

pub fn read_mono(path: &Path) -> Result<Pcm, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("{} を開けません: {e}", path.display()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / scale))
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?
        }
    };
    let samples = raw
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    Ok(Pcm { rate: spec.sample_rate, samples })
}

pub fn duration_sec(path: &Path) -> Result<f64, String> {
    let reader =
        hound::WavReader::open(path).map_err(|e| format!("{} を開けません: {e}", path.display()))?;
    let spec = reader.spec();
    Ok(reader.duration() as f64 / spec.sample_rate as f64)
}

/// 線形補間でサンプルレートを合わせる
pub fn resample(pcm: &Pcm, rate: u32) -> Vec<f32> {
    if pcm.rate == rate || pcm.samples.is_empty() {
        return pcm.samples.clone();
    }
    let ratio = pcm.rate as f64 / rate as f64;
    let len = (pcm.samples.len() as f64 / ratio).round() as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = pcm.samples[idx.min(pcm.samples.len() - 1)];
            let b = pcm.samples[(idx + 1).min(pcm.samples.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

pub fn write_mono(path: &Path, rate: u32, samples: &[f32]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        writer.write_sample(v).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}

/// 複数の WAV を順につなげる（140 文字を超える行を分割生成したとき用）
pub fn concat(inputs: &[&Path], out: &Path) -> Result<(), String> {
    let first = read_mono(inputs.first().ok_or("入力がありません")?)?;
    let rate = first.rate;
    let mut all = first.samples;
    for p in &inputs[1..] {
        all.extend(resample(&read_mono(p)?, rate));
    }
    write_mono(out, rate, &all)
}

pub struct Clip<'a> {
    pub path: &'a Path,
    pub start_sec: f64,
}

/// 各クリップを開始時刻に置いて 1 本の WAV にミックスする
pub fn mix(clips: &[Clip], out: &Path, total_sec: f64) -> Result<(), String> {
    let mut decoded = Vec::with_capacity(clips.len());
    for c in clips {
        decoded.push((c.start_sec, read_mono(c.path)?));
    }
    let rate = decoded.first().map(|(_, p)| p.rate).unwrap_or(48_000);
    let mut buf = vec![0.0f32; (total_sec.max(0.0) * rate as f64).ceil() as usize];
    for (start, pcm) in &decoded {
        let offset = (start * rate as f64).round() as usize;
        let samples = resample(pcm, rate);
        let needed = offset + samples.len();
        if buf.len() < needed {
            buf.resize(needed, 0.0);
        }
        for (i, s) in samples.iter().enumerate() {
            buf[offset + i] += s;
        }
    }
    write_mono(out, rate, &buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(path: &Path, rate: u32, len: usize, value: f32) {
        write_mono(path, rate, &vec![value; len]).unwrap();
    }

    #[test]
    fn duration_and_concat() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        let b = dir.path().join("b.wav");
        let out = dir.path().join("out.wav");
        tone(&a, 48_000, 48_000, 0.5);
        tone(&b, 24_000, 12_000, 0.25);
        assert!((duration_sec(&a).unwrap() - 1.0).abs() < 1e-9);
        concat(&[&a, &b], &out).unwrap();
        // 0.5 秒分の b が 48kHz に変換されて後ろにつく
        assert!((duration_sec(&out).unwrap() - 1.5).abs() < 1e-3);
    }

    #[test]
    fn mix_places_clips_at_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.wav");
        let out = dir.path().join("mix.wav");
        tone(&a, 1_000, 500, 0.5);
        mix(
            &[Clip { path: &a, start_sec: 0.0 }, Clip { path: &a, start_sec: 2.0 }],
            &out,
            3.0,
        )
        .unwrap();
        let pcm = read_mono(&out).unwrap();
        assert_eq!(pcm.samples.len(), 3_000);
        assert!(pcm.samples[100] > 0.4);
        assert!(pcm.samples[1_000].abs() < 1e-6);
        assert!(pcm.samples[2_100] > 0.4);
    }
}
