// Photo-first layouts for the archive, live page and video export.
import { clamp, canvasBlob, fmtDateDots, rgbCss, TIME_RU } from './util.js';
import { atmosphere, weatherLabel } from './weather.js';
import { TECH } from './mood.js';

export const PW = 1080, PH = 1920;
const M = 66, W = PW - 2 * M;
const MARK = '#f9f6ee', SECONDARY = '#d6d4cc';
const INK = '#1e2723', PAPER = '#f2efe7', DETAIL = '#505951';
export const FONT = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'system-ui, sans-serif';
const THEME = {
  autumn: [173, 91, 41], winter: [112, 158, 185], rain: [83, 129, 150],
  spring: [94, 140, 92], summer: [164, 142, 89],
};
const CROP = {
  monet: { split: .58, hero: 1420 },
  kandinsky: { split: .64, hero: 1380 },
  matisse: { split: .41, hero: 1380 },
  hopper: { split: .58, hero: 1400 },
  ma: { split: .5, hero: 1440 },
  film: { split: .55, hero: 1400 },
};

function layoutFor(primary, count) {
  const { split, hero } = CROP[primary] || CROP.film;
  const gap = 12, first = Math.round((W - gap) * split);
  const mainHeight = count === 1 ? 1740 : hero;
  const stripY = mainHeight + 27;
  const stripHeight = 1740 - stripY;
  const tiles = [{ x: 0, y: 0, w: PW, h: mainHeight, radius: 0 }];
  if (count === 2) tiles.push({ x: M, y: stripY, w: W, h: stripHeight, radius: 8 });
  else if (count > 2) {
    tiles.push({ x: M, y: stripY, w: first, h: stripHeight, radius: 8 });
    tiles.push({ x: M + first + gap, y: stripY, w: W - first - gap, h: stripHeight, radius: 8 });
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

function horizontalRule(ctx, y, color = '#e7f0e350') {
  ctx.fillStyle = color;
  ctx.fillRect(M, y, W, 2);
}

function masthead(ctx, date, foreground, line) {
  ctx.textAlign = 'left';
  ctx.fillStyle = foreground;
  ctx.font = '600 29px ' + FONT;
  ctx.fillText('Погода внутри', M, 98);
  ctx.textAlign = 'right';
  ctx.font = '500 26px ' + FONT;
  ctx.fillText(fmtDateDots(date), PW - M, 98);
  ctx.textAlign = 'left';
  horizontalRule(ctx, 128, line);
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

function limitedText(ctx, text, size, maxLines, width, weight) {
  let lines;
  for (let px = size; px >= size * .63; px -= 2) {
    ctx.font = weight + ' ' + px + 'px ' + FONT;
    lines = wrap(ctx, text, width);
    if (lines.length <= maxLines) return { lines, lineHeight: px * 1.11 };
  }
  const clipped = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    const last = maxLines - 1;
    while (clipped[last].length > 1 && ctx.measureText(clipped[last] + '…').width > width) {
      clipped[last] = clipped[last].slice(0, -1);
    }
    clipped[last] += '…';
  }
  return { lines: clipped, lineHeight: size * .7 };
}

function coverTitle(ctx, day, comp, bottom) {
  const topShade = ctx.createLinearGradient(0, 0, 0, 300);
  topShade.addColorStop(0, '#101715dc');
  topShade.addColorStop(1, '#10171500');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, PW, 300);

  const shade = ctx.createLinearGradient(0, bottom - 680, 0, bottom);
  shade.addColorStop(0, '#11171400');
  shade.addColorStop(.54, '#111714bc');
  shade.addColorStop(1, '#111714f8');
  ctx.fillStyle = shade;
  ctx.fillRect(0, bottom - 680, PW, 680);
  masthead(ctx, day.date, MARK, '#f6f1e969');

  const caption = day.meta.caption;
  const title = limitedText(ctx, day.meta.title, 92, 3, W, 600);
  const lastTitle = bottom - (caption ? 146 : 79);
  const firstTitle = lastTitle - (title.lines.length - 1) * title.lineHeight;
  ctx.fillStyle = MARK;
  title.lines.forEach((line, index) => ctx.fillText(line, M, firstTitle + index * title.lineHeight, W));

  const detail = [TIME_RU[comp.mood.light], weatherLabel(day.inputs.weather)].filter(Boolean).join(' · ');
  if (detail) {
    ctx.font = '600 26px ' + FONT;
    ctx.fillStyle = '#eee0bc';
    ctx.fillText(detail, M, firstTitle - title.lineHeight - 25, W);
  }
  if (caption) {
    ctx.fillStyle = SECONDARY;
    const quote = limitedText(ctx, '«' + caption + '»', 32, 2, W, 400);
    quote.lines.forEach((line, index) => ctx.fillText(line, M, lastTitle + 57 + index * quote.lineHeight, W));
  }
}

function soundtrack(ctx, day) {
  horizontalRule(ctx, 1778);
  const meta = day.song?.meta;
  const song = [meta?.artist, meta?.title || day.song?.query].filter(Boolean).join(' — ');
  ctx.font = '500 26px ' + FONT;
  ctx.fillStyle = SECONDARY;
  ctx.fillText('Музыка', M, 1824);
  ctx.textAlign = 'right';
  ctx.fillText(day.photos.length + ' фото', PW - M, 1824);
  ctx.textAlign = 'left';
  if (song) {
    ctx.fillStyle = MARK;
    ctx.font = '500 34px ' + FONT;
    ctx.fillText(song, M, 1872, W);
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
    ctx.fillStyle = '#111714';
    ctx.fillRect(0, 0, PW, PH);
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
    coverTitle(ctx, this.day, this.comp, this.tiles[0].h);
    soundtrack(ctx, this.day);
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
  const theme = atmosphere(day.date, day.inputs.weather, day.inputs.text);
  const accent = THEME[theme.scene] || comp.style.accents[0];
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PW, PH);
  masthead(ctx, day.date, INK, '#c7c7bd');
  ctx.fillStyle = INK;
  ctx.font = '600 88px ' + FONT;
  ctx.fillText('Атмосфера', M, 283, W);
  ctx.fillText('этого дня', M, 392, W);
  ctx.fillStyle = rgbCss(accent);
  ctx.fillRect(M, 426, 112, 5);

  const priority = ['Система', 'Спор', 'Текст', 'Фото', 'Музыка', 'Погода', 'Звук', 'Голос'];
  const rules = priority.map(source => comp.recipe.find(rule => rule.src === source)).filter(Boolean);
  const gridY = 486, gridBottom = 1490, gap = 16;
  const columns = 2, rows = Math.max(1, Math.ceil(rules.length / columns));
  const width = (W - gap) / 2, height = (gridBottom - gridY - (rows - 1) * gap) / rows;
  rules.forEach((item, index) => {
    const x = M + (index % columns) * (width + gap);
    const y = gridY + Math.floor(index / columns) * (height + gap);
    const cellW = index === rules.length - 1 && index % columns === 0 ? W : width;
    const textW = cellW - 62, textX = x + 31;
    ctx.fillStyle = '#e7e8de';
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, height, 12);
    ctx.fill();
    ctx.fillStyle = DETAIL;
    ctx.font = '500 26px ' + FONT;
    ctx.fillText(item.src, textX, y + 46, textW);
    const sig = limitedText(ctx, item.sig, 33, 2, textW, 600);
    ctx.fillStyle = INK;
    sig.lines.forEach((line, lineIndex) => ctx.fillText(line, textX, y + 96 + sig.lineHeight * lineIndex, textW));
    const rule = limitedText(ctx, item.rule, 25, 3, textW, 400);
    ctx.fillStyle = DETAIL;
    const ruleY = y + 134 + (sig.lines.length - 1) * sig.lineHeight;
    rule.lines.forEach((line, lineIndex) => ctx.fillText(line, textX, ruleY + lineIndex * rule.lineHeight, textW));
  });

  ctx.fillStyle = DETAIL;
  ctx.font = '500 26px ' + FONT;
  ctx.fillText('Палитра дня', M, 1565);
  const palette = comp.style.palette;
  const paletteY = 1602, paletteH = 92, inset = W / (palette.length || 1);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(M, paletteY, W, paletteH, 10);
  ctx.clip();
  palette.forEach((color, index) => {
    ctx.fillStyle = rgbCss(color);
    ctx.fillRect(M + index * inset, paletteY, inset + 1, paletteH);
  });
  ctx.restore();
  horizontalRule(ctx, 1760, '#c7c7bd');
  ctx.fillStyle = INK;
  const title = limitedText(ctx, day.meta.title, 42, 2, W, 600);
  title.lines.forEach((line, index) => ctx.fillText(line, M, 1823 + title.lineHeight * index, W));
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
