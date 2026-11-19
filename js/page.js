// The diary page (1080×1920). Constant: paper, margins, date stamp, "seal of the day", title block,
// handwritten caption, song line, margin notes. Variable: photo treatment, composition, decorations,
// rhythm and motion — all from the computed style.
import { getGL } from './gl.js';
import { clamp, easeOut, rng, hashStr, rgbCss, fmtDateDots, weekday, TIME_RU, MONTHS_GEN, parseISO, canvasBlob } from './util.js';
import { TECH, TECH_ORDER } from './mood.js';

export const PW = 1080, PH = 1920;
const M = 76;
const WIN = { x: M, y: 190, w: PW - 2 * M, h: 1220 };
const FOOT = 1452;
const INK = [29, 26, 23];
const PAPER = [242, 236, 226];
const TRANS_ID = { dissolve: 0, cut: 1, slide: 2, fade: 3, ink: 4, burn: 5 };
const RS = 0.8;
const mixRGB = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

let paperCanvas = null;
function getPaper() {
  if (paperCanvas) return paperCanvas;
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const x = c.getContext('2d');
  x.fillStyle = rgbCss(PAPER); x.fillRect(0, 0, PW, PH);
  const id = x.getImageData(0, 0, PW, PH), d = id.data, r = rng(7);
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9; }
  x.putImageData(id, 0, 0);
  x.strokeStyle = 'rgba(120,100,80,0.06)'; x.lineWidth = 1;
  for (let i = 0; i < 2600; i++) {
    const px = r() * PW, py = r() * PH, a = r() * Math.PI, l = 6 + r() * 22;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + 3, py + Math.sin(a) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
  }
  const g = x.createRadialGradient(PW / 2, PH / 2, PH * 0.3, PW / 2, PH / 2, PH * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(110,80,40,0.11)');
  x.fillStyle = g; x.fillRect(0, 0, PW, PH);
  return (paperCanvas = c);
}

const setLS = (x, px) => { if ('letterSpacing' in x) x.letterSpacing = px + 'px'; };

export class PageRenderer {
  constructor(canvas) {
    this.cv = canvas; canvas.width = PW; canvas.height = PH;
    this.ctx = canvas.getContext('2d');
    this.gl = getGL();
    this.photos = [];
  }

  async load(day, comp) {
    this.release();
    this.day = day;
    for (const p of day.photos) {
      const bmp = await createImageBitmap(p.blob);
      const g = this.gl.prepare(bmp);
      bmp.close?.();
      // per-photo levels: stretch the photo's own tonal range (dark night shots still read as images)
      const L = p.stats?.lum ?? 0.5, C = p.stats?.contrast ?? 0.2;
      g.lo = clamp(L - 1.8 * C, 0, 0.6); g.hi = clamp(L + 1.8 * C, g.lo + 0.15, 1);
      this.photos.push(g);
    }
    this.seed = hashStr(day.id);
    this.setComputed(comp);
  }

  get D() { return this.tl?.D || 30; }

  setComputed(comp) {
    this.c = comp; this.st = comp.style;
    this.layout = makeLayout(comp.primary, this.st, rng(this.seed));
    this.deco = makeDeco(comp.primary, this.st, rng(this.seed ^ 0x9e3779), this.layout, this.day);
    this.tl = makeTimeline(this.st, this.day.inputs.music, this.photos.length);
  }

  release() { for (const p of this.photos) this.gl.release(p); this.photos = []; }
  dispose() { this.release(); }

  posterTime() { const s = this.tl.shots; return s.length > 1 ? s[0] + (s[1] - s[0]) * 0.45 : 8; }

  fitFor(photo) {
    const wa = this.layout.rect.w / this.layout.rect.h, pa = photo.aspect;
    return pa > wa ? [wa / pa, 1] : [1, pa / wa];
  }

  kbFor(i, p, photo, beat) {
    const r = rng(this.seed + i * 7919);
    const zoomIn = r() > 0.35;
    let s = 1.02 + this.st.kbRange * (zoomIn ? p : 1 - p);
    s += beat * 0.012 * this.c.mood.E;
    const ang = r() * Math.PI * 2;
    const fit = this.fitFor(photo);
    const mx = Math.max(0, (1 - fit[0] / s) / 2), my = Math.max(0, (1 - fit[1] / s) / 2);
    const k = (p - 0.5) * 1.6;
    return [s, Math.cos(ang) * mx * k * 0.9, Math.sin(ang) * my * k * 0.9];
  }

  renderPhoto(t, beat, poster) {
    const st = this.st, tl = this.tl, n = this.photos.length, L = this.layout;
    let i = 0;
    for (let k = 0; k < tl.shots.length; k++) if (tl.shots[k] <= t) i = k;
    const start = tl.shots[i], end = tl.shots[i + 1] ?? tl.D;
    const pa = this.photos[i % n];
    const pb = this.photos[i + 1 < tl.shots.length ? (i + 1) % n : 0];
    const td = st.transDur;
    let mix = 0, hasB = 0;
    if (n > 1 && !poster && t > end - td) { mix = clamp((t - (end - td)) / td); hasB = 1; }
    const p = clamp((t - start) / (end - start + td));
    const w = Math.round(L.rect.w * RS), h = Math.round(L.rect.h * RS);
    return this.gl.render(w, h, {
      A: pa, B: pb, hasB, mix, trans: TRANS_ID[st.transition],
      fitA: this.fitFor(pa), fitB: this.fitFor(pb),
      kbA: this.kbFor(i, p, pa, beat), kbB: this.kbFor(i + 1, 0, pb, beat),
      time: poster ? 3 : t, beat, energy: this.c.mood.E, seed: (this.seed % 1000) / 100, st,
    });
  }

