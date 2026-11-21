import { account } from './account.js';
import { cloudDay, cloudSave, cloudList, cloudDelete } from './cloud-days.js';
const DB = 'pogoda-vnutri', VER = 1;
let dbp = null;

function db() {
  if (dbp) return dbp;
  const opening = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      rej(new Error('Браузер долго открывает архив. Перезагрузите страницу.'));
    }, 8000);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('days')) d.createObjectStore('days', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => {
      clearTimeout(timeout);
      const connection = r.result;
      if (expired) { connection.close(); return; }
      connection.onversionchange = () => { connection.close(); dbp = null; };
      res(connection);
    };
    r.onerror = () => { clearTimeout(timeout); rej(r.error); };
  });
  dbp = opening.catch(error => { dbp = null; throw error; });
  return dbp;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Операция с архивом прервана.'));
  }));
}

const localDays = () => tx('days', 'readonly', s => s.getAll());
export async function putDay(day) {
  if (account) return cloudSave(day);
  if (!day.demoKey) throw new Error('Войдите, чтобы сохранить день.');
  return tx('days', 'readwrite', s => s.put(day));
}
export async function getDay(id) {
  if (account) return cloudDay(id);
  const day = await tx('days', 'readonly', s => s.get(id));
  return day?.demoKey ? day : null;
}
export const allDays = async () => account ? cloudList() : (await localDays()).filter(day => day.demoKey);
export async function deleteDay(id) {
  if (account) return cloudDelete(id);
  if (await getDay(id)) await tx('days', 'readwrite', s => s.delete(id));
}
export const legacyDays = async () => account ? (await localDays()).filter(day => !day.demoKey) : [];
export async function moveLegacyDay(day) {
  if (!account) throw new Error('Войдите в дневник.');
  if (!await cloudDay(day.id)) await cloudSave(day);
  await tx('days', 'readwrite', s => s.delete(day.id));
}
const scoped = k => (account ? account.id + ':' : 'guest:') + k;
export const kvGet = k => tx('kv', 'readonly', s => s.get(scoped(k)));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, scoped(k)));

export function getSetting(k, def = '') { try { return localStorage.getItem('pv:' + scoped(k)) ?? def; } catch { return def; } }
export function setSetting(k, v) { try { localStorage.setItem('pv:' + scoped(k), v); } catch { /* private mode */ } }
