// Sound engine: song segment playback (looped, synced to the page clock), live levels for the visuals,
// a procedural ambient layer named by the entry (rain, leaves, sea, office…), a generative sketch when
// no audio exists, voice ducking and a recordable stream for video export.

let instance = null;
export function getSound() { return instance || (instance = new Sound()); }

class Sound {
  constructor() {
    const c = (this.c = new (window.AudioContext || window.webkitAudioContext)());
    this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
    this.rec = c.createMediaStreamDestination(); this.master.connect(this.rec);
    this.songGain = c.createGain(); this.songGain.connect(this.master);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
    this.songGain.connect(this.analyser);
    this.ambGain = c.createGain(); this.ambGain.gain.value = 0; this.ambGain.connect(this.master);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.noise = this.makeNoise(4);
    this.timers = []; this.nodes = []; this.sketchTimer = null; this.src = null; this.t0 = 0; this.D = 30;
  }

  async resume() { if (this.c.state !== 'running') await this.c.resume(); }
  now() { return this.c.currentTime; }
  time() { return ((this.c.currentTime - this.t0) % this.D + this.D) % this.D; }

  makeNoise(sec) {
    const b = this.c.createBuffer(1, this.c.sampleRate * sec, this.c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  levels() {
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq; let bass = 0, high = 0, all = 0;
    for (let i = 1; i < 9; i++) bass += f[i];
    for (let i = 90; i < 240; i++) high += f[i];
    for (let i = 0; i < f.length; i++) all += f[i];
    return { bass: bass / 8 / 255, high: high / 150 / 255, level: all / f.length / 255 };
  }

  playSong(buffer, segStart, segDur) {
    this.stopSong(0);
    const c = this.c, s = c.createBufferSource(), now = c.currentTime + 0.05;
    s.buffer = buffer; s.loop = true;
    s.loopStart = segStart; s.loopEnd = Math.min(buffer.duration, segStart + segDur);
    s.connect(this.songGain);
    this.songGain.gain.cancelScheduledValues(now);
    this.songGain.gain.setValueAtTime(0, now);
    this.songGain.gain.linearRampToValueAtTime(1, now + 0.8);
    s.start(now, segStart);
    this.src = s; this.t0 = now; this.D = s.loopEnd - s.loopStart;
    return now;
  }

  stopSong(fade = 0.4) {
    const s = this.src; this.src = null;
    if (!s) return;
    const now = this.c.currentTime;
    this.songGain.gain.cancelScheduledValues(now);
    this.songGain.gain.setValueAtTime(this.songGain.gain.value, now);
    this.songGain.gain.linearRampToValueAtTime(0, now + fade);
    try { s.stop(now + fade + 0.05); } catch { /* already stopped */ }
  }

  duck(on) {
    const now = this.c.currentTime;
    this.songGain.gain.cancelScheduledValues(now);
    this.songGain.gain.setTargetAtTime(on ? 0.3 : 1, now, 0.25);
  }

  // ---------- ambient layers ----------
  src_(loop = true) { const s = this.c.createBufferSource(); s.buffer = this.noise; s.loop = loop; return s; }
  filt(type, f, q = 0.7) { const b = this.c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v) { const g = this.c.createGain(); g.gain.value = v; return g; }
  lfo(rate, depth, target) { const o = this.c.createOscillator(), g = this.gain(depth); o.frequency.value = rate; o.connect(g).connect(target); o.start(); this.nodes.push(o); }
  chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }
  loopNoise(...n) { const s = this.src_(); this.chain(s, ...n, this.ambGain); s.start(0, Math.random() * 3); this.nodes.push(s); }
  every(min, max, fn) {
    const tick = () => { if (!this.ambOn) return; fn(); this.timers.push(setTimeout(tick, min + Math.random() * (max - min))); };
    this.timers.push(setTimeout(tick, Math.random() * max));
  }
  burst(dur, type, f, q, peak) {
    const c = this.c, s = this.src_(false), g = this.gain(0), now = c.currentTime;
    this.chain(s, this.filt(type, f, q), g, this.ambGain);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(peak, now + dur * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.start(now, Math.random() * 3); s.stop(now + dur + 0.05);
  }
  chirp() {
    const c = this.c, o = c.createOscillator(), g = this.gain(0), now = c.currentTime, up = Math.random() < 0.6, f0 = 2400 + Math.random() * 1200;
    o.type = 'sine'; o.frequency.setValueAtTime(up ? f0 : f0 * 1.5, now); o.frequency.exponentialRampToValueAtTime(up ? f0 * 1.5 : f0, now + 0.09);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.12, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g).connect(this.ambGain); o.start(now); o.stop(now + 0.15);
  }
  ping(freq, peak = 0.06) {
    const c = this.c, o = c.createOscillator(), g = this.gain(0), now = c.currentTime;
    o.frequency.value = freq; g.gain.setValueAtTime(peak, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.connect(g).connect(this.ambGain); o.start(now); o.stop(now + 0.55);
  }

  startAmbient(layers = [], level = 0.14) {
    this.stopAmbient();
    if (!layers.length) return;
    this.ambOn = true;
    const now = this.c.currentTime;
    this.ambGain.gain.cancelScheduledValues(now);
    this.ambGain.gain.setValueAtTime(0, now);
    this.ambGain.gain.linearRampToValueAtTime(level, now + 2.5);
    for (const L of layers) {
      if (L === 'rain') {
        this.loopNoise(this.filt('highpass', 900), this.filt('lowpass', 6500), this.gain(0.45));
        this.every(25, 90, () => this.burst(0.03, 'bandpass', 1500 + Math.random() * 3500, 3, 0.25));
      } else if (L === 'wind') {
        const bp = this.filt('bandpass', 420, 0.8), g = this.gain(0.6);
        this.loopNoise(bp, g); this.lfo(0.06, 240, bp.frequency); this.lfo(0.09, 0.3, g.gain);
      } else if (L === 'leaves') {
        const g = this.gain(0.02); this.loopNoise(this.filt('highpass', 2300), g);
        this.every(140, 520, () => { const n = this.c.currentTime; g.gain.setTargetAtTime(0.25 + Math.random() * 0.35, n, 0.03); g.gain.setTargetAtTime(0.02, n + 0.08 + Math.random() * 0.15, 0.08); });
      } else if (L === 'sea') {
        const g = this.gain(0.45); this.loopNoise(this.filt('lowpass', 480), g); this.lfo(0.085, 0.38, g.gain);
        const g2 = this.gain(0.06); this.loopNoise(this.filt('highpass', 3000), g2); this.lfo(0.085, 0.05, g2.gain);
      } else if (L === 'city') {
        this.loopNoise(this.filt('lowpass', 200), this.gain(0.7));
        this.every(3500, 8000, () => this.burst(2.6, 'bandpass', 500 + Math.random() * 500, 0.8, 0.35));
      } else if (L === 'office') {
        [100, 50].forEach((f, i) => { const o = this.c.createOscillator(); o.frequency.value = f; o.connect(this.gain(i ? 0.035 : 0.025)).connect(this.ambGain); o.start(); this.nodes.push(o); });
        this.loopNoise(this.filt('lowpass', 320), this.gain(0.18));
        this.every(1200, 3800, () => {
          const n = 3 + Math.floor(Math.random() * 10);
          for (let k = 0; k < n; k++) this.timers.push(setTimeout(() => this.ambOn && this.burst(0.012, 'bandpass', 2500 + Math.random() * 1500, 2, 0.4), k * (70 + Math.random() * 70)));
        });
      } else if (L === 'fire') {
        const g = this.gain(0.2); this.loopNoise(this.filt('lowpass', 600), g); this.lfo(0.3, 0.08, g.gain);
        this.every(40, 300, () => this.burst(0.006, 'highpass', 1500, 0.7, 0.2 + Math.random() * 0.6));
      } else if (L === 'cafe') {
        const g = this.gain(0.32); this.loopNoise(this.filt('bandpass', 460, 0.9), g); this.lfo(0.2, 0.08, g.gain);
        this.loopNoise(this.filt('bandpass', 950, 1.2), this.gain(0.14));
        this.every(3000, 8000, () => this.ping(2600 + Math.random() * 900));
      } else if (L === 'birds') {
        this.every(700, 2800, () => { const n = 2 + Math.floor(Math.random() * 4); for (let k = 0; k < n; k++) this.timers.push(setTimeout(() => this.ambOn && this.chirp(), k * 130)); });
      }
    }
  }

  stopAmbient() {
    this.ambOn = false;
    this.timers.forEach(clearTimeout); this.timers = [];
    const now = this.c.currentTime;
    this.ambGain.gain.cancelScheduledValues(now);
    this.ambGain.gain.setValueAtTime(this.ambGain.gain.value, now);
    this.ambGain.gain.linearRampToValueAtTime(0, now + 0.4);
    const old = this.nodes; this.nodes = [];
    setTimeout(() => old.forEach(n => { try { n.stop(); } catch { /* */ } try { n.disconnect(); } catch { /* */ } }), 500);
  }

  // ---------- generative sketch when the song can't be played ----------
  startSketch(Mu, D = 30) {
    this.stopSketch();
    const c = this.c, bp = 60 / (Mu.bpm || 96), minor = Mu.mode === 'minor', root = 48 + (Mu.keyIndex || 0);
    const prog = minor ? [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']] : [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']];
    const cutoff = 500 + (Mu.brightness ?? 0.5) * 2200, beats = Mu.energy > 0.45;
    const now = c.currentTime + 0.1;
    this.t0 = now; this.D = D;
    this.songGain.gain.cancelScheduledValues(now);
    this.songGain.gain.setValueAtTime(0.0, now); this.songGain.gain.linearRampToValueAtTime(0.9, now + 1);
    let next = now, bar = 0;
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const schedule = () => {
      while (next < c.currentTime + 0.6) {
        const [off, q] = prog[bar % 4], notes = [0, q === 'm' ? 3 : 4, 7].map(n => root + off + n + 12);
        const lp = this.filt('lowpass', cutoff, 0.5), g = this.gain(0);
        lp.connect(g).connect(this.songGain);
        const len = bp * 4;
        g.gain.setValueAtTime(0, next); g.gain.linearRampToValueAtTime(0.11, next + 0.5); g.gain.setTargetAtTime(0, next + len - 0.2, 0.5);
        for (const n of notes) for (const det of [-6, 6]) {
          const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = midi(n); o.detune.value = det;
          o.connect(lp); o.start(next); o.stop(next + len + 2);
        }
        const bo = c.createOscillator(), bg = this.gain(0); bo.frequency.value = midi(root + off - 12);
        bg.gain.setValueAtTime(0.0, next); bg.gain.linearRampToValueAtTime(0.16, next + 0.05); bg.gain.setTargetAtTime(0, next + len * 0.8, 0.3);
        bo.connect(bg).connect(this.songGain); bo.start(next); bo.stop(next + len + 1);
        if (beats) for (let b = 0; b < 4; b++) {
          const tb = next + b * bp, k = c.createOscillator(), kg = this.gain(0);
          k.frequency.setValueAtTime(120, tb); k.frequency.exponentialRampToValueAtTime(45, tb + 0.12);
          kg.gain.setValueAtTime(0.5, tb); kg.gain.exponentialRampToValueAtTime(0.001, tb + 0.2);
          k.connect(kg).connect(this.songGain); k.start(tb); k.stop(tb + 0.25);
          const hs = this.src_(false), hg = this.gain(0), th = tb + bp / 2;
          hs.connect(this.filt('highpass', 7000)).connect(hg).connect(this.songGain);
          hg.gain.setValueAtTime(0.07, th); hg.gain.exponentialRampToValueAtTime(0.001, th + 0.04);
          hs.start(th, Math.random()); hs.stop(th + 0.06);
        }
        next += len; bar++;
      }
    };
    schedule();
    this.sketchTimer = setInterval(schedule, 150);
  }

  stopSketch() {
    if (this.sketchTimer) { clearInterval(this.sketchTimer); this.sketchTimer = null; }
  }

  stopAll() {
    this.stopSong(0.3); this.stopSketch(); this.stopAmbient();
    const now = this.c.currentTime;
    this.songGain.gain.cancelScheduledValues(now);
    this.songGain.gain.setValueAtTime(this.songGain.gain.value, now);
    this.songGain.gain.linearRampToValueAtTime(0, now + 0.3);
  }
}