  draw(t, live, opts = {}) {
    const x = this.ctx, L = this.layout, poster = !!opts.poster, tl = this.tl;
    const since = (((t - tl.off) % tl.bp) + tl.bp) % tl.bp;
    const bi = Math.floor((t - tl.off) / tl.bp);
    let beat = Math.exp(-since / 0.14) * (((bi % 4) + 4) % 4 === 0 ? 1 : 0.6);
    if (live) beat = Math.max(beat * 0.5, clamp(live.bass * 1.3 - 0.25));
    if (poster) beat = 0;
    const env = { t, beat, E: this.c.mood.E, intro: poster ? 1 : easeOut(t / 1.1), poster, bp: tl.bp };

    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.shadowColor = 'transparent';
    x.drawImage(getPaper(), 0, 0);
    decoBack(x, this, env);

    const img = this.renderPhoto(t, beat, poster);
    x.save();
    x.globalAlpha = env.intro;
    rotateAbout(x, L);
    if (L.frame) {
      x.shadowColor = 'rgba(50,35,20,0.28)'; x.shadowBlur = 34; x.shadowOffsetY = 14;
      x.fillStyle = '#fbf9f4'; x.fillRect(L.frame.x, L.frame.y, L.frame.w, L.frame.h);
      x.shadowColor = 'transparent';
    }
    if (L.clip === 'blob') x.clip(L.blob);
    x.drawImage(img, L.rect.x, L.rect.y, L.rect.w, L.rect.h);
    x.restore();
    if (this.c.primary === 'kandinsky' || this.c.primary === 'hopper') {
      x.save(); x.globalAlpha = env.intro; x.strokeStyle = rgbCss(INK, 0.9); x.lineWidth = this.c.primary === 'kandinsky' ? 5 : 2;
      x.strokeRect(L.rect.x, L.rect.y, L.rect.w, L.rect.h); x.restore();
    }

    decoFront(x, this, env);
    drawNotes(x, this, env);
    drawHeader(x, this);
    drawFooter(x, this, env);
  }

  async poster(width = PW) {
    this.draw(this.posterTime(), null, { poster: true });
    if (width === PW) return canvasBlob(this.cv, 'image/jpeg', 0.92);
    const out = document.createElement('canvas');
    out.width = width; out.height = Math.round(width * PH / PW);
    out.getContext('2d').drawImage(this.cv, 0, 0, out.width, out.height);
    return canvasBlob(out, 'image/jpeg', 0.86);
  }
}

// The back of the page: the same paper and header, with the day's rules written out —
// "why it looks like this", the palette, the technique mix and a legend for the seal.
export function drawBackPage(cv, day, comp) {
  cv.width = PW; cv.height = PH;
  const x = cv.getContext('2d');
  const ink = rgbCss(INK), acc = comp.style.accents[0];
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(getPaper(), 0, 0);
  drawHeader(x, { day, c: comp });
  x.save();
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillStyle = ink; x.font = '600 60px Literata';
  x.fillText('Почему этот день', M, 268);
  x.fillText('выглядит так', M, 336);
  x.font = 'italic 400 30px Literata'; x.fillStyle = rgbCss(INK, 0.62);
  x.fillText(`оборот страницы «${day.meta.title}»`, M, 388, PW - 2 * M);
  x.strokeStyle = rgbCss(INK, 0.55); x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(M, 424); x.lineTo(PW - M, 424); x.stroke();

  const colW = 150, textW = PW - 2 * M - colW;
  // the back leads with the headline rules: which technique and whether the signals disagree
  const ORDER = ['Система', 'Спор', 'Текст', 'Фото', 'Музыка', 'Погода', 'Звук', 'Голос'];
  const items = [...comp.recipe].sort((a, b) => ORDER.indexOf(a.src) - ORDER.indexOf(b.src));
  let y = 480;
  for (const r of items) {
    x.font = '400 26px Literata';
    const lines = wrapWords(x, r.rule.split(/\s+/), textW, x.measureText(' ').width).slice(0, 2).map(l => l.map(o => o.word).join(' '));
    const need = 36 + lines.length * 31 + 16;
    if (y + need > 1430) continue;
    x.font = '600 18px "JetBrains Mono"'; x.fillStyle = rgbCss(acc); x.fillText(r.src.toUpperCase(), M, y);
    x.font = '600 29px Literata'; x.fillStyle = ink; x.fillText(r.sig, M + colW, y, textW);
    x.font = '400 26px Literata'; x.fillStyle = rgbCss(INK, 0.74);
    lines.forEach((l, i) => x.fillText(l, M + colW, y + 36 + i * 31));
    y += need;
  }

  const py = 1470;
  x.font = '600 18px "JetBrains Mono"'; x.fillStyle = rgbCss(INK, 0.55);
  x.fillText('ПАЛИТРА ДНЯ', M, py);
  [...comp.style.palette, ...comp.style.accents].slice(0, 8).forEach((c, i) => { x.fillStyle = rgbCss(c); x.fillRect(M + i * 62, py + 16, 52, 52); });

  const ty = 1584;
  x.font = '600 18px "JetBrains Mono"'; x.fillStyle = rgbCss(INK, 0.55);
  x.fillText('СМЕСЬ ТЕХНИК', M, ty);
  TECH_ORDER.forEach((k, i) => {
    const yy = ty + 38 + i * 36, w = comp.weights[k];
    x.font = `${k === comp.primary ? 600 : 400} 22px Literata`; x.fillStyle = ink; x.fillText(TECH[k].name, M, yy);
    x.fillStyle = rgbCss(INK, 0.1); x.fillRect(M + 210, yy - 13, 300, 10);
    x.fillStyle = k === comp.primary ? rgbCss(acc) : rgbCss(INK, 0.7); x.fillRect(M + 210, yy - 13, Math.max(2, 300 * w), 10);
    x.font = '400 18px "JetBrains Mono"'; x.fillStyle = rgbCss(INK, 0.7); x.fillText(Math.round(w * 100) + '%', M + 524, yy);
  });

  const sx = 830, sy = 1610;
  drawSeal(x, sx, sy, 86, comp);
  x.font = '500 30px Caveat'; x.fillStyle = rgbCss(INK, 0.82);
  x.fillText('приятность', sx + 46, sy - 98);
  x.fillText('энергия', sx + 62, sy + 120);
  x.fillText('тепло', sx - 150, sy + 120);
  x.fillText('люди', sx - 140, sy - 98);
  x.font = '500 26px Caveat'; x.fillStyle = rgbCss(INK, 0.62);
  x.fillText('в центре — время суток', sx - 120, sy + 170);

  x.font = '500 34px Caveat'; x.fillStyle = rgbCss(INK, 0.7);
  x.fillText('ваши слова, снимки и песня — по правилам одной системы', M, PH - 52, PW - 2 * M);
  x.restore();
}

