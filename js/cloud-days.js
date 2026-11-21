import { account, request } from './account.js';

const records = 'collections/diary_days/records';
let fileAccess;
const cache = new Map();

async function loadFile(record, name) {
  if (!name) return null;
  const path = 'files/diary_days/' + record.id + '/' + encodeURIComponent(name);
  if (cache.has(path)) return cache.get(path);
  if (!fileAccess || Date.now() >= fileAccess.until) {
    const token = request('files/token', { method: 'POST' });
    fileAccess = { token, until: Date.now() + 60000 };
    token.catch(() => { if (fileAccess?.token === token) fileAccess = null; });
  }
  const { token } = await fileAccess.token;
  const blob = await request(path + '?token=' + encodeURIComponent(token), { binary: true });
  if (blob.size < 2 * 1024 * 1024) {
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(path, blob);
  }
  return blob;
}

function numbered(files, i) {
  return files?.find(name => name.startsWith('p' + i + '_'));
}

async function unpack(record, full) {
  const day = structuredClone(record.entry);
  day._record = record;
  day.cover = await loadFile(record, record.cover);
  await Promise.all(day.photos.map(async (p, i) => {
    if (full || i === 0) p.blob = await loadFile(record, numbered(record.pictures, i));
    const original = numbered(record.originals, i);
    if (original) p.loadOriginal = () => loadFile(record, original);
  }));
  if (full && record.audio) day.song.fileBlob = await loadFile(record, record.audio);
  return day;
}

async function findRecord(id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const params = new URLSearchParams({ filter: 'dayKey="' + id + '"', perPage: '1' });
  return (await request(records + '?' + params)).items[0];
}

export async function cloudDay(id) {
  const record = await findRecord(id);
  return record ? unpack(record, true) : null;
}

export async function cloudList() {
  const days = [];
  for (let page = 1; ; page++) {
    const result = await request(records + '?sort=id&perPage=40&page=' + page);
    for (const record of result.items) days.push(await unpack(record, false));
    if (page >= result.totalPages) return days;
  }
}

export async function cloudSave(day) {
  const { _record, cover, photos, song, ...entry } = day;
  const { fileBlob, ...songMeta } = song;
  const data = new FormData();
  if (!_record) {
    data.set('owner', account.id);
    data.set('dayKey', day.id);
  }
  const replacePictures = !_record || day.demoVersion !== _record.entry.demoVersion;
  entry.photos = photos.map(({ blob, original, loadOriginal, ...meta }, i) => {
    if (replacePictures) {
      data.append('pictures', blob, 'p' + i + '_photo.jpg');
      if (original) data.append('originals', original, 'p' + i + '_original.bin');
    }
    return meta;
  });
  entry.song = songMeta;
  data.set('entry', JSON.stringify(entry));
  data.set('cover', cover, 'cover.jpg');
  if (fileBlob && !_record) data.set('audio', fileBlob, 'track.bin');
  const result = await request(records + (_record ? '/' + _record.id : ''), {
    method: _record ? 'PATCH' : 'POST', body: data,
  });
  day._record = result;
}

export async function cloudDelete(id) {
  const record = await findRecord(id);
  if (record) await request(records + '/' + record.id, { method: 'DELETE' });
}
