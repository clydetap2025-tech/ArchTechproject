// App shell: archive, new-day form + pipeline, day viewer (page, sound, voice, "why", mood pad, folder, video).
import { h, todayISO, fmtDateLong, weekday, clamp, sleep, downloadBlob, uid, blobToBase64, rgbHex, canvasBlob, wordCount, TIME_RU, SEASON_RU, rgbCss } from './util.js';
import { allDays, getDay, putDay, deleteDay, getSetting, setSetting } from './store.js';
import { analyzeText, refineWithClaude } from './text.js';
import { processPhoto } from './photo.js';
import { parseLink, titleFromLink, searchSong, analyzeSong, loadSongBuffer } from './music.js';
import { computeDay, TECH, TECH_ORDER } from './mood.js';
import { PageRenderer, renderCover, drawBackPage, PW, PH } from './page.js';
import { getSound } from './sound.js';
import { pickVoice, speak, stopSpeaking } from './voice.js';
import { saveToFolder, canUseFolders, safeName, zipFiles } from './folder.js';
import { DEMO_DAYS, loadDemoPhoto } from './demo.js';

const view = document.getElementById('view');
// Bump when the visual system changes: archive covers re-render themselves in the background.
const COVER_VER = 4;
let cleanups = [];
const onCleanup = fn => cleanups.push(fn);

// ---------- helpers ----------
let fontsP = null;
function fontsReady() {
  if (!fontsP) {
    const sample = 'Аа Яя Ёё 0123';
    fontsP = Promise.all([
      '300 40px Literata', '500 40px Literata', '800 40px Literata', 'italic 400 40px Literata', 'italic 700 40px Literata',
      '500 40px Caveat', '400 24px "JetBrains Mono"', '600 24px "JetBrains Mono"', '700 24px "JetBrains Mono"',
    ].map(f => document.fonts.load(f, sample))).catch(() => {});
  }
  return fontsP;
}

function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  const el = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
  t.append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

const safeCompute = d => { try { return computeDay(d); } catch (e) { console.warn(e); return null; } };

async function smallB64(blob) {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return blobToBase64(await canvasBlob(c, 'image/jpeg', 0.8));
}

const WMO = c => c === 0 ? 'ясно' : c <= 3 ? 'облачно' : c <= 48 ? 'туман' : c <= 57 ? 'морось' : c <= 67 ? 'дождь' : c <= 77 ? 'снег' : c <= 82 ? 'ливень' : c <= 86 ? 'снегопад' : 'гроза';

