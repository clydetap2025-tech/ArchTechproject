// In-browser audio analysis (no libraries): tempo + beat grid, key/mode, energy, timbre brightness,
// dynamics, and the loudest 30-second window for full songs.
import { clamp } from './util.js';

export const NOTE_RU = ['до', 'до♯', 'ре', 'ми♭', 'ми', 'фа', 'фа♯', 'соль', 'ля♭', 'ля', 'си♭', 'си'];
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export async function decodeAudio(arrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return await ctx.decodeAudioData(arrayBuffer);
}

function makeFFT(n) {
  const levels = Math.log2(n);
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1); rev[i] = r; }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim; re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function pearson(a, b) {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / (Math.sqrt(da * db) || 1);
}

export function analyzeAudio(buf) {
  const sr0 = buf.sampleRate, len0 = buf.length, ch = buf.numberOfChannels;
  const mono0 = new Float32Array(len0);
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len0; i++) mono0[i] += d[i] / ch; }
  const dur = len0 / sr0;

  // full songs: find the loudest 30 s (usually the chorus) to play and analyse
  let segStart = 0;
  const segDur = Math.min(dur, 30);
  if (dur > 40) {
    const secs = Math.floor(dur), r = new Float32Array(secs);
    for (let s = 0; s < secs; s++) { let a = 0; const o = s * sr0; for (let i = 0; i < sr0; i += 4) a += mono0[o + i] ** 2; r[s] = a; }
    let best = -1;
    for (let s = Math.floor(dur * 0.1); s + 30 <= secs - Math.floor(dur * 0.05); s++) {
      let a = 0; for (let k = 0; k < 30; k++) a += r[s + k];
      if (a > best) { best = a; segStart = s; }
    }
  }

  const dec = Math.max(1, Math.round(sr0 / 22050)), sr = sr0 / dec;
  const s0 = Math.floor(segStart * sr0), s1 = Math.min(len0, Math.floor((segStart + segDur) * sr0));
  const n = Math.floor((s1 - s0) / dec);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let a = 0; for (let k = 0; k < dec; k++) a += mono0[s0 + i * dec + k] || 0; x[i] = a / dec; }

  const N = 1024, HOP = 512, fps = sr / HOP;
  const frames = Math.max(0, Math.floor((n - N) / HOP));
  if (frames < 80) return null;
  const fft = makeFFT(N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const rms = new Float32Array(frames), flux = new Float32Array(frames), cent = new Float32Array(frames);
  const chroma = new Float64Array(12);
  const prev = new Float32Array(N / 2), re = new Float32Array(N), im = new Float32Array(N);
  const binHz = sr / N;
  const pcOf = new Int8Array(N / 2).fill(-1);
  // only where FFT bins are narrower than a semitone (~330 Hz+ at this resolution), otherwise low bins bias the key
  for (let b = 1; b < N / 2; b++) { const f = b * binHz; if (f >= 330 && f <= 2600) pcOf[b] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12; }

  const frameChroma = new Float32Array(frames * 12);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP; let sq = 0;
    for (let i = 0; i < N; i++) { const v = x[off + i]; sq += v * v; re[i] = v * win[i]; im[i] = 0; }
    rms[f] = Math.sqrt(sq / N);
    fft(re, im);
    let num = 0, den = 0, fl = 0;
    for (let b = 1; b < N / 2; b++) {
      const m = Math.hypot(re[b], im[b]);
      num += b * binHz * m; den += m;
      const lm = Math.log1p(100 * m), d = lm - prev[b];
      if (d > 0) fl += d;
      prev[b] = lm;
      if (pcOf[b] >= 0) frameChroma[f * 12 + pcOf[b]] += Math.sqrt(m);
    }
    cent[f] = den > 1e-9 ? num / den : 0;
    flux[f] = f === 0 ? 0 : fl;
  }
  // tonal frames only (skip the strongest transients), each frame normalised so drums don't dominate
  const fluxSorted = Array.from(flux).sort((a, b) => a - b);
  const fluxCut = fluxSorted[Math.floor(frames * 0.8)];
  for (let f = 0; f < frames; f++) {
    if (flux[f] > fluxCut || rms[f] < 1e-3) continue;
    let s = 0; for (let k = 0; k < 12; k++) s += frameChroma[f * 12 + k];
    if (s > 0) for (let k = 0; k < 12; k++) chroma[k] += frameChroma[f * 12 + k] / s;
  }

  // onset envelope
  const W = Math.round(fps * 0.25), od = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let a = 0, c = 0;
    for (let k = Math.max(0, f - W); k <= Math.min(frames - 1, f + W); k++) { a += flux[k]; c++; }
    od[f] = Math.max(0, flux[f] - a / c);
  }
  const odMax = Math.max(...od) || 1;
  for (let f = 0; f < frames; f++) od[f] /= odMax;

  // tempo by autocorrelation; the prior's centre follows how clear the pulse is
  // (a strong steady beat → dance tempo around 120, a soft rubato → ballad tempo around 80)
  const minLag = Math.round(fps * 60 / 200), maxLag = Math.round(fps * 60 / 55);
  const acLen = Math.min(frames - 1, maxLag * 2 + 2);
  const ac = new Float32Array(acLen + 1);
  let ac0 = 0; for (let i = 0; i < frames; i++) ac0 += od[i] * od[i]; ac0 /= frames;
  for (let lag = 1; lag <= acLen; lag++) { let s = 0; for (let i = lag; i < frames; i++) s += od[i] * od[i - lag]; ac[lag] = s / (frames - lag); }
  let acPeak = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, acLen); lag++) acPeak = Math.max(acPeak, ac[lag]);
  const pulse = clamp((acPeak / (ac0 || 1)) * 1.6);
  const center = 74 + 50 * pulse;
  let bestLag = minLag, bestScore = -1;
  for (let lag = minLag; lag <= Math.min(maxLag, acLen); lag++) {
    const bpm = 60 * fps / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / center) / 0.6, 2));
    const sc = prior * (ac[lag] + 0.35 * (lag * 2 <= acLen ? ac[lag * 2] : 0));
    if (sc > bestScore) { bestScore = sc; bestLag = lag; }
  }
  let lagF = bestLag;
  if (bestLag > 1 && bestLag < acLen) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) lagF = bestLag + clamp(0.5 * (a - c) / den, -0.5, 0.5);
  }
  const bpm = Math.round(60 * fps / lagF);

  // beat phase
  let bestPhase = 0, bestSum = -1;
  for (let ph = 0; ph < lagF; ph++) {
    let s = 0;
    for (let t = ph; t < frames; t += lagF) s += od[Math.round(t)] || 0;
    if (s > bestSum) { bestSum = s; bestPhase = ph; }
  }

  // key and mode (Krumhansl–Schmuckler)
  const ch12 = Array.from(chroma);
  let bM = -2, kM = 0, bm = -2, km = 0;
  for (let k = 0; k < 12; k++) {
    const pM = MAJ.map((_, i) => MAJ[(i - k + 12) % 12]);
    const pm = MIN.map((_, i) => MIN[(i - k + 12) % 12]);
    const rM = pearson(ch12, pM), rm = pearson(ch12, pm);
    if (rM > bM) { bM = rM; kM = k; }
    if (rm > bm) { bm = rm; km = k; }
  }
  const mode = bM >= bm ? 'major' : 'minor';
  const keyIndex = mode === 'major' ? kM : km;
  const keyConf = clamp(Math.abs(bM - bm) * 3 + 0.15, 0, 0.9);

  // loudness / energy / brightness / dynamics
  let rmsMean = 0; for (const r of rms) rmsMean += r; rmsMean /= frames;
  const rmsDb = 20 * Math.log10(rmsMean + 1e-9);
  const loudNorm = clamp((rmsDb + 30) / 20);
  const tempoNorm = clamp((bpm - 65) / 95);
  const energy = clamp(0.45 * loudNorm + 0.3 * pulse + 0.25 * tempoNorm);
  let cm = 0, cw = 0; for (let f = 0; f < frames; f++) { cm += cent[f] * rms[f]; cw += rms[f]; }
  const centroid = cw ? cm / cw : 1500;
  const brightness = clamp((centroid - 900) / 2600);
  const dbs = []; for (const r of rms) if (r > 1e-3) dbs.push(20 * Math.log10(r));
  const mdb = dbs.reduce((a, b) => a + b, 0) / (dbs.length || 1);
  const sd = Math.sqrt(dbs.reduce((a, b) => a + (b - mdb) ** 2, 0) / (dbs.length || 1));
  const dynamics = clamp(sd / 12);
  const envelope = [];
  const step = Math.max(1, Math.round(fps / 8));
  let emax = 0;
  for (let f = 0; f < frames; f += step) { let a = 0; for (let k = 0; k < step && f + k < frames; k++) a += rms[f + k]; envelope.push(a / step); emax = Math.max(emax, a / step); }

  return {
    source: 'audio', bpm, beatOffset: bestPhase / fps, mode, keyIndex, key: `${NOTE_RU[keyIndex]} ${mode === 'major' ? 'мажор' : 'минор'}`,
    keyConf, energy, brightness, loudnessDb: Math.round(rmsDb * 10) / 10, pulse, dynamics,
    centroid: Math.round(centroid), segStart, segDur, duration: dur,
    envelope: envelope.map(v => Math.round((v / (emax || 1)) * 100) / 100),
  };
}
