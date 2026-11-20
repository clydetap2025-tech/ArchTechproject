// Photo-first layouts for the archive, live page and video export.
import { clamp, canvasBlob, fmtDateDots, rgbCss, TIME_RU } from './util.js';
import { atmosphere, weatherLabel } from './weather.js';
import { TECH } from './mood.js';

export const PW = 1080, PH = 1920;
const M = 64, W = PW - 2 * M;
const MARK = '#f4f0e7', SECONDARY = '#c9cec5';
const THEME = {
  autumn: [173, 91, 41], winter: [112, 158, 185], rain: [83, 129, 150],
  spring: [94, 140, 92], summer: [164, 142, 89],
};
const CROP = {
  monet: { split: .58, hero: 876, radius: 30 },
  kandinsky: { split: .64, hero: 818, radius: 12 },
  matisse: { split: .41, hero: 795, radius: 26 },
  hopper: { split: .58, hero: 850, radius: 18 },
  ma: { split: .5, hero: 895, radius: 20 },
  film: { split: .55, hero: 836, radius: 22 },
};

function layoutFor(primary, count) {
  const { split, hero, radius } = CROP[primary] || CROP.film;
  const gap = 18, first = Math.round((W - gap) * split);
  const mainHeight = count === 1 ? 1206 : hero;
  const top = 192, stripY = top + mainHeight + gap;
  const stripHeight = top + 1206 - stripY;
  const tiles = [{ x: M, y: top, w: W, h: mainHeight, radius }];
  if (count === 2) tiles.push({ x: M, y: stripY, w: W, h: stripHeight, radius });
  else if (count > 2) {
    tiles.push({ x: M, y: stripY, w: first, h: stripHeight, radius });
    tiles.push({ x: M + first + gap, y: stripY, w: W - first - gap, h: stripHeight, radius });
  }
  return tiles;
}

function coverPhoto(ctx, photo, rect, zoom) {
  const target = rect.w / rect.h, actual = photo.width / photo.height;
  const sw = (actual > target ? photo.height * target : photo.width) / zoom;
  const sh = (actual > target ? photo.height : photo.width / target) / zoom;
  ctx.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh,
    rect.x, rect.y, rect.w, rect.h);
}

function panelBackground(ctx, accent, season) {
  ctx.fillStyle = '#101615';
  ctx.fillRect(0, 0, PW, PH);
  const glow = ctx.createRadialGradient(PW * .9, 0, 0, PW * .9, 0, PH * .8);
  glow.addColorStop(0, rgbCss(season || accent, .32));
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PW, PH);
}

function horizontalRule(ctx, y) {
  ctx.fillStyle = '#e7f0e333';
  ctx.fillRect(M, y, W, 2);
}