async function fetchWeather(city, dateISO) {
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`)).json();
  const loc = g.results?.[0];
  if (!loc) throw new Error('город не найден');
  const daysAgo = (Date.parse(todayISO()) - Date.parse(dateISO)) / 86400000;
  const base = daysAgo > 60 ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  const j = await (await fetch(`${base}?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${dateISO}&end_date=${dateISO}`)).json();
  const code = j.daily?.weather_code?.[0];
  if (code == null) throw new Error('нет данных');
  return { city: loc.name, code, text: WMO(code), tmax: j.daily.temperature_2m_max[0], tmin: j.daily.temperature_2m_min[0] };
}

// ---------- pipeline ----------
const STEPS = [
  ['photos', 'Смотрю на фото: палитра, свет, время съёмки'],
  ['text', 'Читаю запись: настроение, время, место, детали'],
  ['music', 'Слушаю песню: темп, тональность, энергия'],
  ['weather', 'Погода этого дня'],
  ['render', 'Собираю страницу и папку дня'],
];

async function buildDay(input, step = () => {}) {
  step('photos', 'active');
  const photos = [];
  for (const f of input.photoFiles) photos.push(await processPhoto(f));
  step('photos', 'done', `${photos.length} фото`);

  step('text', 'active');
  let ta = analyzeText(input.text, input.date);
  const key = getSetting('apiKey');
  if (key) {
    try {
      const imgs = getSetting('sendPhotos') === '1' ? await Promise.all(photos.slice(0, 3).map(p => smallB64(p.blob))) : [];
      ta = await refineWithClaude(input.text, input.date, ta, key, imgs);
    } catch (e) { console.warn(e); toast('Claude недоступен — сработал локальный разбор текста'); }
  }
  step('text', 'done', ta.analyzer === 'claude' ? 'Claude + правила системы' : 'локальные правила');

  step('music', 'active');
  const song = { link: input.songLink || null, query: input.songQuery || null, service: parseLink(input.songLink)?.service || null, meta: null };
  if (input.songFile) {
    song.fileBlob = input.songFile; song.fileName = input.songFile.name;
    song.meta = { title: input.songQuery || input.songFile.name.replace(/\.[^.]+$/, ''), artist: '' };
  } else {
    let q = song.query;
    if (!q && song.link) q = await titleFromLink(song.link);
    if (q) { song.query = q; song.meta = await searchSong(q); }
  }
  if (!song.meta) song.meta = { title: song.query || 'песня дня', artist: '' };
  const music = await analyzeSong(song);
  step('music', 'done', music.source === 'audio' ? `${music.bpm} BPM · ${music.key}` : 'по жанру (превью недоступно)');

  let weather = null;
  if (input.weatherCity) {
    step('weather', 'active');
    try { weather = await fetchWeather(input.weatherCity, input.date); step('weather', 'done', `${weather.city}: ${weather.text}, ${Math.round(weather.tmax)}°`); }
    catch (e) { step('weather', 'done', 'не удалось получить'); }
  } else step('weather', 'skip', 'не добавлена');

  step('render', 'active');
  const ambient = [...ta.ambient];
  if (weather && /дождь|ливень|морось|гроза/.test(weather.text) && !ambient.includes('rain')) ambient.unshift('rain');
  if (weather && /снег/.test(weather.text) && !ambient.includes('wind')) ambient.push('wind');
  const day = {
    id: uid(), created: Date.now(), date: input.date, text: input.text, photos, song,
    inputs: { text: ta, music, weather },
    meta: { title: ta.title, caption: ta.caption, sensory: ta.sensory, ambient: ambient.slice(0, 2), analyzer: ta.analyzer, note: ta.note || '' },
    override: null,
  };
  const comp = computeDay(day);
  day.cover = await renderCover(day, comp);
  day.coverVer = COVER_VER;
  await putDay(day);
  step('render', 'done', `«${day.meta.title}»`);
  return day;
}

async function seedDemo(onProgress) {
  for (let i = 0; i < DEMO_DAYS.length; i++) {
    const d = DEMO_DAYS[i];
    onProgress(i, d);
    const files = [];
    for (let k = 0; k < d.photos.length; k++) files.push(await loadDemoPhoto(d.photos[k], 100 + i * 10 + k));
    await buildDay({ date: d.date, text: d.text, photoFiles: files, songQuery: d.song });
  }
}

// ---------- router ----------
async function route() {
  cleanups.forEach(f => { try { f(); } catch { /* */ } });
  cleanups = [];
  window.scrollTo(0, 0);
  const hash = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === hash));
  try {
    if (hash.startsWith('#/day/')) await viewDay(decodeURIComponent(hash.slice(6)));
    else if (hash === '#/new') await viewNew();
    else await viewArchive();
  } catch (e) {
    console.error(e);
    view.replaceChildren(h('section', { class: 'wrap' }, h('h1', { class: 'h1' }, 'Что-то пошло не так'), h('p', { class: 'muted' }, String(e.message || e)), h('a', { class: 'btn', href: '#/' }, 'Вернуться в архив')));
  }
}
window.addEventListener('hashchange', route);

// ---------- archive ----------
async function viewArchive() {
  const days = (await allDays()).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  if (!days.length) return viewEmpty();
  await fontsReady();
  const urls = [];
  onCleanup(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const comps = new Map(days.map(d => [d.id, safeCompute(d)]));

  const strip = h('div', { class: 'strip', role: 'list', 'aria-label': 'Полоса дней по порядку' },
    [...days].reverse().map(d => {
      const c = comps.get(d.id), pal = c ? c.style.palette.map(rgbHex) : ['#ccc', '#999'];
      return h('a', {
        class: 'strip-day', role: 'listitem', href: `#/day/${d.id}`, title: `${fmtDateLong(d.date)} — ${d.meta.title}`,
        'aria-label': `${fmtDateLong(d.date)}: ${d.meta.title}`,
        style: { background: `linear-gradient(180deg, ${pal[4]}, ${pal[3]} 30%, ${pal[2]} 55%, ${pal[1]} 80%, ${pal[0]})` },
      });
    }));

  const imgs = new Map();
  const cards = days.map(d => {
    const c = comps.get(d.id);
    const url = d.cover ? URL.createObjectURL(d.cover) : '';
    if (url) urls.push(url);
    const hay = [d.meta.title, d.text, d.song?.meta?.artist, d.song?.meta?.title, d.date, fmtDateLong(d.date), c && TECH[c.primary].name, c && TIME_RU[c.mood.light], SEASON_RU[d.inputs.text.season]].join(' ').toLowerCase();
    const img = h('img', { src: url || null, alt: '', loading: 'lazy' });
    imgs.set(d.id, img);
    const el = h('a', { class: 'card', href: `#/day/${d.id}`, 'data-tech': c?.primary || '', 'data-light': c?.mood.light || '' },
      h('div', { class: 'card-img' }, img),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, d.meta.title),
        h('div', { class: 'card-meta' }, `${fmtDateLong(d.date)}${c ? ' · ' + TECH[c.primary].name : ''}`)));
    el.dataset.hay = hay;
    return el;
  });
  const grid = h('div', { class: 'grid' }, cards);
  const empty = h('p', { class: 'muted filtered-empty', hidden: true }, 'Ничего не нашлось. Попробуйте другое слово или снимите фильтр.');
  const filter = { q: '', tech: '', light: '' };
  const apply = () => {
    let shown = 0;
    cards.forEach(c => {
      const ok = (!filter.q || c.dataset.hay.includes(filter.q)) && (!filter.tech || c.dataset.tech === filter.tech) && (!filter.light || c.dataset.light === filter.light);
      c.hidden = !ok; if (ok) shown++;
    });
    empty.hidden = shown > 0;
  };
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Поиск: место, песня, месяц, слово из записи', 'aria-label': 'Поиск по дневнику',
    oninput: e => { filter.q = e.target.value.trim().toLowerCase(); apply(); },
  });
  const chipGroup = (key, label, options) => {
    const btns = [];
    const set = v => { filter[key] = v; btns.forEach(([b, bv]) => b.setAttribute('aria-pressed', String(bv === v))); apply(); };
    const mk = (text, v) => { const b = h('button', { class: 'fchip', type: 'button', 'aria-pressed': String(v === ''), onclick: () => set(filter[key] === v ? '' : v) }, text); btns.push([b, v]); return b; };
    return h('div', { class: 'fchips', role: 'group', 'aria-label': label }, mk('Все', ''), options.map(([v, text]) => mk(text, v)));
  };
  const count = (attr, v) => cards.filter(c => c.dataset[attr] === v).length;
  const techChips = chipGroup('tech', 'Фильтр по технике', TECH_ORDER.filter(k => count('tech', k)).map(k => [k, `${TECH[k].name} · ${count('tech', k)}`]));
  const lightChips = chipGroup('light', 'Фильтр по времени суток', ['morning', 'day', 'evening', 'night'].filter(k => count('light', k)).map(k => [k, TIME_RU[k]]));
  const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => exportForSubmission(exportBtn, days, comps) }, 'Материалы для сдачи');

  view.replaceChildren(h('section', { class: 'wrap' },
    h('div', { class: 'archive-head' },
      h('div', null,
        h('h1', { class: 'h1' }, 'Дневник'),
        h('p', { class: 'muted' }, `${days.length} ${days.length % 10 === 1 && days.length % 100 !== 11 ? 'день' : days.length % 10 >= 2 && days.length % 10 <= 4 && (days.length % 100 < 12 || days.length % 100 > 14) ? 'дня' : 'дней'} · откройте любой, чтобы снова увидеть и услышать его`)),
      h('div', { class: 'row tight' }, exportBtn, h('a', { class: 'btn primary', href: '#/new' }, 'Записать день'))),
    h('div', { class: 'label' }, 'Полоса дней — погода внутри по порядку'),
    strip,
    h('div', { class: 'archive-tools' }, search, techChips, lightChips),
    grid, empty));

  let alive = true;
  onCleanup(() => { alive = false; });
  for (const d of days) {
    if (!alive) break;
    if (d.coverVer === COVER_VER || !comps.get(d.id)) continue;
    try {
      d.cover = await renderCover(d, comps.get(d.id));
      d.coverVer = COVER_VER;
      await putDay(d);
      if (!alive) break;
      const u = URL.createObjectURL(d.cover); urls.push(u);
      imgs.get(d.id).src = u;
    } catch (e) { console.warn('cover refresh failed', e); }
  }
}

