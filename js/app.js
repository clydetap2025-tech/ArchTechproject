// App shell: archive, new-day form + pipeline, day viewer (page, sound, voice, "why", mood pad, folder, video).
import { h, todayISO, fmtDateLong, weekday, clamp, sleep, downloadBlob, uid, rgbHex, canvasBlob, wordCount, TIME_RU, SEASON_RU, rgbCss, plural } from './util.js';
import { allDays, getDay, putDay, deleteDay, getSetting, setSetting } from './store.js';
import { analyzeText } from './text.js';
import { processPhoto } from './photo.js';
import { parseLink, titleFromLink, searchSong, analyzeSong, loadSongBuffer } from './music.js';
import { computeDay, TECH, TECH_ORDER } from './mood.js';
import { PageRenderer, renderCover, drawBackPage, PW, PH } from './page.js';
import { getSound } from './sound.js';
import { pickVoice, speak, stopSpeaking } from './voice.js';
import { saveToFolder, canUseFolders, safeName, zipFiles } from './folder.js';
import { DEMO_DAYS, DEMO_VERSION, loadDemoPhoto } from './demo.js';
import { atmosphere, deviceLocation, fetchWeatherAt, fetchWeatherByCity, weatherLabel } from './weather.js';
import { memoryGallery, scenery, setScenery } from './gallery.js';

const view = document.getElementById('view');
// Bump when the visual system changes: archive covers re-render themselves in the background.
const COVER_VER = 7;
let cleanups = [];
let routeVersion = 0;
let liveWeather = null;
let deviceCoordinates = null;
let checkedWeatherPermission = false;
const onCleanup = fn => cleanups.push(fn);

// ---------- helpers ----------
let fontsP = null;
function fontsReady() {
  if (!fontsP) {
    const sample = 'Аа Яя Ёё 0123';
    const loading = Promise.all([
      '300 40px Literata', '500 40px Literata', '800 40px Literata', 'italic 400 40px Literata', 'italic 700 40px Literata',
      '550 40px Manrope', '400 24px "JetBrains Mono"', '600 24px "JetBrains Mono"',
    ].map(f => document.fonts.load(f, sample))).catch(() => {});
    fontsP = Promise.race([loading, sleep(1500)]);
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

async function locateWeather(date) {
  const coordinates = await deviceLocation();
  const weather = await fetchWeatherAt(coordinates, date);
  deviceCoordinates = coordinates;
  if (!date) liveWeather = weather;
  return weather;
}

function weatherControl(applyTheme, useAutomaticTheme) {
  const description = h('span', { class: 'weather-reading', role: 'status' });
  const button = h('button', { class: 'weather-action', type: 'button', title: 'Использовать фон по погоде' });
  const update = () => {
    const theme = atmosphere(todayISO(), liveWeather);
    applyTheme(theme);
    description.textContent = liveWeather ? weatherLabel(liveWeather) : SEASON_RU[theme.season];
    button.textContent = liveWeather ? 'Обновить погоду ↗' : 'Определить по геолокации ↗';
  };
  const refresh = async () => {
    button.disabled = true;
    description.textContent = 'Определяю погоду…';
    try { await locateWeather(); update(); }
    catch (error) { description.textContent = error.message; }
    finally { button.disabled = false; }
  };
  button.onclick = () => { useAutomaticTheme(); refresh(); };
  update();
  if (!checkedWeatherPermission) {
    checkedWeatherPermission = true;
    navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
      if (permission.state === 'granted' && button.isConnected && !button.disabled && !liveWeather) refresh();
    }).catch(() => {});
  }
  return h('div', { class: 'weather-widget' }, h('span', { class: 'weather-symbol', 'aria-hidden': 'true' }, '◉'),
    h('div', null, h('span', { class: 'label' }, 'За окном'), description, button));
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
  const ta = analyzeText(input.text, input.date);
  step('text', 'done', 'локальные правила');

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

  let weather = input.weather || null;
  if (weather) step('weather', 'done', weatherLabel(weather));
  else if (input.weatherCity) {
    step('weather', 'active');
    try { weather = await fetchWeatherByCity(input.weatherCity, input.date); step('weather', 'done', weatherLabel(weather)); }
    catch (e) { step('weather', 'done', 'не удалось получить'); }
  } else step('weather', 'skip', 'не добавлена');

  step('render', 'active');
  const ambient = [...ta.ambient];
  const theme = atmosphere(input.date, weather, ta);
  if (theme.motion === 'rain' && !ambient.includes('rain')) ambient.unshift('rain');
  if (theme.motion === 'snow' && !ambient.includes('wind')) ambient.push('wind');
  const day = {
    id: uid(), created: Date.now(), date: input.date, text: input.text, photos, song,
    ...(input.demoKey ? { demoKey: input.demoKey, demoVersion: DEMO_VERSION } : {}),
    inputs: { text: ta, music, weather },
    meta: { title: ta.title, caption: ta.caption, sensory: ta.sensory, ambient: ambient.slice(0, 2) },
    override: null,
  };
  const comp = computeDay(day);
  await fontsReady();
  day.cover = await renderCover(day, comp);
  day.coverVer = COVER_VER;
  await putDay(day);
  step('render', 'done', `«${day.meta.title}»`);
  return day;
}