function header(ctx, day, comp) {
  const accent = comp.style.accents[0];
  ctx.fillStyle = rgbCss(accent);
  ctx.beginPath();
  ctx.arc(M + 11, 71, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = MARK;
  ctx.font = '550 31px Manrope, system-ui';
  ctx.fillText('Погода внутри', M + 33, 83, W * .56);
  ctx.textAlign = 'right';
  ctx.font = '500 27px "JetBrains Mono", monospace';
  ctx.fillText(fmtDateDots(day.date), PW - M, 81, W * .45);
  ctx.fillStyle = SECONDARY;
  ctx.font = '400 22px Manrope, system-ui';
  const weather = weatherLabel(day.inputs.weather);
  const detail = [TIME_RU[comp.mood.light], weather].filter(Boolean).join(' · ');
  ctx.fillText(detail, PW - M, 126, W);
  ctx.textAlign = 'left';
  horizontalRule(ctx, 154);
}

function wrap(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of String(text || '').trim().split(/\s+/)) {
    if (!word) continue;
    const candidate = line ? line + ' ' + word : word;
    if (line && ctx.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function limitedText(ctx, text, size, maxLines, width, family, weight) {
  let lines;
  for (let px = size; px >= size * .63; px -= 2) {
    ctx.font = weight + ' ' + px + 'px ' + family;
    lines = wrap(ctx, text, width);
    if (lines.length <= maxLines) return { lines, lineHeight: px * 1.11 };
  }
  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines) clipped[maxLines - 1] += '…';
  return { lines: clipped, lineHeight: size * .7 };
}

function footer(ctx, day, comp) {
  const accent = comp.style.accents[0];
  const palette = comp.style.palette.slice(0, 5);
  ctx.fillStyle = SECONDARY;
  ctx.font = '500 21px "JetBrains Mono", monospace';
  ctx.fillText(String(day.photos.length).padStart(2, '0') + ' · ' + TECH[comp.primary].name.toUpperCase(), M, 1451, W - 176);
  palette.forEach((color, index) => {
    ctx.fillStyle = rgbCss(color);
    ctx.beginPath();
    ctx.roundRect(PW - M - 28 * (palette.length - index), 1428, 21, 21, 5);
    ctx.fill();
  });
  const title = limitedText(ctx, day.meta.title, 89, 3, W, 'Literata, Georgia, serif', 550);
  ctx.fillStyle = MARK;
  title.lines.forEach((line, index) => ctx.fillText(line, M, 1561 + index * title.lineHeight, W));
  const caption = day.meta.caption;
  if (caption) {
    ctx.font = 'italic 400 32px Literata, Georgia, serif';
    ctx.fillStyle = SECONDARY;
    const y = Math.min(1785, 1561 + Math.max(1, title.lines.length - 1) * title.lineHeight + 62);
    ctx.fillText('«' + caption + '»', M, y, W);
  }
  horizontalRule(ctx, 1820);
  const meta = day.song?.meta;
  const song = [meta?.artist, meta?.title || day.song?.query].filter(Boolean).join(' — ');
  if (song) {
    ctx.fillStyle = rgbCss(accent);
    ctx.font = '700 26px Manrope, system-ui';
    ctx.fillText('♪', M, 1871);
    ctx.fillStyle = MARK;
    ctx.font = '450 27px Manrope, system-ui';
    ctx.fillText(song, M + 32, 1871, W - 32);
  }
}

export class PageRenderer {
  constructor(canvas) {
    canvas.width = PW;
    canvas.height = PH;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.photos = [];
  }

  async load(day, comp) {
    this.dispose();
    this.day = day;
    try {
      for (const photo of day.photos) this.photos.push(await createImageBitmap(photo.blob));
      if (!this.photos.length) throw new Error('В записи нет фотографий');
      this.theme = atmosphere(day.date, day.inputs.weather, day.inputs.text);
      this.setComputed(comp);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get D() { return this.timeline?.duration || 30; }
  posterTime() { return 0; }

  setComputed(comp) {
    this.comp = comp;
    this.tiles = layoutFor(comp.primary, this.photos.length);
    this.timeline = comp.style.timeline;
  }

  dispose() {
    for (const photo of this.photos) photo.close();
    this.photos = [];
  }

  draw(time, live, { poster = false } = {}) {
    const ctx = this.ctx;
    const t = poster ? 0 : ((time % this.D) + this.D) % this.D;
    const { cuts } = this.timeline;
    const index = cuts.findLastIndex(cut => cut <= t);
    const elapsed = t - cuts[index];
    const mix = index === 0 ? 1 : clamp(elapsed / this.comp.style.crossfade);
    const zoom = 1 + Math.min(.036, (poster ? 0 : elapsed * .004 + (live?.bass || 0) * .009) * this.comp.mood.E);
    const stride = this.photos.length <= this.tiles.length ? 1 : this.tiles.length;
    const base = index * stride;
    const palette = this.comp.style.accents[0];
    panelBackground(ctx, palette, THEME[this.theme.scene]);
    header(ctx, this.day, this.comp);
    this.tiles.forEach((tile, order) => {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(tile.x, tile.y, tile.w, tile.h, tile.radius);
      ctx.clip();
      if (mix < 1) {
        const previous = base - stride + order;
        coverPhoto(ctx, this.photos[previous % this.photos.length], tile, 1.02);
      }
      ctx.globalAlpha = mix;
      coverPhoto(ctx, this.photos[(base + order) % this.photos.length], tile, zoom);
      ctx.restore();
    });
    footer(ctx, this.day, this.comp);
  }

  async poster(width = PW) {
    this.draw(0, null, { poster: true });
    if (width === PW) return canvasBlob(this.cv, 'image/jpeg', .92);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = Math.round(width * PH / PW);
    out.getContext('2d').drawImage(this.cv, 0, 0, out.width, out.height);
    return canvasBlob(out, 'image/jpeg', .88);
  }
}

export function drawBackPage(canvas, day, comp) {
  canvas.width = PW;
  canvas.height = PH;
  const ctx = canvas.getContext('2d');
  const accent = comp.style.accents[0];
  panelBackground(ctx, accent, THEME[atmosphere(day.date, day.inputs.weather, day.inputs.text).scene]);
  header(ctx, day, comp);
  ctx.fillStyle = MARK;
  ctx.font = '500 75px Literata, Georgia, serif';
  ctx.fillText('Почему этот день', M, 277, W);
  ctx.fillText('выглядит так', M, 367, W);
  horizontalRule(ctx, 423);

  const priority = ['Система', 'Спор', 'Текст', 'Фото', 'Музыка', 'Погода', 'Звук', 'Голос'];
  const rules = [];
  for (const source of priority) {
    const item = comp.recipe.find(rule => rule.src === source);
    if (item) rules.push(item);
  }
  rules.slice(0, 7).forEach((item, index) => {
    const y = 502 + index * 160;
    ctx.fillStyle = SECONDARY;
    ctx.font = '600 20px "JetBrains Mono", monospace';
    ctx.fillText(item.src.toUpperCase(), M, y, W);
    ctx.fillStyle = MARK;
    ctx.font = '650 30px Manrope, system-ui';
    ctx.fillText(item.sig, M, y + 42, W);
    ctx.fillStyle = SECONDARY;
    ctx.font = '400 26px Manrope, system-ui';
    wrap(ctx, item.rule, W).slice(0, 2).forEach((line, i) => ctx.fillText(line, M, y + 79 + i * 30, W));
    horizontalRule(ctx, y + 125);
  });
  comp.style.palette.forEach((color, index) => {
    ctx.fillStyle = rgbCss(color);
    ctx.beginPath();
    ctx.roundRect(M + index * 70, 1635, 56, 56, 12);
    ctx.fill();
  });
  ctx.fillStyle = MARK;
  ctx.font = '550 30px Manrope, system-ui';
  ctx.fillText(day.meta.title, M, 1853, W);
}

export async function renderCover(day, comp, width = 540) {
  const renderer = new PageRenderer(document.createElement('canvas'));
  try {
    await renderer.load(day, comp);
    return await renderer.poster(width);
  } finally {
    renderer.dispose();
  }
}