export async function renderCover(day, comp, width = 540) {
  const R = new PageRenderer(document.createElement('canvas'));
  await R.load(day, comp);
  const blob = await R.poster(width);
  R.dispose();
  return blob;
}

// ---------------- timeline ----------------
function makeTimeline(st, Mu, n) {
  const D = clamp(Mu.segDur || 30, 12, 30);
  const bp = 60 / clamp(Mu.bpm || 96, 50, 200);
  const off = Mu.beatOffset || 0;
  let shot = clamp(st.shotBeats * bp, 2.4, 9);
  if (n > 1 && n * shot > D - 1) shot = Math.max(1.6, (D - 1) / n);
  const shots = [0];
  if (n > 1) {
    for (let t = shot; t < D - 0.8; t += shot) {
      const q = off + Math.round((t - off) / bp) * bp;
      if (q > shots[shots.length - 1] + 0.8 && q < D - 0.5) shots.push(q);
    }
  }
  return { D, bp, off, shot, shots, n };
}

// ---------------- layout ----------------
function makeLayout(primary, st, r) {
  const air = st.air;
  let rect, clip = 'rect', rot = 0, frame = null, blob = null;
  if (primary === 'monet') {
    const ins = 10 + air * 60;
    rect = { x: WIN.x + ins, y: WIN.y + ins, w: WIN.w - 2 * ins, h: WIN.h - 2 * ins };
  } else if (primary === 'kandinsky') {
    rect = { ...WIN };
  } else if (primary === 'matisse') {
    const ins = 64;
    rect = { x: WIN.x + ins, y: WIN.y + ins * 0.7, w: WIN.w - 2 * ins, h: WIN.h - ins * 1.7 };
    clip = 'blob'; blob = blobPath(rect, r); rot = (r() - 0.5) * st.tilt * 2;
  } else if (primary === 'hopper') {
    const h = WIN.h * (0.6 - 0.1 * air);
    rect = { x: WIN.x, y: WIN.y + WIN.h - h, w: WIN.w, h };
  } else if (primary === 'ma') {
    const w = WIN.w * (0.6 - 0.14 * air), h = w * 1.3, left = r() < 0.5;
    rect = { x: left ? WIN.x + 30 : WIN.x + WIN.w - w - 30, y: WIN.y + 90 + r() * 70, w, h };
  } else {
    const ow = WIN.w * 0.84, pw = ow - 68, ph = pw * 1.2, oh = ph + 34 + 150;
    const ox = WIN.x + (WIN.w - ow) / 2, oy = WIN.y + (WIN.h - oh) / 2 - 10;
    frame = { x: ox, y: oy, w: ow, h: oh };
    rect = { x: ox + 34, y: oy + 34, w: pw, h: ph };
    rot = (r() < 0.5 ? -1 : 1) * (0.015 + st.tilt * 0.6);
  }
  return { rect, clip, rot, frame, blob };
}

function rotateAbout(x, L) {
  if (!L.rot) return;
  const R = L.frame || L.rect, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  x.translate(cx, cy); x.rotate(L.rot); x.translate(-cx, -cy);
}