async function seedDemo(onProgress) {
  const days = [];
  const existing = new Map((await allDays()).map(day => [exampleFor(day)?.date, day]));
  for (let i = 0; i < DEMO_DAYS.length; i++) {
    const d = DEMO_DAYS[i];
    if (existing.has(d.date)) { days.push(await upgradeDemo(existing.get(d.date))); continue; }
    onProgress(i, d);
    const files = await Promise.all(d.photos.map(loadDemoPhoto));
    days.push(await buildDay({ date: d.date, text: d.text, photoFiles: files, songQuery: d.song, demoKey: d.date }));
  }
  return days;
}

function exampleFor(day) {
  if (day.demoKey) return DEMO_DAYS.find(example => example.date === day.demoKey);
  return DEMO_DAYS.find(example => example.date === day.date && example.text === day.text && example.song === day.song?.query);
}

const demoUpgrades = new Map();
async function upgradeDemo(day) {
  const example = exampleFor(day);
  if (!example || day.demoVersion === DEMO_VERSION) return day;
  if (!demoUpgrades.has(day.id)) {
    const upgrade = (async () => {
      const photos = [];
      for (const name of example.photos) photos.push(await processPhoto(await loadDemoPhoto(name)));
      const updated = { ...day, photos, demoKey: example.date, demoVersion: DEMO_VERSION };
      await fontsReady();
      updated.cover = await renderCover(updated, computeDay(updated));
      updated.coverVer = COVER_VER;
      await putDay(updated);
      return updated;
    })().catch(error => { console.warn('Не удалось обновить демо', error); return day; })
      .finally(() => demoUpgrades.delete(day.id));
    demoUpgrades.set(day.id, upgrade);
  }
  return demoUpgrades.get(day.id);
}

// ---------- router ----------
async function route() {
  const version = ++routeVersion;
  const current = () => version === routeVersion;
  cleanups.forEach(f => { try { f(); } catch { /* */ } });
  cleanups = [];
  window.scrollTo(0, 0);
  const hash = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = a.getAttribute('href') === hash;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    if (hash.startsWith('#/day/')) await viewDay(decodeURIComponent(hash.slice(6)), current);
    else if (hash === '#/new') await viewNew();
    else await viewArchive(current);
  } catch (e) {
    if (!current()) return;
    console.error(e);
    view.replaceChildren(h('section', { class: 'wrap' }, h('h1', { class: 'h1' }, 'Что-то пошло не так'), h('p', { class: 'muted' }, String(e.message || e)), h('a', { class: 'btn', href: '#/' }, 'Вернуться в архив')));
  }
}
window.addEventListener('hashchange', route);
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  view.focus();
});

