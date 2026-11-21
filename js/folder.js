// "Folder of the day": a real folder on disk (File System Access API in Chrome/Edge) named by the
// generated title, or a ZIP with the same structure as a fallback.
import { kvGet, kvSet } from './store.js';
import { downloadBlob, fmtDateLong } from './util.js';
import { TECH } from './mood.js';

export const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'День';

export function dayFiles(day, comp, { cover, video } = {}) {
  const meta = day.song?.meta || {}, Mu = day.inputs.music;
  const files = [];
  const enc = s => new Blob([s], { type: 'text/plain;charset=utf-8' });
  files.push(['запись.txt', enc(`${day.meta.title}\n${fmtDateLong(day.date)}\n\n${day.text}\n`)]);
  day.photos.forEach((p, i) => files.push([`фото-${String(i + 1).padStart(2, '0')}.jpg`, p.blob]));
  files.push(['песня.json', enc(JSON.stringify({
    artist: meta.artist || null, title: meta.title || day.song?.query || null, year: meta.year || null, genre: meta.genre || null,
    link: day.song?.link || meta.trackViewUrl || null, preview: meta.previewUrl || null,
    ...(meta.license ? { license: meta.license, licenseUrl: meta.licenseUrl, edit: 'В воспоминании используется зацикленный фрагмент.' } : {}),
    note: 'Сама песня не хранится: только ссылка и её «отпечаток» для оформления.',
    fingerprint: { bpm: Mu.bpm, key: Mu.key, energy: Mu.energy, brightness: Mu.brightness, source: Mu.source },
  }, null, 2))]);
  if (day.song?.fileBlob) files.push([`песня-ваш-файл${extOf(day.song.fileName)}`, day.song.fileBlob]);
  if (cover) files.push(['воспоминание-обложка.jpg', cover]);
  if (video) files.push(['воспоминание.webm', video]);
  files.push(['почему-так.json', enc(JSON.stringify({
    title: day.meta.title,
    technique: { primary: TECH[comp.primary].name, secondary: TECH[comp.secondary].name, weights: comp.weights },
    mood: comp.mood, recipe: comp.recipe, palette: comp.style.palette.map(c => c.map(Math.round)),
  }, null, 2))]);
  files.push(['озвучка.json', enc(JSON.stringify({ text: day.text, rate: comp.voice.rate, pitch: comp.voice.pitch, voice: comp.voice.slot, rule: comp.voice.why }, null, 2))]);
  return files;
}

const extOf = n => { const m = /\.[a-z0-9]{2,4}$/i.exec(n || ''); return m ? m[0] : '.mp3'; };

export const canUseFolders = () => 'showDirectoryPicker' in window;

export async function saveToFolder(day, comp, extras) {
  const files = dayFiles(day, comp, extras);
  if (!canUseFolders()) { await saveZip(day, files); return { mode: 'zip', files: files.map(f => f[0]) }; }
  let root = await kvGet('rootDir');
  if (root) {
    const perm = await root.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && (await root.requestPermission({ mode: 'readwrite' })) !== 'granted') root = null;
  }
  if (!root) {
    root = await window.showDirectoryPicker({ id: 'pogoda-diary', mode: 'readwrite', startIn: 'documents' });
    await kvSet('rootDir', root);
  }
  const name = safeName(`${day.date} · ${day.meta.title}`);
  const dir = await root.getDirectoryHandle(name, { create: true });
  for (const [fname, blob] of files) {
    const fh = await dir.getFileHandle(fname, { create: true });
    const w = await fh.createWritable(); await w.write(blob); await w.close();
  }
  return { mode: 'folder', root: root.name, name, files: files.map(f => f[0]) };
}

export async function forgetRoot() { await kvSet('rootDir', null); }

// ---------- tiny store-only ZIP writer (UTF-8 names) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export async function saveZip(day, files) {
  downloadBlob(await buildZip(day, files), safeName(`${day.date} ${day.meta.title}`) + '.zip');
}

export const buildZip = (day, files) => zipFiles(safeName(`${day.date} · ${day.meta.title}`) + '/', files);

export async function zipFiles(folder, files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, blob] of files) {
    const data = new Uint8Array(await blob.arrayBuffer()), nm = enc.encode(folder + name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, nm, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true);
    c.setUint32(42, offset, true);
    central.push(c.buffer, nm);
    offset += 30 + nm.length + data.length;
  }
  const csize = central.reduce((s, b) => s + (b.byteLength ?? b.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