function blobPath(R, r) {
  const cx = R.x + R.w / 2, cy = R.y + R.h / 2, rx = R.w / 2, ry = R.h / 2, N = 14, pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), e = 2 / 3.4, k = 0.93 + r() * 0.09;
    pts.push([cx + Math.sign(c) * Math.pow(Math.abs(c), e) * rx * k, cy + Math.sign(s) * Math.pow(Math.abs(s), e) * ry * k]);
  }
  const p = new Path2D();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m0 = mid(pts[N - 1], pts[0]);
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < N; i++) { const m = mid(pts[i], pts[(i + 1) % N]); p.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  p.closePath();
  return p;
}

// ---------------- decorations ----------------
function makeDeco(primary, st, r, L, day) {
  const A = st.accents, P = st.palette, R = L.rect, d = {};
  if (primary === 'kandinsky') {
    const shapes = [];
    shapes.push({ k: 'ring', x: R.x + R.w * (0.2 + r() * 0.6), y: R.y + R.h * (0.1 + r() * 0.28), r: 110 + r() * 90, at: 1 });
    shapes.push({ k: 'circle', x: R.x + R.w * (0.15 + r() * 0.7), y: R.y + R.h * (0.55 + r() * 0.35), r: 40 + r() * 70, c: A[1], at: 2 });
    for (let i = 0; i < 4; i++) {
      const ang = (0.2 + r() * 0.9) * (r() < 0.5 ? 1 : -1) + (i % 2 ? Math.PI / 2 : 0), len = 380 + r() * 520;
      const cx = R.x + r() * R.w, cy = R.y + r() * R.h;
      shapes.push({ k: 'line', x1: cx - Math.cos(ang) * len / 2, y1: cy - Math.sin(ang) * len / 2, x2: cx + Math.cos(ang) * len / 2, y2: cy + Math.sin(ang) * len / 2, w: 4 + r() * 12, c: i === 0 ? A[0] : INK, at: 3 + i });
    }
    for (let i = 0; i < 2; i++) {
      const cx = R.x + r() * R.w, cy = R.y + r() * R.h, s = 90 + r() * 120, a = r() * Math.PI * 2;
      shapes.push({ k: 'tri', pts: [[cx + Math.cos(a) * s, cy + Math.sin(a) * s], [cx + Math.cos(a + 2.6) * s * 0.6, cy + Math.sin(a + 2.6) * s * 0.6], [cx + Math.cos(a + 3.5) * s * 0.5, cy + Math.sin(a + 3.5) * s * 0.5]], c: i ? A[2] : A[1], at: 7 + i });
    }
    shapes.push({ k: 'dots', x: R.x + R.w * (0.1 + r() * 0.6), y: R.y + R.h * (0.2 + r() * 0.6), ang: r() * Math.PI, at: 9 });
    const a0 = r() * 6;
    shapes.push({ k: 'arc', x: R.x + R.w * r(), y: R.y + R.h * r(), r: 150 + r() * 120, a0, a1: a0 + 1.2 + r() * 1.5, at: 10 });
    d.shapes = shapes;
  } else if (primary === 'matisse') {
    const kinds = ['leaf', 'algae', 'star', 'leaf', 'algae', 'drop', 'leaf', 'star'];
    // cut-outs hug the photo's edges but never cover the constant header or the title block
    d.cuts = kinds.map((kind, i) => {
      const side = i % 4, s = 60 + r() * 70;
      let x, y;
      if (side === 0) { x = R.x + r() * R.w * 0.6; y = R.y + 10 + r() * 90; }
      else if (side === 1) { x = R.x + R.w - 60 + r() * 80; y = R.y + 120 + r() * R.h * 0.5; }
      else if (side === 2) { x = R.x + R.w * 0.4 + r() * R.w * 0.55; y = R.y + R.h - 140 + r() * 80; }
      else { x = R.x - 20 + r() * 90; y = R.y + R.h * 0.35 + r() * R.h * 0.45; }
      x = clamp(x, WIN.x - 30 + s * 0.4, WIN.x + WIN.w + 30 - s * 0.4);
      y = clamp(y, WIN.y + s * 0.9, WIN.y + WIN.h - s * 1.1);
      return { kind, x, y, s, rot: r() * Math.PI * 2, c: A[i % A.length], ph: r() * 6, lobes: 5 + Math.floor(r() * 4) };
    });
    d.block = { rot: (r() - 0.5) * 0.05, c: mixRGB(A[1], PAPER, 0.6) };
  } else if (primary === 'hopper') {
    d.patch = { w: 240 + r() * 140, skew: 120 + r() * 80, x0: WIN.x + 120 + r() * (WIN.w - 520) };
  } else if (primary === 'ma') {
    const left = R.x < WIN.x + WIN.w / 2 - R.w / 2;
    d.enso = { x: left ? Math.min(R.x + R.w + 170, WIN.x + WIN.w - 190) : Math.max(R.x - 170, WIN.x + 190), y: R.y + R.h * 0.78, r: 160 + r() * 60, a0: r() * 6, gap: 0.5 + r() * 0.4 };
    d.hanko = { x: left ? WIN.x + WIN.w - 110 : WIN.x + 18, y: WIN.y + WIN.h - 150, ch: (day.meta?.title || 'Д')[0].toUpperCase(), rot: (r() - 0.5) * 0.12 };
  } else if (primary === 'film') {
    const F = L.frame;
    d.tapes = [
      { x: F.x + 40, y: F.y - 6, rot: -0.55 + r() * 0.2 },
      { x: F.x + F.w - 40, y: F.y - 6, rot: 0.55 - r() * 0.2 },
    ];
  } else if (primary === 'monet') {
    d.dabs = Array.from({ length: 54 }, () => {
      const side = Math.floor(r() * 4), u = r();
      const px = side === 0 ? R.x + u * R.w : side === 1 ? R.x + R.w : side === 2 ? R.x + u * R.w : R.x;
      const py = side === 0 ? R.y : side === 1 ? R.y + u * R.h : side === 2 ? R.y + R.h : R.y + u * R.h;
      return { x: px + (r() - 0.5) * 50, y: py + (r() - 0.5) * 50, l: 18 + r() * 40, a: -0.7 + r() * 0.5, w: 8 + r() * 12, c: [P[2], P[3], P[4], A[0], A[1]][Math.floor(r() * 5)], al: 0.45 + r() * 0.4 };
    });
  }
  return d;
}