const glassControls = '.btn, .fchip, .gallery-arrow, .nav a, .icon-btn, .weather-action, .thumb-x, button.linklike';
const glassMotion = matchMedia('(prefers-reduced-motion: reduce)');
const setGlassSpot = event => {
  if (glassMotion.matches || !(event.target instanceof Element)) return;
  const button = event.target.closest(glassControls);
  if (!button || button.matches(':disabled')) return;
  const bounds = button.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  button.style.setProperty('--glass-x', `${clamp((event.clientX - bounds.left) / bounds.width) * 100}%`);
  button.style.setProperty('--glass-y', `${clamp((event.clientY - bounds.top) / bounds.height) * 100}%`);
};
document.addEventListener('pointermove', setGlassSpot, { passive: true });
document.addEventListener('pointerdown', setGlassSpot, { passive: true });

// ---------- archive ----------
async function viewArchive(current) {
  const archived = await allDays();
  const days = [];
  for (const day of archived) {
    if (!current()) return;
    days.push(await upgradeDemo(day));
  }
  if (!current()) return;
  days.sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  if (!days.length) return viewEmpty();
  await fontsReady();
  if (!current()) return;
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
    const cover = d.coverVer === COVER_VER && d.cover ? d.cover : d.photos[0]?.blob;
    const url = cover ? URL.createObjectURL(cover) : '';
    if (url) urls.push(url);
    const hay = [d.meta.title, d.text, d.song?.meta?.artist, d.song?.meta?.title, d.date, fmtDateLong(d.date), c && TECH[c.primary].name, c && TIME_RU[c.mood.light], SEASON_RU[d.inputs.text.season]].join(' ').toLowerCase();
    const img = h('img', { src: url || null, alt: '', loading: 'lazy' });
    imgs.set(d.id, img);
    const el = h('a', { class: 'card', href: `#/day/${d.id}`, 'data-tech': c?.primary || '', 'data-light': c?.mood.light || '' },
      h('div', { class: 'card-img' }, img),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-title' }, d.meta.title),
        h('div', { class: 'card-meta' }, `${fmtDateLong(d.date)} · ${d.photos.length} фото`)));
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
  const demoCount = new Set(days.map(d => exampleFor(d)?.date).filter(Boolean)).size;
  const demoStatus = h('p', { class: 'muted small', role: 'status', hidden: true });
  const demoBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    demoBtn.disabled = true;
    demoStatus.hidden = false;
    try {
      await seedDemo((index, example) => { demoStatus.textContent = `Загружаю демо: ${fmtDateLong(example.date)}…`; });
      if (demoStatus.isConnected) route();
    } catch (error) {
      console.error(error);
      demoStatus.textContent = 'Демо не загрузилось. Попробуйте ещё раз.';
    } finally { demoBtn.disabled = false; }
  } }, 'Загрузить демо');

  const recent = days.slice(0, 9).map(d => {
    const image = URL.createObjectURL(d.photos[0].blob);
    urls.push(image);
    return { title: d.meta.title, date: fmtDateLong(d.date), image, href: `#/day/${d.id}` };
  });
  view.replaceChildren(homeStage(recent, h('a', { class: 'btn primary big', href: '#/new' }, 'Записать день ↗')),
    h('section', { class: 'wrap archive-list' },
    h('div', { class: 'archive-head' },
      h('div', null,
        h('h1', { class: 'h1' }, 'Дневник'),
        h('p', { class: 'muted' }, `${days.length} ${days.length % 10 === 1 && days.length % 100 !== 11 ? 'день' : days.length % 10 >= 2 && days.length % 10 <= 4 && (days.length % 100 < 12 || days.length % 100 > 14) ? 'дня' : 'дней'} · откройте любой, чтобы снова увидеть и услышать его`)),
      h('div', { class: 'row tight' }, demoCount < DEMO_DAYS.length ? demoBtn : null, exportBtn,
        h('a', { class: 'btn primary', href: '#/new' }, 'Записать день'))),
    demoStatus,
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

function homeStage(items, ...actions) {
  const scene = scenery();
  let automatic, selected = null;
  const seasons = ['summer', 'autumn', 'winter', 'spring'];
  const buttons = seasons.map(season => h('button', {
    class: 'btn small season-btn', type: 'button', 'aria-pressed': 'false',
    onclick: () => {
      if (selected === season) return;
      selected = season;
      renderSeason();
    },
  }, SEASON_RU[season]));
  function renderSeason() {
    setScenery(scene, selected ? {
      scene: selected, motion: selected === 'winter' ? 'snow' : selected === 'autumn' ? 'leaves' : 'still',
    } : automatic);
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(selected === seasons[index])));
  }
  const weather = weatherControl(theme => { automatic = theme; renderSeason(); }, () => {
    selected = null;
    renderSeason();
  });
  return h('section', { class: 'landing', 'aria-labelledby': 'landing-title' }, scene,
    h('div', { class: 'season-controls', role: 'group', 'aria-label': 'Сезон фона' }, buttons),
    h('div', { class: 'landing-intro' },
      h('div', { class: 'landing-heading' },
        h('p', { class: 'label landing-label' }, 'Личный дневник'),
        h('h1', { id: 'landing-title' }, 'Дни, которые ', h('em', null, 'остаются.'))),
      h('div', { class: 'landing-detail' },
        h('p', null, 'Фото, слова и песня складываются в живое воспоминание.'),
        h('div', { class: 'landing-actions' }, actions))),
    h('div', { class: 'landscape-panel' }, weather, memoryGallery(items)));
}