// ---------- submission pack: every page, its back, the feed sheet and the list of folders ----------
async function exportForSubmission(btn, days, comps) {
  const label = btn.textContent;
  btn.disabled = true;
  try {
    await fontsReady();
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
    const files = [], covers = [];
    for (let i = 0; i < sorted.length; i++) {
      btn.textContent = `Готовлю ${i + 1} из ${sorted.length}…`;
      const d = sorted[i], c = comps.get(d.id) || computeDay(d), n = String(i + 1).padStart(2, '0');
      const R = new PageRenderer(document.createElement('canvas'));
      await R.load(d, c);
      const page = await R.poster(PW);
      R.dispose();
      const back = document.createElement('canvas');
      drawBackPage(back, d, c);
      files.push([`${n} · ${safeName(d.date + ' · ' + d.meta.title)}.jpg`, page]);
      files.push([`${n} · оборот · почему так.jpg`, await canvasBlob(back, 'image/jpeg', 0.9)]);
      covers.push({ d, c, blob: page });
    }
    btn.textContent = 'Собираю ленту…';
    files.push(['лента.jpg', await feedSheet(covers)]);
    files.push(['дни.md', new Blob([daysMarkdown(covers)], { type: 'text/markdown;charset=utf-8' })]);
    downloadBlob(await zipFiles('Погода внутри — примеры дней/', files), 'Погода внутри — примеры дней.zip');
    toast(`Скачан архив: ${sorted.length} страниц, их обороты, лента и список папок`);
  } catch (e) {
    console.error(e);
    toast('Не получилось собрать материалы: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = label;
}

async function feedSheet(covers) {
  const cw = 360, ch = 640, gap = 32, top = 150, n = covers.length;
  const c = document.createElement('canvas');
  c.width = gap + n * (cw + gap); c.height = top + ch + 150;
  const x = c.getContext('2d');
  x.fillStyle = '#ece6db'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#1d1a17'; x.font = '600 48px Literata'; x.fillText('Погода внутри — лента дней', gap, 78);
  x.font = '400 20px "JetBrains Mono"'; x.fillStyle = 'rgba(29,26,23,.6)';
  x.fillText(`${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'} · один дневник · у каждого дня своя «рука»`.toUpperCase(), gap, 116);
  for (let i = 0; i < n; i++) {
    const { d, c: comp, blob } = covers[i], px = gap + i * (cw + gap);
    const bmp = await createImageBitmap(blob);
    x.save(); x.shadowColor = 'rgba(40,30,20,.25)'; x.shadowBlur = 24; x.shadowOffsetY = 10;
    x.drawImage(bmp, px, top, cw, ch); x.restore();
    bmp.close?.();
    x.fillStyle = '#1d1a17'; x.font = '600 22px Literata';
    const words = d.meta.title.split(' '); let line = '', ly = top + ch + 40;
    for (const w of words) { if (x.measureText(line + ' ' + w).width > cw && line) { x.fillText(line, px, ly); ly += 28; line = w; } else line = line ? line + ' ' + w : w; }
    x.fillText(line, px, ly);
    x.font = '400 15px "JetBrains Mono"'; x.fillStyle = 'rgba(29,26,23,.6)';
    x.fillText(`${fmtDateLong(d.date)} · ${TECH[comp.primary].name}`, px, ly + 28);
  }
  return canvasBlob(c, 'image/jpeg', 0.9);
}

function daysMarkdown(covers) {
  const rows = covers.map(({ d, c }, i) => {
    const m = d.song?.meta || {}, Mu = d.inputs.music;
    const mix = `${TECH[c.primary].name} ${Math.round(c.weights[c.primary] * 100)}%` + (c.weights[c.secondary] >= 0.05 ? ` + ${TECH[c.secondary].name} ${Math.round(c.weights[c.secondary] * 100)}%` : '');
    return `| ${i + 1} | ${d.date} | ${d.meta.title} | ${mix} | ${m.artist ? m.artist + ' — ' : ''}${m.title || ''} | ${Mu.bpm} BPM, ${Mu.key} |`;
  });
  return `# Погода внутри — примеры дней\n\nНазвания папок придуманы прототипом по тексту записи.\n\n| № | Дата | Папка | Техника | Песня | Музыка |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

function viewEmpty() {
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const demoBtn = h('button', {
    class: 'btn', onclick: async () => {
      demoBtn.disabled = true; newBtn.classList.add('is-disabled');
      try {
        await seedDemo((i, d) => { status.textContent = `Собираю демо-день ${i + 1} из ${DEMO_DAYS.length}: ${fmtDateLong(d.date)}…`; });
        toast('Демо-дни готовы');
        route();
      } catch (e) { console.error(e); status.textContent = 'Не удалось собрать демо: ' + e.message; demoBtn.disabled = false; }
    },
  }, `Показать на ${DEMO_DAYS.length} демо-днях`);
  const newBtn = h('a', { class: 'btn primary', href: '#/new' }, 'Записать первый день');
  view.replaceChildren(h('section', { class: 'wrap hero' },
    h('p', { class: 'label' }, 'ArtTech · Make the Invisible Visible'),
    h('h1', { class: 'display' }, 'Фото помнят, как выглядел день.', h('br'), h('em', null, 'Этот дневник — как он ощущался.')),
    h('p', { class: 'lead' }, 'Расскажите, как прошёл день, добавьте фото и песню. Дневник соберёт живую страницу: палитра из ваших снимков, свет и техника — из слов, ритм и движение — из музыки. Каждый день ложится в свою папку с названием.'),
    h('div', { class: 'row' }, newBtn, demoBtn),
    status,
    h('ol', { class: 'how' },
      h('li', null, h('b', null, 'Фото — материал. '), 'Палитра, свет и композиция берутся из ваших снимков.'),
      h('li', null, h('b', null, 'Текст — свет и смысл. '), 'Настроение выбирает художественную технику, время суток — свет, детали — заметки на полях.'),
      h('li', null, h('b', null, 'Музыка — время. '), 'Темп задаёт смену кадров, тональность — яркость и воздух, энергия — пульс страницы.'))));
}

// ---------- new day ----------
async function viewNew() {
  let photoFiles = [];
  const thumbs = h('div', { class: 'thumbs' });
  const urls = [];
  onCleanup(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const err = {};
  const errEl = key => (err[key] = h('p', { class: 'field-error', id: `err-${key}`, hidden: true }));
  const showErr = (key, msg) => { err[key].textContent = msg; err[key].hidden = !msg; };

  const renderThumbs = () => {
    thumbs.replaceChildren(...photoFiles.map((f, i) => {
      const u = URL.createObjectURL(f); urls.push(u);
      return h('div', { class: 'thumb' }, h('img', { src: u, alt: `Фото ${i + 1}` }),
        h('button', { type: 'button', class: 'thumb-x', 'aria-label': `Убрать фото ${i + 1}`, title: 'Убрать фото', onclick: () => { photoFiles.splice(i, 1); renderThumbs(); } }, '×'));
    }));
  };
  const addFiles = list => {
    const imgs = [...list].filter(f => f.type.startsWith('image/'));
    photoFiles = [...photoFiles, ...imgs].slice(0, 8);
    if (photoFiles.length) showErr('photos', '');
    renderThumbs();
  };

  const date = h('input', { type: 'date', id: 'f-date', value: todayISO(), max: todayISO() });
  const text = h('textarea', { id: 'f-text', rows: 7, 'aria-describedby': 'hint-text err-text', placeholder: 'Например: гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали…', oninput: () => showErr('text', '') });
  const fileIn = h('input', { type: 'file', id: 'f-photos', accept: 'image/*', multiple: true, class: 'visually-hidden', onchange: e => addFiles(e.target.files) });
  const drop = h('label', {
    class: 'drop', for: 'f-photos',
    ondragover: e => { e.preventDefault(); drop.classList.add('is-over'); },
    ondragleave: () => drop.classList.remove('is-over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); },
  }, h('span', { class: 'drop-title' }, 'Добавить фото'), h('span', { class: 'muted' }, 'перетащите сюда или выберите файлы · до 8 снимков'));
  const link = h('input', { type: 'url', id: 'f-link', placeholder: 'https://open.spotify.com/track/…', oninput: () => showErr('song', '') });
  const query = h('input', { type: 'text', id: 'f-query', placeholder: 'Frank Sinatra — Autumn Leaves', oninput: () => showErr('song', '') });
  const songFile = h('input', { type: 'file', id: 'f-audio', accept: 'audio/*', onchange: () => showErr('song', '') });
  link.addEventListener('change', async () => {
    if (query.value.trim()) return;
    const t = await titleFromLink(link.value);
    if (t && !query.value.trim()) query.value = t;
  });
  const weatherOn = h('input', { type: 'checkbox', id: 'f-weather' });
  const city = h('input', { type: 'text', id: 'f-city', placeholder: 'Астана', value: getSetting('city', ''), disabled: true });
  weatherOn.addEventListener('change', () => { city.disabled = !weatherOn.checked; if (weatherOn.checked) city.focus(); });

  const steps = h('ol', { class: 'steps', 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, 'Собрать воспоминание');

  const form = h('form', {
    class: 'form', novalidate: true,
    onsubmit: async e => {
      e.preventDefault();
      let ok = true;
      if (wordCount(text.value) < 3) { showErr('text', 'Напишите хотя бы пару предложений о дне — из слов система берёт свет и настроение.'); ok = false; }
      if (!photoFiles.length) { showErr('photos', 'Добавьте хотя бы одно фото этого дня.'); ok = false; }
      if (!link.value.trim() && !query.value.trim() && !songFile.files[0]) { showErr('song', 'Добавьте песню: ссылку, название или свой аудиофайл.'); ok = false; }
      if (!ok) { form.querySelector('.field-error:not([hidden])')?.previousElementSibling?.focus?.(); return; }
      if (weatherOn.checked && city.value.trim()) setSetting('city', city.value.trim());
      submit.disabled = true; submit.textContent = 'Собираю…';
      const rows = {};
      steps.replaceChildren(...STEPS.map(([k, label]) => (rows[k] = h('li', { class: 'step' }, h('span', { class: 'step-dot' }), h('span', null, label), h('span', { class: 'step-note muted' })))));
      const step = (k, state, note = '') => { const r = rows[k]; r.className = 'step is-' + state; r.querySelector('.step-note').textContent = note; };
      try {
        const day = await buildDay({
          date: date.value || todayISO(), text: text.value.trim(), photoFiles,
          songLink: link.value.trim(), songQuery: query.value.trim(), songFile: songFile.files[0] || null,
          weatherCity: weatherOn.checked ? city.value.trim() : '',
        }, step);
        await sleep(400);
        location.hash = `#/day/${day.id}`;
      } catch (ex) {
        console.error(ex);
        toast('Не получилось собрать воспоминание: ' + ex.message + '. Попробуйте ещё раз.', 'error');
        submit.disabled = false; submit.textContent = 'Собрать воспоминание';
      }
    },
  },
    h('div', { class: 'field' }, h('label', { for: 'f-date' }, 'Дата'), date),
    h('div', { class: 'field' },
      h('label', { for: 'f-text' }, 'Как прошёл день?'),
      h('p', { class: 'hint', id: 'hint-text' }, 'Пишите, как рассказали бы близкому другу: погода, свет, запахи, звуки, люди рядом, мелочи.'),
      text, errEl('text')),
    h('div', { class: 'field' }, h('span', { class: 'label-like' }, 'Фото дня'), fileIn, drop, thumbs, errEl('photos')),
    h('fieldset', { class: 'field' },
      h('legend', null, 'Песня дня'),
      h('label', { for: 'f-link', class: 'sub' }, 'Ссылка на музыкальный сервис'), link,
      h('label', { for: 'f-query', class: 'sub' }, 'Исполнитель — название'), query,
      h('p', { class: 'hint' }, 'По названию находим официальный 30-секундный фрагмент и слушаем его: темп, тональность, энергию.'),
      h('label', { for: 'f-audio', class: 'sub' }, 'Или свой аудиофайл'), songFile, errEl('song')),
    h('div', { class: 'field' },
      h('label', { class: 'check' }, weatherOn, h('span', null, 'Добавить погоду этого дня (Open-Meteo)')),
      h('label', { for: 'f-city', class: 'sub' }, 'Город'), city),
    h('div', { class: 'row' }, submit, h('a', { class: 'btn ghost', href: '#/' }, 'Отмена')),
    steps);

  view.replaceChildren(h('section', { class: 'wrap narrow' },
    h('p', { class: 'label' }, 'Новый день'),
    h('h1', { class: 'h1' }, 'Записать день'),
    form));
  text.focus();
}