function decoBack(x, R, env) {
  const p = R.c.primary, d = R.deco, A = R.st.accents, L = R.layout;
  x.save();
  x.globalAlpha = env.intro;
  if (p === 'matisse') {
    const b = d.block, cx = WIN.x + WIN.w / 2, cy = WIN.y + WIN.h / 2;
    x.translate(cx, cy); x.rotate(b.rot); x.fillStyle = rgbCss(b.c);
    x.fillRect(-WIN.w / 2 + 6, -WIN.h / 2 + 20, WIN.w - 12, WIN.h - 40);
  } else if (p === 'hopper') {
    const top = WIN.y, bot = L.rect.y;
    const g = x.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, rgbCss(A[1])); g.addColorStop(1, rgbCss(A[2]));
    x.fillStyle = g; x.fillRect(WIN.x, top, WIN.w, bot - top + 2);
    x.beginPath(); x.rect(WIN.x, top, WIN.w, bot - top); x.clip();
    const pc = d.patch, drift = Math.sin(env.t * 0.06) * 26, px = pc.x0 + drift;
    x.fillStyle = rgbCss(A[0], 0.32);
    x.beginPath(); x.moveTo(px, top + 60); x.lineTo(px + pc.w, top + 60); x.lineTo(px + pc.w + pc.skew, bot - 12); x.lineTo(px + pc.skew, bot - 12); x.closePath(); x.fill();
    x.fillStyle = rgbCss(A[0], 0.14);
    x.fillRect(px + pc.w * 0.48, top + 60, 10, bot - top - 72);
  } else if (p === 'ma') {
    const e = d.enso, prog = env.poster ? 1 : easeOut((env.t - 0.6) / 3);
    const steps = 140, total = Math.PI * 2 - e.gap;
    x.strokeStyle = rgbCss(INK, 0.86); x.lineCap = 'round';
    for (let k = 0; k < steps * prog; k++) {
      const u = k / steps, a = e.a0 + u * total;
      x.lineWidth = 8 + 26 * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.82 + 0.18 * Math.sin(k * 1.7));
      x.globalAlpha = env.intro * (0.55 + 0.35 * Math.sin(k * 0.9 + 1) ** 2);
      x.beginPath(); x.arc(e.x, e.y, e.r, a, a + total / steps + 0.01); x.stroke();
    }
  } else if (p === 'monet') {
    drawDabs(x, d.dabs.slice(0, 30));
  }
  x.restore();
}

function drawDabs(x, dabs) {
  x.lineCap = 'round';
  for (const b of dabs) {
    x.strokeStyle = rgbCss(b.c, b.al); x.lineWidth = b.w;
    x.beginPath(); x.moveTo(b.x, b.y); x.lineTo(b.x + Math.cos(b.a) * b.l, b.y + Math.sin(b.a) * b.l); x.stroke();
  }
}

function cutoutPath(c, scale) {
  const p = new Path2D(), N = 64;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    let rr, sx = 1, sy = 1;
    if (c.kind === 'leaf') rr = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(c.lobes * a / 2)), 0.6);
    else if (c.kind === 'algae') { rr = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(c.lobes * a)); sx = 0.55; sy = 1.35; }
    else if (c.kind === 'star') rr = 0.5 + 0.5 * Math.pow(Math.abs(Math.cos(2.5 * a)), 3);
    else { rr = 0.75 + 0.25 * Math.cos(a); sx = 0.8; }
    const R = c.s * scale * rr;
    const px = Math.cos(a) * R * sx, py = Math.sin(a) * R * sy;
    i ? p.lineTo(px, py) : p.moveTo(px, py);
  }
  p.closePath();
  return p;
}