function viewEmpty() {
  const titles = ['Осенний парк и какао', 'Ночь перед сдачей', 'Летний вечер на крыше',
    'Дождливый вечер дома', 'Летнее утро у моря', 'Вечер в деревне', 'Вечер перед переездом'];
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const newBtn = h('a', { class: 'btn primary big', href: '#/new' }, 'Записать день ↗');
  let busy = false;
  const openDemo = async index => {
    if (busy) return;
    busy = true;
    demoBtn.disabled = true;
    try {
      const days = await seedDemo(i => { status.textContent = `Собираю примеры · ${i + 1} из ${DEMO_DAYS.length}…`; });
      if (!status.isConnected) return;
      if (index == null) route();
      else location.hash = `#/day/${days[index].id}`;
    } catch (error) {
      console.error(error);
      status.textContent = 'Не удалось собрать примеры. Попробуйте ещё раз.';
    } finally { busy = false; demoBtn.disabled = false; }
  };
  const demoBtn = h('button', { class: 'btn big', type: 'button', onclick: () => openDemo() }, 'Загрузить демо');
  const examples = DEMO_DAYS.map((d, i) => ({
    title: titles[i], date: fmtDateLong(d.date), image: `demo/photos/${d.photos[0]}.jpg`, action: () => openDemo(i),
  }));
  view.replaceChildren(homeStage(examples, newBtn, demoBtn), h('div', { class: 'landing-status' }, status));
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
  const studioScene = scenery();
  const sceneCaption = h('p', { class: 'studio-season' });
  const weatherStatus = h('p', { class: 'hint weather-status', role: 'status' });
  let dayWeather = null, weatherRequest = 0;
  const refreshStudio = () => {
    const theme = atmosphere(date.value || todayISO(), dayWeather);
    setScenery(studioScene, theme);
    sceneCaption.textContent = dayWeather ? weatherLabel(dayWeather) : SEASON_RU[theme.season];
  };
  const locate = h('button', { class: 'btn', type: 'button' }, 'Определить по геолокации ↗');
  const clearWeather = () => {
    weatherRequest++;
    dayWeather = null;
    locate.disabled = false;
    locate.textContent = 'Определить по геолокации ↗';
    weatherStatus.textContent = '';
    refreshStudio();
  };
  date.addEventListener('change', clearWeather);
  weatherOn.addEventListener('change', () => {
    clearWeather();
    city.disabled = !weatherOn.checked;
    if (weatherOn.checked) city.focus();
  });
  locate.onclick = async () => {
    const request = ++weatherRequest;
    const selectedDate = date.value || todayISO();
    weatherOn.checked = false;
    city.disabled = true;
    dayWeather = null;
    refreshStudio();
    locate.disabled = true;
    weatherStatus.textContent = 'Загружаю погоду за выбранную дату…';
    try {
      const result = deviceCoordinates ? await fetchWeatherAt(deviceCoordinates, selectedDate) : await locateWeather(selectedDate);
      if (request !== weatherRequest) return;
      dayWeather = result;
      weatherStatus.textContent = `Добавлено · ${weatherLabel(result)}`;
      locate.textContent = 'Обновить погоду ↗';
      refreshStudio();
    } catch (error) {
      if (request === weatherRequest) weatherStatus.textContent = `${error.message}. Можно указать город.`;
    } finally { if (request === weatherRequest) locate.disabled = false; }
  };
  refreshStudio();

  const steps = h('ol', { class: 'steps', 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, 'Собрать воспоминание');

  const form = h('form', {
    class: 'form', novalidate: true,
    onsubmit: async e => {
      e.preventDefault();
      if (submit.disabled || locate.disabled) return;
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
          weather: dayWeather?.date === (date.value || todayISO()) ? dayWeather : null,
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
    h('fieldset', { class: 'field weather-field' },
      h('legend', null, 'Погода дня'),
      h('p', { class: 'hint' }, 'Open-Meteo получает округлённые координаты. Дневник сохраняет только сводку погоды.'),
      locate, weatherStatus,
      h('label', { class: 'check' }, weatherOn, h('span', null, 'Указать город вручную')),
      city),
    h('div', { class: 'row' }, submit, h('a', { class: 'btn ghost', href: '#/' }, 'Отмена')),
    steps);

  city.setAttribute('aria-label', 'Город');
  view.replaceChildren(h('section', { class: 'wrap studio' },
    h('aside', { class: 'studio-preview' }, studioScene, h('div', { class: 'studio-copy' },
      h('p', { class: 'label' }, 'Атмосфера дня'), sceneCaption)),
    h('div', { class: 'studio-editor' }, h('h1', { class: 'h1' }, 'Записать день'), form)));
}

// ---------- day view ----------
function photoAlbum(photos) {
  const urls = photos.map(photo => URL.createObjectURL(photo.blob));
  const photo = h('img', { class: 'photo-dialog-image', alt: '' });
  const counter = h('span', { class: 'small muted', 'aria-live': 'polite' });
  let index = 0;
  const select = (to) => {
    index = (to + urls.length) % urls.length;
    photo.src = urls[index];
    photo.alt = `Фото дня ${index + 1}`;
    counter.textContent = `${index + 1} из ${urls.length}`;
  };
  const dialog = h('dialog', { class: 'dialog photo-dialog', 'aria-label': 'Фотографии дня' }, photo,
    h('div', { class: 'photo-dialog-controls' },
      urls.length > 1 ? h('button', { class: 'btn small', type: 'button', 'aria-label': 'Предыдущее фото', onclick: () => select(index - 1) }, '←') : null,
      counter,
      urls.length > 1 ? h('button', { class: 'btn small', type: 'button', 'aria-label': 'Следующее фото', onclick: () => select(index + 1) }, '→') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => dialog.close() }, 'Закрыть')));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      select(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
    event.stopPropagation();
  });
  document.body.append(dialog);
  onCleanup(() => {
    dialog.remove();
    urls.forEach(url => URL.revokeObjectURL(url));
  });
  return h('section', { class: 'block day-album', 'aria-label': 'Фотографии дня' },
    h('h2', { class: 'h2' }, `${photos.length} ${plural(photos.length, 'фотография', 'фотографии', 'фотографий')}`),
    h('div', { class: 'day-album-grid' }, urls.map((src, i) => h('button', {
      class: 'day-album-tile', type: 'button', 'aria-label': `Открыть фото ${i + 1}`,
      onclick: () => { select(i); dialog.showModal(); },
    }, h('img', { src, alt: '', loading: 'lazy', decoding: 'async' })))));
}

