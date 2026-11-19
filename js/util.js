// Small shared helpers: math, seeded random, colors, DOM, dates.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
export const easeInOut = t => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- text ----------
export const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');
export const tokenize = s => norm(s).match(/[a-zа-я0-9]+(?:-[a-zа-я0-9]+)*/g) || [];
export const wordCount = s => (String(s).trim().match(/\S+/g) || []).length;
export const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------- colors ----------
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export const rgbHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export const rgbCss = ([r, g, b], a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
export const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
export const hsl = (h, s, l) => hslToRgb(h, clamp(s), clamp(l));

export function hueLerp(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export function colorName(rgb) {
  const [h, s, l] = rgbToHsl(...rgb);
  if (l < 0.13) return 'почти чёрный';
  if (l > 0.9) return 'почти белый';
  if (s < 0.13) return l < 0.45 ? 'тёмно-серый' : 'серый';
  const dark = l < 0.32 ? 'тёмный ' : l > 0.75 ? 'светлый ' : '';
  let name;
  if (h < 14 || h >= 345) name = 'красный';
  else if (h < 32) name = s < 0.5 ? 'терракотовый' : 'оранжевый';
  else if (h < 48) name = s < 0.55 ? 'охристый' : 'янтарный';
  else if (h < 66) name = 'жёлтый';
  else if (h < 90) name = 'оливковый';
  else if (h < 160) name = 'зелёный';
  else if (h < 195) name = 'бирюзовый';
  else if (h < 225) name = 'голубой';
  else if (h < 255) name = 'синий';
  else if (h < 290) name = 'фиолетовый';
  else name = 'розовый';
  return dark + name;
}

// ---------- DOM ----------
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej; r.readAsDataURL(blob);
  });
}

export const canvasBlob = (c, type = 'image/jpeg', q = 0.9) => new Promise(r => c.toBlob(r, type, q));

// ---------- dates ----------
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fmtDateLong(iso) { const d = parseISO(iso); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; }
export function fmtDateDots(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }
export function weekday(iso, short = false) { const d = parseISO(iso).getDay(); return short ? WEEKDAYS_SHORT[d] : WEEKDAYS[d]; }

export const TIME_RU = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };
export const SEASON_RU = { winter: 'зима', spring: 'весна', summer: 'лето', autumn: 'осень' };