function decoFront(x, R, env) {
  const p = R.c.primary, d = R.deco, A = R.st.accents, L = R.layout, { t, beat, E, poster, bp } = env;
  x.save();
  x.globalAlpha = env.intro;
  if (p === 'kandinsky') {
    x.strokeStyle = rgbCss(INK, 0.22); x.lineWidth = 1.5;
    for (let i = 1; i < 4; i++) { const gx = WIN.x + (WIN.w * i) / 4; x.beginPath(); x.moveTo(gx, WIN.y); x.lineTo(gx, WIN.y + WIN.h); x.stroke(); }
    for (let j = 1; j < 6; j++) { const gy = WIN.y + (WIN.h * j) / 6; x.beginPath(); x.moveTo(WIN.x, gy); x.lineTo(WIN.x + WIN.w, gy); x.stroke(); }
    for (const s of d.shapes) {
      const enter = poster ? 1 : easeOut((t - (0.4 + s.at * bp)) / 0.25);
      if (enter <= 0) continue;
      const k = enter * (1 + beat * 0.05);
      x.save();
      if (s.k === 'ring') {
        x.translate(s.x, s.y); x.scale(k, k);
        x.fillStyle = rgbCss(A[0], 0.88); x.beginPath(); x.arc(0, 0, s.r, 0, Math.PI * 2); x.fill();
        x.fillStyle = rgbCss(A[1], 0.95); x.beginPath(); x.arc(0, 0, s.r * 0.62, 0, Math.PI * 2); x.fill();
        x.fillStyle = rgbCss(INK, 0.9); x.beginPath(); x.arc(0, 0, s.r * 0.22, 0, Math.PI * 2); x.fill();
      } else if (s.k === 'circle') {
        x.fillStyle = rgbCss(s.c, 0.9); x.beginPath(); x.arc(s.x, s.y, s.r * k, 0, Math.PI * 2); x.fill();
      } else if (s.k === 'line') {
        x.globalCompositeOperation = 'source-over';
        x.strokeStyle = rgbCss(s.c, 0.92); x.lineWidth = s.w; x.lineCap = 'butt';
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        x.beginPath(); x.moveTo(mx + (s.x1 - mx) * enter, my + (s.y1 - my) * enter); x.lineTo(mx + (s.x2 - mx) * enter, my + (s.y2 - my) * enter); x.stroke();
      } else if (s.k === 'tri') {
        const cx = (s.pts[0][0] + s.pts[1][0] + s.pts[2][0]) / 3, cy = (s.pts[0][1] + s.pts[1][1] + s.pts[2][1]) / 3;
        x.translate(cx, cy); x.rotate(t * 0.02); x.scale(k, k); x.translate(-cx, -cy);
        x.fillStyle = rgbCss(s.c, 0.85); x.beginPath(); x.moveTo(...s.pts[0]); x.lineTo(...s.pts[1]); x.lineTo(...s.pts[2]); x.closePath(); x.fill();
      } else if (s.k === 'dots') {
        x.globalCompositeOperation = 'source-over'; x.fillStyle = rgbCss(INK, 0.9);
        for (let i = 0; i < 7; i++) { x.beginPath(); x.arc(s.x + Math.cos(s.ang) * i * 34, s.y + Math.sin(s.ang) * i * 34, (6 + (i % 3) * 4) * enter, 0, Math.PI * 2); x.fill(); }
      } else if (s.k === 'arc') {
        x.globalCompositeOperation = 'source-over'; x.strokeStyle = rgbCss(INK, 0.9); x.lineWidth = 6;
        x.beginPath(); x.arc(s.x, s.y, s.r, s.a0, s.a0 + (s.a1 - s.a0) * enter); x.stroke();
      }
      x.restore();
    }
  } else if (p === 'matisse') {
    for (const c of d.cuts) {
      x.save();
      const sway = Math.sin((t * Math.PI) / (bp * 2) + c.ph) * 0.09 * (0.4 + E);
      x.translate(c.x, c.y); x.rotate(c.rot + sway);
      x.fillStyle = rgbCss(c.c);
      x.fill(cutoutPath(c, (poster ? 1 : easeOut((t - 0.5 - c.ph * 0.1) / 0.6)) * (1 + beat * 0.07)));
      x.restore();
    }
  } else if (p === 'film') {
    const F = L.frame, mo = parseISO(R.day.date);
    x.save();
    rotateAbout(x, L);
    x.font = '700 34px "JetBrains Mono"'; x.textAlign = 'right';
    x.shadowColor = rgbCss(A[0], 0.8); x.shadowBlur = 10;
    x.fillStyle = rgbCss(A[0], 0.95);
    const [y, m, dd] = R.day.date.split('-');
    x.fillText(`'${y.slice(2)} ${m} ${dd}`, L.rect.x + L.rect.w - 26, L.rect.y + L.rect.h - 26);
    x.shadowColor = 'transparent';
    x.textAlign = 'center'; x.font = '500 54px Caveat'; x.fillStyle = rgbCss(INK, 0.82);
    x.fillText(`${mo.getDate()} ${MONTHS_GEN[mo.getMonth()]}`, F.x + F.w / 2, F.y + F.h - 58);
    for (const tp of d.tapes) {
      x.save(); x.translate(tp.x, tp.y); x.rotate(tp.rot);
      x.fillStyle = rgbCss(A[1], 0.72); x.fillRect(-80, -22, 160, 44);
      x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 1;
      for (let i = -76; i < 80; i += 9) { x.beginPath(); x.moveTo(i, -22); x.lineTo(i + 4, 22); x.stroke(); }
      x.restore();
    }
    x.restore();
  } else if (p === 'ma') {
    const hk = d.hanko, a = poster ? 1 : easeOut((t - 3.2) / 0.5);
    if (a > 0) {
      x.save(); x.globalAlpha = env.intro * a; x.translate(hk.x + 46, hk.y + 46); x.rotate(hk.rot);
      x.fillStyle = rgbCss(A[0], 0.92); roundRect(x, -46, -46, 92, 92, 10); x.fill();
      x.fillStyle = rgbCss(PAPER); x.font = '700 56px Literata'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(hk.ch, 0, 4);
      x.restore();
    }
  } else if (p === 'monet') {
    drawDabs(x, d.dabs.slice(30));
  }
  x.restore();
}