// ---------- day view ----------
async function viewDay(id) {
  const day = await getDay(id);
  if (!day) { location.hash = '#/'; return; }
  await fontsReady();
  const list = (await allDays()).sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const idx = list.findIndex(d => d.id === id), prev = list[idx - 1], next = list[idx + 1];
  let comp = computeDay(day);

  const canvas = h('canvas', { class: 'page', role: 'img', 'aria-label': `Воспоминание дня: ${day.meta.title}` });
  const back = h('canvas', { class: 'page-back', 'aria-hidden': 'true' });
  const flip = h('div', { class: 'flip', title: 'Нажмите, чтобы перевернуть страницу' }, h('div', { class: 'flip-inner' }, canvas, back));
  const stage = h('div', { class: 'stage' }, flip, h('p', { class: 'flip-hint muted small' }, 'Нажмите на страницу, чтобы увидеть её оборот — почему день выглядит так'));
  const side = h('aside', { class: 'side' });
  view.replaceChildren(h('section', { class: 'dayview' }, stage, side));

  const renderer = new PageRenderer(canvas);
  await renderer.load(day, comp);
  const sound = getSound();
  let playing = false, speaking = false, recording = false, t0 = performance.now(), buf = null, bufTried = false, lastVideo = null;
  let raf = 0;
  const frame = () => {
    const t = playing ? sound.time() : ((performance.now() - t0) / 1000) % renderer.D;
    renderer.draw(t, playing ? sound.levels() : null);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const playBtn = h('button', { class: 'btn primary', type: 'button' });
  const voiceBtn = h('button', { class: 'btn', type: 'button' }, 'Озвучить запись');
  const whyBtn = h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'why' }, 'Почему так');
  const songNote = h('p', { class: 'note muted' });
  const voiceNote = h('p', { class: 'note muted' });
  const updatePlay = () => { playBtn.textContent = playing ? '■ Остановить' : '▶ Слушать день'; };
  updatePlay();

  async function start() {
    await sound.resume();
    if (!bufTried) { bufTried = true; try { buf = await loadSongBuffer(day.song); } catch (e) { console.warn(e); buf = null; } }
    const Mu = day.inputs.music;
    sound.stopAll();
    if (buf) sound.playSong(buf, Mu.segStart || 0, Math.min(renderer.D, buf.duration - (Mu.segStart || 0)));
    else sound.startSketch(Mu, renderer.D);
    sound.startAmbient(day.meta.ambient);
    playing = true; updatePlay();
    songNote.textContent = buf
      ? (day.song.fileBlob ? 'Звучит ваш файл — самый громкий 30-секундный фрагмент.' : 'Звучит официальный 30-секундный фрагмент.')
      : 'Превью недоступно — звучит звуковой эскиз по темпу и тональности песни.';
  }
  function stop() { sound.stopAll(); stopSpeaking(); speaking = false; voiceBtn.textContent = 'Озвучить запись'; playing = false; t0 = performance.now(); updatePlay(); }
  playBtn.addEventListener('click', () => (playing ? stop() : start()));

  voiceBtn.addEventListener('click', async () => {
    if (speaking) { stopSpeaking(); speaking = false; sound.duck(false); voiceBtn.textContent = 'Озвучить запись'; return; }
    const pv = await pickVoice(comp.voice);
    if (!playing) await start();
    speaking = speak(day.text, comp.voice, pv.voice, {
      onstart: () => sound.duck(true),
      onend: () => { sound.duck(false); speaking = false; voiceBtn.textContent = 'Озвучить запись'; },
    });
    if (speaking) { voiceBtn.textContent = '■ Остановить голос'; voiceNote.textContent = `Голос: ${pv.name}${pv.ru ? '' : ' (русский голос не найден)'} · темп ${comp.voice.rate} · высота ${comp.voice.pitch}`; }
    else toast('Синтез речи недоступен в этом браузере');
  });

  const why = h('div', { class: 'why-panel', id: 'why', hidden: true });
  const setWhy = on => {
    why.hidden = !on; whyBtn.setAttribute('aria-expanded', String(on));
    flip.classList.toggle('is-flipped', on);
  };
  whyBtn.addEventListener('click', () => setWhy(why.hidden));
  flip.addEventListener('click', () => setWhy(!flip.classList.contains('is-flipped')));
  drawBackPage(back, day, comp);

  // mood pad
  const dot = h('div', { class: 'pad-dot' });
  const pad = h('div', { class: 'pad', role: 'slider', tabindex: '0', 'aria-label': 'Поправить настроение. Влево — тяжелее, вправо — приятнее, вверх — интенсивнее, вниз — спокойнее.' },
    h('span', { class: 'pad-l pad-left' }, 'тяжело'), h('span', { class: 'pad-l pad-right' }, 'приятно'),
    h('span', { class: 'pad-l pad-top' }, 'интенсивно'), h('span', { class: 'pad-l pad-bottom' }, 'спокойно'), dot);
  const placeDot = () => {
    dot.style.left = ((comp.mood.V + 1) / 2) * 100 + '%'; dot.style.top = (1 - comp.mood.E) * 100 + '%';
    pad.setAttribute('aria-valuetext', `приятность ${comp.mood.V.toFixed(2)}, энергия ${comp.mood.E.toFixed(2)}`);
  };
  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { try { day.cover = await renderCover(day, comp); day.coverVer = COVER_VER; await putDay(day); } catch (e) { console.warn(e); } }, 900);
  };
  const applyOverride = o => { day.override = o; comp = computeDay(day); renderer.setComputed(comp); drawBackPage(back, day, comp); placeDot(); renderInfo(); scheduleSave(); };
  const fromPointer = ev => {
    const r = pad.getBoundingClientRect();
    applyOverride({ valence: clamp((ev.clientX - r.left) / r.width) * 2 - 1, energy: 1 - clamp((ev.clientY - r.top) / r.height) });
  };
  let dragging = false;
  pad.addEventListener('pointerdown', ev => { dragging = true; pad.setPointerCapture(ev.pointerId); fromPointer(ev); });
  pad.addEventListener('pointermove', ev => { if (dragging) fromPointer(ev); });
  pad.addEventListener('pointerup', () => { dragging = false; });
  pad.addEventListener('keydown', ev => {
    const d = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[ev.key];
    if (!d) return;
    ev.preventDefault(); ev.stopPropagation();
    applyOverride({ valence: clamp(comp.mood.V + d[0], -1, 1), energy: clamp(comp.mood.E + d[1]) });
  });
  const resetBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => applyOverride(null) }, 'Вернуть как прочитала система');

  // folder + video
  const folderBtn = h('button', { class: 'btn', type: 'button' }, canUseFolders() ? 'Сохранить папку дня' : 'Скачать папку дня (ZIP)');
  const recBtn = h('button', { class: 'btn', type: 'button' }, 'Записать видео 30 с');
  const recNote = h('p', { class: 'note muted', 'aria-live': 'polite' });
  async function saveFolder() {
    folderBtn.disabled = true;
    try {
      const cover = await renderer.poster(PW);
      const res = await saveToFolder(day, comp, { cover, video: lastVideo });
      toast(res.mode === 'folder' ? `Сохранено в «${res.root}/${res.name}» — ${res.files.length} файлов` : 'Скачан ZIP с папкой дня');
    } catch (e) { if (e.name !== 'AbortError') toast('Не удалось сохранить папку: ' + e.message, 'error'); }
    folderBtn.disabled = false;
  }
  folderBtn.addEventListener('click', saveFolder);
  recBtn.addEventListener('click', async () => {
    if (recording) return;
    if (!('MediaRecorder' in window) || !canvas.captureStream) { toast('Запись видео не поддерживается в этом браузере', 'error'); return; }
    recording = true; recBtn.disabled = true;
    stop(); await start();
    const stream = canvas.captureStream(30);
    const at = sound.rec.stream.getAudioTracks()[0];
    if (at) stream.addTrack(at);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => (rec.onstop = r));
    rec.start(500);
    const D = renderer.D, began = performance.now();
    const tick = setInterval(() => { recNote.textContent = `Идёт запись… ${Math.max(0, Math.ceil(D - (performance.now() - began) / 1000))} с. Не переключайте вкладку.`; }, 250);
    await sleep(D * 1000 + 150);
    rec.stop(); await done; clearInterval(tick);
    lastVideo = new Blob(chunks, { type: 'video/webm' });
    recording = false; recBtn.disabled = false;
    recNote.replaceChildren('Видео готово. ',
      h('button', { class: 'linklike', type: 'button', onclick: () => downloadBlob(lastVideo, safeName(day.meta.title) + '.webm') }, 'Скачать .webm'),
      ' · оно же попадёт в папку дня при сохранении.');
  });

  const delBtn = h('button', {
    class: 'btn danger ghost small', type: 'button', onclick: async () => {
      if (!confirm(`Удалить день «${day.meta.title}» из дневника? Это нельзя отменить.`)) return;
      await deleteDay(day.id); toast(`День «${day.meta.title}» удалён`); location.hash = '#/';
    },
  }, 'Удалить день');

  function renderInfo() {
    const meta = day.song?.meta || {}, Mu = day.inputs.music, W = comp.weights;
    side.replaceChildren(
      h('nav', { class: 'daynav', 'aria-label': 'Соседние дни' },
        h('a', { class: 'btn ghost small', href: '#/' }, '← Архив'),
        h('span', { class: 'spacer' }),
        prev ? h('a', { class: 'btn ghost small', href: `#/day/${prev.id}`, title: prev.meta.title }, '‹ Раньше') : null,
        next ? h('a', { class: 'btn ghost small', href: `#/day/${next.id}`, title: next.meta.title }, 'Позже ›') : null),
      h('p', { class: 'label' }, `${fmtDateLong(day.date)} · ${weekday(day.date)}`),
      h('h1', { class: 'day-title' }, day.meta.title),
      h('p', { class: 'folder' }, h('span', { class: 'folder-ico', 'aria-hidden': 'true' }), `Папка: ${safeName(`${day.date} · ${day.meta.title}`)}`),
      h('p', { class: 'chip-row' },
        h('span', { class: 'chip strong' }, `${TECH[comp.primary].name} · ${Math.round(W[comp.primary] * 100)}%`),
        W[comp.secondary] >= 0.05 ? h('span', { class: 'chip' }, `${TECH[comp.secondary].name} · ${Math.round(W[comp.secondary] * 100)}%`) : null,
        comp.mood.overridden ? h('span', { class: 'chip warn' }, 'настроение поправлено') : null),
      h('div', { class: 'row tight' }, playBtn, voiceBtn, whyBtn),
      songNote, voiceNote,
      why,
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Песня'),
        h('p', null, `♪ ${meta.artist ? meta.artist + ' — ' : ''}${meta.title || day.song?.query || 'без названия'}${meta.year ? ` (${meta.year})` : ''}`),
        h('p', { class: 'muted small' }, Mu.source === 'audio' ? `${Mu.bpm} BPM · ${Mu.key} · энергия ${Math.round(Mu.energy * 100)}%` : `≈${Mu.bpm} BPM по жанру ${meta.genre || ''}`),
        (day.song?.link || meta.trackViewUrl) ? h('a', { class: 'linklike', href: day.song.link || meta.trackViewUrl, target: '_blank', rel: 'noopener' }, `Открыть в ${day.song.service || 'Apple Music'} ↗`) : null),
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Запись'),
        h('p', { class: 'entry' }, day.text),
        h('p', { class: 'muted small' }, `Разбор: ${day.meta.analyzer === 'claude' ? 'Claude + правила системы' : 'локальные правила'}. Это настроение записи, а не оценка состояния человека.`)),
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Поправить настроение'),
        h('p', { class: 'muted small' }, 'Если система прочитала день не так — передвиньте точку, страница перерисуется сразу.'),
        pad, resetBtn),
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Папка и видео'),
        h('div', { class: 'row tight' }, folderBtn, recBtn), recNote,
        h('p', { class: 'muted small' }, 'В папке: запись, фото, песня (ссылка и «отпечаток»), обложка, видео, «почему так» и параметры озвучки.')),
      h('div', { class: 'block end' }, delBtn));
    why.replaceChildren(...whyContent());
    placeDot();
  }

  function whyContent() {
    const W = comp.weights, st = comp.style, env = day.inputs.music.envelope || [];
    const out = [
      h('h2', { class: 'h2' }, 'Почему день выглядит так'),
      h('ol', { class: 'why' }, comp.recipe.map(r => h('li', null, h('span', { class: 'why-src' }, r.src), h('span', { class: 'why-sig' }, r.sig), h('span', { class: 'why-rule' }, r.rule)))),
      h('h3', { class: 'h3' }, 'Смесь техник'),
      h('div', { class: 'bars' }, TECH_ORDER.map(k => h('div', { class: 'bar-row' + (k === comp.primary ? ' is-primary' : '') },
        h('span', { class: 'bar-label' }, TECH[k].name, h('small', null, TECH[k].ref)),
        h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: Math.max(1, W[k] * 100) + '%' } })),
        h('span', { class: 'bar-val' }, Math.round(W[k] * 100) + '%')))),
      h('h3', { class: 'h3' }, 'Палитра дня'),
      h('div', { class: 'swatches' }, [...st.palette, ...st.accents].map(c => h('span', { class: 'sw', style: { background: rgbHex(c) }, title: rgbHex(c) }))),
    ];
    if (env.length) {
      const pts = env.map((v, i) => `${(i / (env.length - 1)) * 300},${40 - v * 36}`).join(' ');
      const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 42" class="spark" role="img" aria-label="Громкость песни во времени"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`, 'image/svg+xml').documentElement;
      out.push(h('h3', { class: 'h3' }, 'Энергия фрагмента'), svg);
    }
    out.push(h('p', { class: 'muted small' }, 'Печать дня в углу страницы: четыре дуги — приятность (цветная), энергия, тепло, люди; в центре — время суток.'));
    return out;
  }

  renderInfo();

  const onKey = e => {
    if (e.target.closest('input, textarea, select, [role=slider]')) return;
    if (e.key === ' ') { e.preventDefault(); playing ? stop() : start(); }
    else if (e.key === 'ArrowLeft' && prev) location.hash = `#/day/${prev.id}`;
    else if (e.key === 'ArrowRight' && next) location.hash = `#/day/${next.id}`;
    else if (e.key === 'Escape') location.hash = '#/';
  };
  document.addEventListener('keydown', onKey);
  const onVis = () => { if (document.hidden && playing && !recording) stop(); };
  document.addEventListener('visibilitychange', onVis);

  onCleanup(() => {
    cancelAnimationFrame(raf); clearTimeout(saveTimer);
    sound.stopAll(); stopSpeaking(); renderer.dispose();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
  });
}