async function viewDay(id, current) {
  const stored = await getDay(id);
  if (!current()) return;
  if (!stored) { location.hash = '#/'; return; }
  const day = await upgradeDemo(stored);
  await fontsReady();
  const list = (await allDays()).sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  if (!current()) return;
  const idx = list.findIndex(d => d.id === id), prev = list[idx - 1], next = list[idx + 1];
  let comp = computeDay(day);

  const canvas = h('canvas', { class: 'page', role: 'img', 'aria-label': `Воспоминание дня: ${day.meta.title}` });
  const back = h('canvas', { class: 'page-back', 'aria-hidden': 'true' });
  const flip = h('div', { class: 'flip', role: 'button', tabindex: '0', 'aria-label': 'Перевернуть карточку', 'aria-pressed': 'false' },
    h('div', { class: 'flip-inner' }, canvas, back));
  const dayScene = scenery();
  const theme = atmosphere(day.date, day.inputs.weather, day.inputs.text);
  setScenery(dayScene, theme);
  const stage = h('div', { class: 'stage' }, dayScene, flip, h('p', { class: 'flip-hint small' }, 'Нажмите на страницу, чтобы увидеть оборот'));
  const side = h('aside', { class: 'side' });
  view.replaceChildren(h('section', { class: 'dayview' }, stage, side));

  const renderer = new PageRenderer(canvas);
  await renderer.load(day, comp);
  if (!current()) {
    renderer.dispose();
    return;
  }
  const album = photoAlbum(day.photos);
  const sound = getSound();
  let playing = false, speaking = false, recording = false, t0 = performance.now(), buf = null, bufTried = false, lastVideo = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  const frame = () => {
    const still = reducedMotion.matches && !recording;
    const t = still ? renderer.posterTime() : playing ? sound.time() : ((performance.now() - t0) / 1000) % renderer.D;
    renderer.draw(t, playing && !still ? sound.levels() : null, { poster: still });
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
    flip.setAttribute('aria-pressed', String(on));
  };
  whyBtn.addEventListener('click', () => setWhy(why.hidden));
  flip.addEventListener('click', () => setWhy(!flip.classList.contains('is-flipped')));
  flip.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    flip.click();
  });
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
      h('p', { class: 'day-weather' }, [SEASON_RU[theme.season], weatherLabel(day.inputs.weather)].filter(Boolean).join(' · ')),
      h('p', { class: 'folder' }, h('span', { class: 'folder-ico', 'aria-hidden': 'true' }), `Папка: ${safeName(`${day.date} · ${day.meta.title}`)}`),
      h('p', { class: 'chip-row' },
        h('span', { class: 'chip strong' }, `${TECH[comp.primary].name} · ${Math.round(W[comp.primary] * 100)}%`),
        W[comp.secondary] >= 0.05 ? h('span', { class: 'chip' }, `${TECH[comp.secondary].name} · ${Math.round(W[comp.secondary] * 100)}%`) : null,
        comp.mood.overridden ? h('span', { class: 'chip warn' }, 'настроение поправлено') : null),
      h('div', { class: 'row tight' }, playBtn, voiceBtn, whyBtn),
      songNote, voiceNote,
      why,
      album,
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Песня'),
        h('p', null, `♪ ${meta.artist ? meta.artist + ' — ' : ''}${meta.title || day.song?.query || 'без названия'}${meta.year ? ` (${meta.year})` : ''}`),
        h('p', { class: 'muted small' }, Mu.source === 'audio' ? `${Mu.bpm} BPM · ${Mu.key} · энергия ${Math.round(Mu.energy * 100)}%` : `≈${Mu.bpm} BPM по жанру ${meta.genre || ''}`),
        (day.song?.link || meta.trackViewUrl) ? h('a', { class: 'linklike', href: day.song.link || meta.trackViewUrl, target: '_blank', rel: 'noopener' }, `Открыть в ${day.song.service || 'Apple Music'} ↗`) : null),
      h('div', { class: 'block' },
        h('h2', { class: 'h2' }, 'Запись'),
        h('p', { class: 'entry' }, day.text),
        h('p', { class: 'muted small' }, 'Настроение записи определяют локальные правила.')),
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

route();