function roundRect(x, X, Y, W, H, r) {
  x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}

// ---------------- constant elements ----------------
function drawNotes(x, R, env) {
  const notes = R.day.meta?.sensory || [];
  if (!notes.length) return;
  const r = rng(R.seed ^ 0x51ab);
  const kand = R.c.primary === 'kandinsky';
  const slotW = (WIN.w - 40) / notes.length;
  notes.forEach((txt0, i) => {
    const jx = (r() - 0.5) * 30, jy = (r() - 0.5) * 14, rot = (r() - 0.5) * 0.1;
    const a = env.poster ? 1 : easeOut((env.t - (6 + i * 3.5)) / 0.8);
    if (a <= 0) return;
    const txt = kand ? txt0.toUpperCase() : txt0;
    x.save();
    let size = kand ? 22 : 38;
    x.font = kand ? `600 ${size}px "JetBrains Mono"` : `500 ${size}px Caveat`;
    let tw = x.measureText(txt).width;
    const maxW = slotW + 30 - (kand ? 28 : 36);
    if (tw > maxW) { size = Math.max(kand ? 15 : 26, Math.floor(size * maxW / tw)); x.font = kand ? `600 ${size}px "JetBrains Mono"` : `500 ${size}px Caveat`; tw = Math.min(x.measureText(txt).width, maxW); }
    const w = tw + (kand ? 28 : 36), h = kand ? 40 : 54;
    const cx = WIN.x + 20 + slotW * i + slotW / 2 + jx, cy = WIN.y + WIN.h - 4 + (i % 2 ? 36 : -8) + jy;
    x.translate(cx, cy + (1 - a) * 16); x.rotate(rot); x.globalAlpha = a;
    if (kand) { x.fillStyle = rgbCss(INK, 0.94); x.fillRect(-w / 2, -h / 2, w, h); x.fillStyle = rgbCss(PAPER); }
    else {
      x.shadowColor = 'rgba(60,40,20,0.22)'; x.shadowBlur = 10; x.shadowOffsetY = 3;
      x.fillStyle = 'rgba(251,248,241,0.97)'; x.fillRect(-w / 2, -h / 2, w, h);
      x.shadowColor = 'transparent'; x.fillStyle = rgbCss(INK, 0.85);
    }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, 0, kand ? 1 : 3, maxW);
    x.restore();
  });
}

function drawHeader(x, R) {
  const d = R.day, c = R.c;
  x.save();
  x.fillStyle = rgbCss(INK, 0.86); x.font = '500 27px "JetBrains Mono"'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  const parts = [fmtDateDots(d.date), weekday(d.date, true), TIME_RU[c.mood.light]];
  if (d.inputs.weather) parts.push(`${d.inputs.weather.text} ${Math.round(d.inputs.weather.tmax)}°`);
  x.fillText(parts.join('  ·  ').toUpperCase(), M, 116);
  x.font = '400 18px "JetBrains Mono"'; x.fillStyle = rgbCss(INK, 0.5);
  x.fillText('ПОГОДА ВНУТРИ  ·  ДНЕВНИК', M, 150);
  drawSeal(x, PW - M - 50, 118, 46, c);
  x.restore();
}

// Seal of the day: four arcs = приятность, энергия, тепло, люди; centre glyph = time of day.
function drawSeal(x, cx, cy, r, c) {
  const m = c.mood, ink = rgbCss(INK, 0.86);
  x.save();
  x.strokeStyle = ink; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  const vals = [(m.V + 1) / 2, m.E, (m.W + 1) / 2, (m.S + 1) / 2];
  x.lineWidth = 7; x.lineCap = 'butt';
  vals.forEach((v, i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2 + 0.14, span = (Math.PI / 2 - 0.28) * clamp(v, 0.08, 1);
    x.strokeStyle = i === 0 ? rgbCss(c.style.accents[0]) : ink;
    x.beginPath(); x.arc(cx, cy, r * 0.72, a0, a0 + span); x.stroke();
  });
  x.fillStyle = ink; x.strokeStyle = ink; x.lineWidth = 2;
  const g = r * 0.3;
  if (m.light === 'day') { x.beginPath(); x.arc(cx, cy, g * 0.75, 0, Math.PI * 2); x.fill(); }
  else if (m.light === 'night') {
    x.beginPath(); x.arc(cx, cy, g * 0.8, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(cx + g * 0.4, cy - g * 0.25, g * 0.7, 0, Math.PI * 2); x.fill();
  } else {
    x.beginPath(); x.arc(cx, cy + g * 0.25, g * 0.7, Math.PI, 0); x.fill();
    x.beginPath(); x.moveTo(cx - g * 1.2, cy + g * 0.3); x.lineTo(cx + g * 1.2, cy + g * 0.3); x.stroke();
    if (m.light === 'morning') for (let k = 0; k < 3; k++) { const a = Math.PI + (k + 1) * Math.PI / 4; x.beginPath(); x.moveTo(cx + Math.cos(a) * g, cy + g * 0.25 + Math.sin(a) * g); x.lineTo(cx + Math.cos(a) * g * 1.45, cy + g * 0.25 + Math.sin(a) * g * 1.45); x.stroke(); }
  }
  x.restore();
}

// Russian typesetting: short prepositions and conjunctions never hang at the end of a line.
const SHORT = new Set(['в', 'во', 'у', 'с', 'со', 'и', 'к', 'ко', 'о', 'об', 'на', 'за', 'по', 'до', 'от', 'из', 'не', 'а', 'но', 'под', 'над', 'для', 'при', 'без']);
function bindShort(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (SHORT.has(words[i].toLowerCase()) && i < words.length - 1) { words[i + 1] = words[i] + ' ' + words[i + 1]; continue; }
    out.push(words[i]);
  }
  return out;
}

