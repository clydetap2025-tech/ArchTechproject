import { account, request } from './account.js';
import { computeDay } from './mood.js';
import { makeFingerprint, visibilityOf } from './day-sharing.js';

const records = 'collections/diary_days/records';
let fileAccess;
const cache = new Map();

async function loadFile(record, name, cacheable) {
  if (!name) return null;
  const path = 'files/diary_days/' + record.id + '/' + encodeURIComponent(name);
  if (cacheable && cache.has(path)) return cache.get(path);
  if (!fileAccess || Date.now() >= fileAccess.until) {
    const token = request('files/token', { method: 'POST' });
    fileAccess = { token, until: Date.now() + 60000 };
    token.catch(() => { if (fileAccess?.token === token) fileAccess = null; });
  }
  const { token } = await fileAccess.token;
  const blob = await request(path + '?token=' + encodeURIComponent(token), { binary: true });
  if (cacheable && blob.size < 2 * 1024 * 1024) {
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
  const owned = record.owner === account.id;
  day._record = record;
  day.visibility = visibilityOf(record.visibility);
  day.cover = await loadFile(record, record.cover, owned);
  await Promise.all(day.photos.map(async (p, i) => {
    if (full || i === 0) p.blob = await loadFile(record, numbered(record.pictures, i), owned);
    const original = numbered(record.originals, i);
    if (original && owned) p.loadOriginal = () => loadFile(record, original, true);
  }));
  if (full && record.audio) day.song.fileBlob = await loadFile(record, record.audio, owned);
  return day;
}

async function findRecord(id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const params = new URLSearchParams({ filter: 'owner="' + account.id + '" && dayKey="' + id + '"', perPage: '1' });
  return (await request(records + '?' + params)).items[0];
}

export async function cloudDay(id) {
  const record = await findRecord(id);
  return record ? unpack(record, true) : null;
}

export async function cloudSharedDay(id) {
  if (!/^[a-z0-9]{15}$/.test(id)) return null;
  try {
    const record = await request(records + '/' + id);
    return record.visibility === 'full' ? await unpack(record, true) : null;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function cloudSetVisibility(day, visibility) {
  const result = await request(records + '/' + day._record.id, {
    method: 'PATCH', body: { visibility: visibilityOf(visibility), atmosphere_input: makeFingerprint(day, computeDay(day)) },
  });
  if (result.visibility !== visibility) throw new Error('Сервер дневника ещё не поддерживает видимость.');
  day.visibility = result.visibility;
  day._record = result;
}

export async function cloudList() {
  const days = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({ filter: 'owner="' + account.id + '"', sort: 'id', perPage: '40', page });
    const result = await request(records + '?' + params);
    for (const record of result.items) days.push(await unpack(record, false));
    if (page >= result.totalPages) return days;
  }
}

export async function cloudSave(day) {
  const { _record, cover, photos, song, visibility, ...entry } = day;
  const { fileBlob, ...songMeta } = song;
  const data = new FormData();
  if (!_record) {
    data.set('owner', account.id);
    data.set('dayKey', day.id);
    data.set('visibility', visibilityOf(visibility));
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
  data.set('atmosphere_input', JSON.stringify(makeFingerprint(day, computeDay(day))));
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
