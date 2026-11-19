// Photos are the material of the page: palette, light, colour temperature, time from EXIF.
import { rgbToHsl, lum, canvasBlob, clamp } from './util.js';

export async function processPhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await canvasBlob(c, 'image/jpeg', 0.9);
  const stats = analyzePixels(c);
  let taken = null;
  try { taken = await readExifDate(file); } catch { /* no EXIF */ }
  return { blob, w, h, stats, taken };
}

// k-means palette + light statistics on a 72px thumbnail
export function analyzePixels(src) {
  const S = 72;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;
  const px = [];
  let L = 0, L2 = 0, sat = 0, warm = 0;
  for (let i = 0; i < d.length; i += 4) {
    const p = [d[i], d[i + 1], d[i + 2]];
    px.push(p);
    const l = lum(p); L += l; L2 += l * l;
    const [, s] = rgbToHsl(...p); sat += s;
    warm += (p[0] - p[2]) / 255;
  }
  const n = px.length;
  L /= n; sat /= n; warm /= n;
  const contrast = Math.sqrt(Math.max(0, L2 / n - L * L));

  // init centroids at luminance quantiles
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  const K = 5;
  let cent = Array.from({ length: K }, (_, k) => [...sorted[Math.floor((k + 0.5) / K * n)]]);
  const assign = new Uint8Array(n);
  for (let it = 0; it < 10; it++) {
    const sums = Array.from({ length: K }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const p = px[i]; let bk = 0, bd = Infinity;
      for (let k = 0; k < K; k++) {
        const q = cent[k];
        const dd = (p[0] - q[0]) ** 2 * 0.3 + (p[1] - q[1]) ** 2 * 0.59 + (p[2] - q[2]) ** 2 * 0.11;
        if (dd < bd) { bd = dd; bk = k; }
      }
      assign[i] = bk; const s = sums[bk]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    cent = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[k]));
  }
  const counts = new Array(K).fill(0);
  for (let i = 0; i < n; i++) counts[assign[i]]++;
  const palette = cent.map((rgb, k) => ({ rgb: rgb.map(Math.round), share: counts[k] / n }))
    .filter(p => p.share > 0.01).sort((a, b) => b.share - a.share);
  return { palette, lum: L, contrast, sat, warmth: warm };
}

export function aggregatePhotos(list) {
  const n = list.length || 1;
  const all = list.flatMap(p => p.stats.palette.map(c => ({ rgb: c.rgb, share: c.share / n })));
  all.sort((a, b) => b.share - a.share);
  const pal = [];
  for (const c of all) {
    if (pal.every(p => dist(p.rgb, c.rgb) > 38)) pal.push({ ...c });
    else { const near = pal.reduce((a, b) => (dist(a.rgb, c.rgb) < dist(b.rgb, c.rgb) ? a : b)); near.share += c.share; }
    if (pal.length >= 6) break;
  }
  while (pal.length < 5) pal.push({ rgb: pal[pal.length - 1]?.rgb.map(v => clamp(v * 0.7, 0, 255)) || [120, 110, 100], share: 0.01 });
  const avg = k => list.reduce((s, p) => s + p.stats[k], 0) / n;
  const hours = list.map(p => p.taken?.hour).filter(h => h != null);
  let timeGuess = null;
  if (hours.length) {
    const hr = hours[0];
    timeGuess = hr >= 5 && hr < 11 ? 'morning' : hr < 17 ? 'day' : hr < 22 ? 'evening' : 'night';
  } else if (avg('lum') < 0.22) timeGuess = 'night';
  return { n: list.length, palette: pal.slice(0, 5), lum: avg('lum'), contrast: avg('contrast'), sat: avg('sat'), warmth: avg('warmth'), timeGuess, exifHour: hours[0] ?? null };
}

const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

// Minimal JPEG EXIF reader: DateTimeOriginal (0x9003) only.
export async function readExifDate(file) {
  if (!file || !file.slice) return null;
  const buf = await file.slice(0, 196608).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
      const tiff = off + 10;
      const le = v.getUint16(tiff) === 0x4949;
      const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
      const readIFD = (ifd, want) => {
        const cnt = u16(tiff + ifd);
        for (let i = 0; i < cnt; i++) {
          const e = tiff + ifd + 2 + i * 12;
          if (e + 12 > v.byteLength) return null;
          if (u16(e) === want) return e;
        }
        return null;
      };
      const exifPtr = readIFD(u32(tiff + 4), 0x8769);
      if (exifPtr == null) return null;
      const dt = readIFD(u32(exifPtr + 8), 0x9003);
      if (dt == null) return null;
      const strOff = tiff + u32(dt + 8);
      let s = '';
      for (let i = 0; i < 19 && strOff + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(strOff + i));
      const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
      if (!m) return null;
      return { date: `${m[1]}-${m[2]}-${m[3]}`, hour: +m[4] };
    }
    if ((marker & 0xFF00) !== 0xFF00) break;
    off += 2 + size;
  }
  return null;
}