function wrapWords(x, words, maxW, space) {
  words = bindShort([...words]);
  const lines = [[]]; let w = 0;
  for (const word of words) {
    const ww = x.measureText(word).width;
    if (lines[lines.length - 1].length && w + space + ww > maxW) { lines.push([]); w = 0; }
    const line = lines[lines.length - 1];
    w += (line.length ? space : 0) + ww;
    line.push({ word, w: ww });
  }
  return lines;
}

function drawFooter(x, R, env) {
  const { t, poster } = env, st = R.st, d = R.day, primary = R.c.primary, maxW = PW - 2 * M;
  x.save();
  x.strokeStyle = rgbCss(INK, 0.55); x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(M, FOOT); x.lineTo(PW - M, FOOT); x.stroke();

  // title
  const title = st.titleUpper ? d.meta.title.toUpperCase() : d.meta.title;
  let size = st.titleSize, lines;
  const font = s => `${st.titleItalic ? 'italic ' : ''}${st.titleWeight} ${s}px Literata`;
  for (;;) {
    x.font = font(size); setLS(x, st.tracking * size);
    lines = wrapWords(x, title.split(/\s+/), maxW, x.measureText(' ').width);
    if (lines.length <= 2 || size <= 44) break;
    size -= 4;
  }
  const space = x.measureText(' ').width, lh = size * 1.12;
  let y = FOOT + 26 + size;
  let wi = 0, ci = 0;
  x.fillStyle = rgbCss(INK);
  x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  for (const line of lines) {
    let cx = M;
    for (const { word, w } of line) {
      let alpha = 1, dy = 0, txt = word, sc = 1;
      if (!poster) {
        if (primary === 'kandinsky') alpha = t >= 0.4 + wi * env.bp ? 1 : 0;
        else if (primary === 'film') { const shown = Math.floor((t - 0.6) / 0.05) - ci; txt = shown <= 0 ? '' : word.slice(0, shown); }
        else if (primary === 'matisse') { const k = clamp((t - 0.6 - wi * 0.22) / 0.35); alpha = k > 0 ? 1 : 0; sc = k > 0 ? 1 + Math.sin(k * Math.PI) * 0.18 : 0; }
        else { alpha = easeOut((t - 0.8 - wi * 0.12) / 1.4); dy = (1 - alpha) * 12; }
      }
      if (alpha > 0 && txt) {
        x.save(); x.globalAlpha = alpha;
        if (sc !== 1) { x.translate(cx + w / 2, y - size * 0.35); x.scale(sc, sc); x.translate(-(cx + w / 2), -(y - size * 0.35)); }
        x.fillText(txt, cx, y + dy);
        x.restore();
      }
      cx += w + space; wi++; ci += word.length;
    }
    y += lh;
  }
  setLS(x, 0);

  // handwritten caption, revealed like writing
  const cap = d.meta.caption;
  if (cap) {
    // the caption shrinks rather than collide with the constant song line at the bottom
    let capSize = 52, clines;
    for (;;) {
      x.font = `500 ${capSize}px Caveat`;
      clines = wrapWords(x, cap.split(/\s+/), maxW, x.measureText(' ').width).slice(0, 2);
      if (y + 30 + (clines.length - 1) * capSize * 1.08 <= PH - 122 || capSize <= 36) break;
      capSize -= 4;
    }
    const prog = poster ? 1 : clamp((t - 2.4) / 2.8);
    let cy = y + 30;
    clines.forEach((line, li) => {
      const text = line.map(o => o.word).join(' '), tw = x.measureText(text).width;
      const k = clamp(prog * clines.length - li);
      if (k > 0) {
        x.save(); x.beginPath(); x.rect(M - 10, cy - 60, (tw + 20) * k, 80); x.clip();
        x.fillStyle = rgbCss(INK, 0.86); x.fillText(text, M, cy); x.restore();
      }
      cy += capSize * 1.08;
    });
  }

  // song line
  const meta = d.song?.meta || {}, Mu = d.inputs.music;
  const parts = [`♪ ${meta.artist ? meta.artist + ' — ' : ''}${meta.title || d.song?.query || 'песня дня'}`];
  if (meta.year) parts.push(meta.year);
  parts.push(`${Mu.bpm} BPM`);
  if (Mu.mode) parts.push(Mu.key);
  x.globalAlpha = poster ? 1 : easeOut((t - 4) / 1.2);
  x.font = '400 23px "JetBrains Mono"'; x.fillStyle = rgbCss(INK, 0.7);
  let s = parts.join('  ·  ');
  while (x.measureText(s).width > maxW && s.length > 10) s = s.slice(0, -2);
  if (s !== parts.join('  ·  ')) s = s.trim() + '…';
  x.fillText(s, M, PH - 70);
  x.restore();
}
