// Local-first storage: every day lives in IndexedDB in this browser (nothing is uploaded anywhere).
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

export const putDay = day => tx('days', 'readwrite', s => s.put(day));
export const getDay = id => tx('days', 'readonly', s => s.get(id));
export const allDays = () => tx('days', 'readonly', s => s.getAll());
export const deleteDay = id => tx('days', 'readwrite', s => s.delete(id));
export const kvGet = k => tx('kv', 'readonly', s => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));

export function getSetting(k, def = '') { try { return localStorage.getItem('pv:' + k) ?? def; } catch { return def; } }
export function setSetting(k, v) { try { localStorage.setItem('pv:' + k, v); } catch { /* private mode */ } }