// ---------- settings ----------
function openSettings() {
  const key = h('input', { type: 'password', id: 's-key', value: getSetting('apiKey'), autocomplete: 'off', placeholder: 'sk-ant-…' });
  const photos = h('input', { type: 'checkbox', id: 's-photos' });
  photos.checked = getSetting('sendPhotos') === '1';
  const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 's-title' },
    h('form', { method: 'dialog', class: 'form' },
      h('h2', { class: 'h2', id: 's-title' }, 'Настройки'),
      h('div', { class: 'field' },
        h('label', { for: 's-key' }, 'Ключ Claude API (необязательно)'),
        h('p', { class: 'hint' }, 'Без ключа текст разбирается локальными правилами. С ключом Claude уточняет настроение, название и детали. Ключ хранится только в этом браузере и отправляется только на api.anthropic.com.'),
        key),
      h('label', { class: 'check' }, photos, h('span', null, 'Отправлять в Claude уменьшенные фото (до 3) для точности')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', value: 'save' }, 'Сохранить настройки'),
        h('button', { class: 'btn ghost', value: 'cancel' }, 'Отмена'))));
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'save') { setSetting('apiKey', key.value.trim()); setSetting('sendPhotos', photos.checked ? '1' : '0'); toast('Настройки сохранены'); }
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
}
document.getElementById('settings-btn').addEventListener('click', openSettings);

route();
