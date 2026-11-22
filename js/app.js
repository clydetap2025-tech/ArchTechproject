// App shell: archive, new-day form + pipeline, day viewer (page, sound, voice, "why", mood pad, folder, video).
import { h, todayISO, fmtDateLong, clamp, sleep, downloadBlob, uid, rgbHex, canvasBlob, wordCount, SEASON_RU } from './util.js';
import { allDays, getDay, putDay, deleteDay, getSetting, setSetting, legacyDays, moveLegacyDay } from './store.js';
import { account, loginForm, signOut, renewSession } from './account.js';
import { analyzeText } from './text.js';
import { processPhoto, aggregatePhotos } from './photo.js';
import { parseLink, titleFromLink, searchSong, analyzeSong, loadSongBuffer, findMusicForPhotos } from './music.js';
import { computeDay, TECH, TECH_ORDER } from './mood.js';
import { PageRenderer, renderCover, drawBackPage, FONT, PW, PH } from './page.js';
import { getSound } from './sound.js';
import { pickVoice, speak, stopSpeaking } from './voice.js';
import { saveToFolder, canUseFolders, safeName, zipFiles } from './folder.js';
import { DEMO_DAYS, DEMO_VERSION, entryTitle, exampleFor, loadDemoPhoto } from './demo.js';
import { atmosphere, deviceLocation, fetchWeatherAt, fetchWeatherByCity, weatherLabel } from './weather.js';
import { memoryGallery, scenery, setScenery, animateScenery } from './gallery.js';
import { archiveAlbum } from './archive.js';
import { openSettings } from './preferences.js';
import { photoTrackPicker } from './photo-track-picker.js';
import { cloudSetVisibility, cloudSharedDay } from './cloud-days.js';
import { visibilityOf } from './day-sharing.js';
import { newDayVisibility, visibilityPicker } from './day-visibility.js';
import { friendsFeed, friendsPage, invitationPage, listFriends } from './friends.js';
import { loadWarmth } from './warmth.js';
import { localized, setAttribute as setUiAttribute, setText, translate, ui, uiDate, uiTextNode } from './i18n.js';

const view = document.getElementById('view');
// Version of the rendered day cover saved alongside an entry.
const COVER_VER = 9;
let cleanups = [];
let routeVersion = 0;
let liveWeather = null;
let deviceCoordinates = null;
const onCleanup = fn => cleanups.push(fn);

// ---------- helpers ----------
function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  const el = h('div', { class: 'toast ' + kind, role: kind === 'error' ? 'alert' : 'status' }, msg);
  t.append(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4800);
}

const safeCompute = d => { try { return computeDay(d); } catch (e) { console.warn(e); return null; } };

const weatherMessage = weather => localized(() =>
  weatherLabel(weather && { ...weather, text: translate(weather.text || '') }));

async function locateWeather(date) {
  const coordinates = await deviceLocation();
  const weather = await fetchWeatherAt(coordinates, date);
  deviceCoordinates = coordinates;
  if (!date) liveWeather = weather;
  return weather;
}

function weatherControl(applyTheme) {
  const description = h('span', { class: 'weather-reading', role: 'status' });
  const button = h('button', { class: 'weather-action', type: 'button', title: ui('Использовать фон по погоде') });
  const update = () => {
    const theme = atmosphere(todayISO(), liveWeather);
    applyTheme(theme);
    setText(description, liveWeather ? weatherMessage(liveWeather) : ui(SEASON_RU[theme.season]));
    setText(button, ui(liveWeather ? 'Обновить погоду ↗' : 'Определить по геолокации ↗'));
  };
  const refresh = async () => {
    button.disabled = true;
    setText(description, ui('Определяю погоду…'));
    try { await locateWeather(); update(); }
    catch (error) { setText(description, ui(error.message)); }
    finally { button.disabled = false; }
  };
  button.onclick = refresh;
  update();
  if (!liveWeather) {
    navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
      if (permission.state === 'granted' && button.isConnected && !button.disabled && !liveWeather) refresh();
    }).catch(() => {});
  }
  return h('div', { class: 'weather-widget' }, h('span', { class: 'weather-symbol', 'aria-hidden': 'true' }, '◉'),
    h('div', null, h('span', { class: 'label' }, ui('За окном')), description, button));
}

// ---------- pipeline ----------
const STEPS = [
  ['photos', 'Смотрю на фото: палитра, свет, время съёмки'],
  ['text', 'Читаю запись: настроение, время, место, детали'],
  ['music', 'Слушаю песню: темп, тональность, энергия'],
  ['weather', 'Погода этого дня'],
  ['render', 'Собираю страницу и папку дня'],
];

async function buildDay(input, step = () => {}, preparePhoto = processPhoto) {
  step('photos', 'active');
  const photos = [];
  for (const file of input.photoFiles) {
    const photo = await preparePhoto(file);
    if (!input.demoKey) {
      photo.original = file;
      photo.originalName = file.name;
    }
    photos.push(photo);
  }
  step('photos', 'done', ui('{count} фото', { count: photos.length }));

  step('text', 'active');
  const ta = analyzeText(input.text, input.date);
  step('text', 'done', ui('локальные правила'));

  step('music', 'active');
  let song = { link: input.songLink || null, query: input.songQuery || null, service: parseLink(input.songLink)?.service || null, meta: null };
  let music;
  if (input.songFile) {
    song.fileBlob = input.songFile; song.fileName = input.songFile.name;
    song.meta = { title: input.songQuery || input.songFile.name.replace(/\.[^.]+$/, ''), artist: '' };
  } else if (input.photoSong) {
    song = input.photoSong;
  } else if (!song.query && !song.link) {
    step('music', 'active', ui('Ищу музыку по фото…'));
    ({ song, music } = await findMusicForPhotos(aggregatePhotos(photos), input.signal));
  } else {
    let q = song.query;
    if (!q && song.link) q = await titleFromLink(song.link);
    if (q) { song.query = q; song.meta = await searchSong(q); }
  }
  if (!song.meta) song.meta = { title: song.query || 'песня дня', artist: '' };
  music ||= await analyzeSong(song, input.signal);
  step('music', 'done', music.source === 'audio' ? `${music.bpm} BPM · ${music.key}` : ui('по жанру (превью недоступно)'));

  let weather = input.weather || null;
  if (weather) step('weather', 'done', weatherMessage(weather));
  else if (input.weatherCity) {
    step('weather', 'active');
    try { weather = await fetchWeatherByCity(input.weatherCity, input.date); step('weather', 'done', weatherMessage(weather)); }
    catch { step('weather', 'done', ui('не удалось получить')); }
  } else step('weather', 'skip', ui('не добавлена'));

  step('render', 'active');
  const ambient = [...ta.ambient];
  const theme = atmosphere(input.date, weather, ta);
  if (theme.motion === 'rain' && !ambient.includes('rain')) ambient.unshift('rain');
  if (theme.motion === 'snow' && !ambient.includes('wind')) ambient.push('wind');
  const day = {
    id: uid(), created: Date.now(), date: input.date, text: input.text, photos, song,
    visibility: visibilityOf(input.visibility),
    ...(input.demoKey ? { demoKey: input.demoKey, demoVersion: DEMO_VERSION } : {}),
    inputs: { text: ta, music, weather },
    meta: { title: ta.title, caption: ta.caption, sensory: ta.sensory, ambient: ambient.slice(0, 2) },
    override: null,
  };
  input.signal?.throwIfAborted();
  const comp = computeDay(day);
  day.cover = await renderCover(day, comp);
  day.coverVer = COVER_VER;
  input.signal?.throwIfAborted();
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

const demoUpgrades = new Map();
async function upgradeDemo(day) {
  const example = exampleFor(day);
  if (!example || day.demoVersion === DEMO_VERSION) return day;
  if (!demoUpgrades.has(day.id)) {
    const upgrade = (async () => {
      const photos = [];
      for (const name of example.photos) photos.push(await processPhoto(await loadDemoPhoto(name)));
      const updated = { ...day, photos, demoKey: example.date, demoVersion: DEMO_VERSION };
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

// ---------- account menu ----------
function accountInitials(email) {
  const local = email.split('@', 1)[0];
  const words = local.match(/\p{L}+/gu) || [];
  const letters = words.length > 1 ? words.slice(0, 2).map(word => [...word][0]).join('') : words[0] || local;
  return [...letters.toUpperCase()].slice(0, 2).join('') || 'D';
}

function accountIcon(paths) {
  return h('span', { class: 'account-menu-icon', 'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` });
}

function mountAccountMenu() {
  const avatar = h('summary', { class: 'account-avatar', 'aria-label': ui('Аккаунт'), 'aria-controls': 'account-options' },
    accountInitials(account.email || ''));
  const status = h('p', { class: 'account-menu-status', role: 'status' });
  let previous = null;
  let checking = false;
  const move = h('button', { class: 'account-menu-item', type: 'button', hidden: true, onclick: async () => {
    if (!confirm(translate('Перенести прежние записи с этого устройства в аккаунт {email}?', { email: account.email }))) return;
    move.disabled = true;
    setText(status, ui('Переношу записи…'));
    try {
      while (previous.length) {
        await moveLegacyDay(previous[0]);
        previous.shift();
      }
      move.hidden = true;
      status.textContent = '';
      toast(ui('Записи и фотографии перенесены в ваш архив.'));
      if (location.hash === '#/archive' || location.hash === '#/account') route();
    } catch (error) {
      setText(status, ui(error.message));
    } finally {
      move.disabled = false;
    }
  } }, accountIcon('<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>'), ui('Перенести прежние записи'));
  const archive = h('a', { class: 'account-menu-item', href: '#/archive', onclick: () => {
    menu.open = false;
    avatar.focus({ preventScroll: true });
  } }, accountIcon('<path d="M12 6a8 8 0 0 0-8-1v14a8 8 0 0 1 8 1 8 8 0 0 1 8-1V5a8 8 0 0 0-8 1Zm0 0v14"/>'), ui('Мой архив'));
  const friends = h('a', { class: 'account-menu-item', href: '#/friends' },
    accountIcon('<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m1 3a4 4 0 0 1 4 4v1"/>'), ui('Друзья'));
  const settings = h('button', { class: 'account-menu-item', type: 'button', 'aria-haspopup': 'dialog', onclick: () => {
    menu.open = false;
    openSettings(avatar);
  } }, accountIcon('<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="#19251d"/><circle cx="15" cy="17" r="2.5" fill="#19251d"/>'), ui('Настройки'));
  const contactEmail = 'fablecontactarch@gmail.com';
  const contact = h('a', { class: 'account-menu-item', href: `mailto:${contactEmail}`, title: contactEmail },
    accountIcon('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>'), ui('Связаться с нами'));
  const logout = h('button', { class: 'account-menu-item', type: 'button', onclick: signOut },
    accountIcon('<path d="M10 4H5v16h5m4-13 5 5-5 5M8 12h11"/>'), ui('Выйти'));
  const menu = h('details', { class: 'account-menu' }, avatar,
    h('div', { class: 'account-popover', id: 'account-options' },
      h('p', { class: 'account-email' }, account.email),
      h('div', { class: 'account-menu-group' }, archive, friends, settings, contact, move, status),
      h('div', { class: 'account-menu-group' }, logout)));
  document.getElementById('account-link').replaceWith(menu);
  menu.addEventListener('toggle', async () => {
    if (!menu.open || checking || previous) return;
    checking = true;
    try {
      previous = await legacyDays();
      move.hidden = !previous.length;
      status.textContent = '';
    } catch (error) {
      setText(status, ui(error.message));
    } finally {
      checking = false;
    }
  });
  document.addEventListener('pointerdown', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener('focusout', event => {
    if (menu.open && event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (!menu.open || event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    menu.open = false;
    avatar.focus({ preventScroll: true });
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  return menu;
}

const accountMenu = account ? mountAccountMenu() : null;

// ---------- router ----------
async function route() {
  const version = ++routeVersion;
  const current = () => version === routeVersion;
  cleanups.forEach(f => { try { f(); } catch { /* */ } });
  cleanups = [];
  const hash = location.hash || '#/';
  if (accountMenu) accountMenu.open = hash === '#/account';
  window.scrollTo(0, 0);
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = a.getAttribute('href') === hash;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  try {
    if (hash === '#/account' && !account) view.replaceChildren(loginForm('#/'));
    else if ((hash === '#/friends' || hash.startsWith('#/friends/')) && !account) view.replaceChildren(loginForm(hash));
    else if (hash.startsWith('#/friends/join/')) {
      view.replaceChildren(invitationPage(hash.slice(15), name => {
        toast(ui('Теперь вы друзья с {name}.', { name }));
        location.hash = '#/friends';
      }));
    }
    else if (hash === '#/friends' || hash === '#/friends/feed') {
      view.replaceChildren(h('p', { class: 'wrap muted', role: 'status' }, ui('Открываю друзей…')));
      const friends = await listFriends();
      if (!current()) return;
      const page = hash.endsWith('/feed') ? await friendsFeed(friends) : friendsPage(friends);
      if (current()) view.replaceChildren(page);
    }
    else if (hash.startsWith('#/friends/day/')) await viewDay(hash.slice(14), current, true);
    else if (hash.startsWith('#/day/')) await viewDay(decodeURIComponent(hash.slice(6)), current);
    else if (hash === '#/new' && !account) view.replaceChildren(loginForm('#/new'));
    else if (hash === '#/new') await viewNew();
    else if (hash === '#/archive') await viewArchive(current);
    else await viewHome(current);
  } catch (e) {
    if (!current()) return;
    console.error(e);
    view.replaceChildren(h('section', { class: 'wrap' }, h('h1', { class: 'h1' }, ui('Что-то пошло не так')), h('p', { class: 'muted' }, ui(String(e.message || e))), h('a', { class: 'btn', href: '#/archive' }, ui('Вернуться в архив'))));
  }
}
window.addEventListener('hashchange', route);
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  view.focus();
});

const glassControls = '.btn, .gallery-arrow, .nav > a, .icon-btn, .weather-action, .thumb-x, button.linklike';
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
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.created - a.created;

function dayImage(day) {
  const photo = day.photos[0]?.blob || day.cover;
  if (!photo) return null;
  const url = URL.createObjectURL(photo);
  onCleanup(() => URL.revokeObjectURL(url));
  return url;
}

async function viewHome(current) {
  const days = await allDays();
  if (!current()) return;
  if (!days.length) return viewEmpty();
  const recent = days.sort(newestFirst).slice(0, 9).map(day => ({
    title: entryTitle(day), image: dayImage(day), date: uiDate(day.date), href: `#/day/${day.id}`,
  }));
  view.replaceChildren(homeStage(recent, h('a', { class: 'btn primary big', href: '#/new' }, ui('Записать день'))));
}

async function viewArchive(current) {
  const days = await allDays();
  if (!current()) return;
  days.sort(newestFirst);

  const entries = days.map(day => ({ day, comp: safeCompute(day), image: dayImage(day), date: uiDate(day.date) }));
  const comps = new Map(entries.map(({ day, comp }) => [day.id, comp]));
  const demoCount = new Set(days.map(day => exampleFor(day)?.date).filter(Boolean)).size;
  const status = h('p', { class: 'small muted', role: 'status', hidden: true });
  const demoButton = demoCount < DEMO_DAYS.length && h('button', { class: 'album-action', type: 'button', onclick: async () => {
    demoButton.disabled = true;
    status.hidden = false;
    try {
      await seedDemo((index, example) => setText(status, ui('Загружаю демо · {date}…', { date: uiDate(example.date) })));
      if (status.isConnected) route();
    } catch (error) {
      console.error(error);
      setText(status, ui('Демо не загрузилось. Попробуйте ещё раз.'));
    } finally { demoButton.disabled = false; }
  } }, ui('Загрузить демо'));
  const exportButton = days.length > 0 && h('button', { class: 'album-action', type: 'button',
    onclick: () => exportForSubmission(exportButton, days, comps) }, ui('Материалы для сдачи'));
  view.replaceChildren(archiveAlbum(entries, { status, demoButton, exportButton, onCleanup }));
}

// ---------- submission pack: every page, its back, the feed sheet and the list of folders ----------
async function exportForSubmission(btn, days, comps) {
  btn.disabled = true;
  try {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
    const files = [], covers = [];
    for (let i = 0; i < sorted.length; i++) {
      setText(btn, ui('Готовлю {current} из {total}…', { current: i + 1, total: sorted.length }));
      const stored = sorted[i]._record ? await getDay(sorted[i].id) : sorted[i];
      const d = await upgradeDemo(stored);
      const c = (d === stored && comps.get(d.id)) || computeDay(d), n = String(i + 1).padStart(2, '0');
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
    setText(btn, ui('Собираю ленту…'));
    files.push(['лента.jpg', await feedSheet(covers)]);
    files.push(['дни.md', new Blob([daysMarkdown(covers)], { type: 'text/markdown;charset=utf-8' })]);
    downloadBlob(await zipFiles('DayTrace — примеры дней/', files), 'DayTrace — примеры дней.zip');
    toast(ui('Скачан архив: {count} страниц, их обороты, лента и список папок', { count: sorted.length }));
  } catch (e) {
    console.error(e);
    toast(ui('Не получилось собрать материалы: {error}', { error: ui(e.message) }), 'error');
  }
  btn.disabled = false; setText(btn, ui('Материалы для сдачи'));
}

async function feedSheet(covers) {
  const cw = 360, ch = 640, gap = 32, top = 150, n = covers.length;
  const c = document.createElement('canvas');
  c.width = gap + n * (cw + gap); c.height = top + ch + 150;
  const x = c.getContext('2d');
  x.fillStyle = '#ece6db'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#1d1a17'; x.font = '600 48px ' + FONT; x.fillText('DayTrace — лента дней', gap, 78);
  x.font = '400 20px ' + FONT; x.fillStyle = 'rgba(29,26,23,.6)';
  x.fillText(`${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней'} · один дневник · у каждого дня своя «рука»`.toUpperCase(), gap, 116);
  for (let i = 0; i < n; i++) {
    const { d, c: comp, blob } = covers[i], px = gap + i * (cw + gap);
    const bmp = await createImageBitmap(blob);
    x.save(); x.shadowColor = 'rgba(40,30,20,.25)'; x.shadowBlur = 24; x.shadowOffsetY = 10;
    x.drawImage(bmp, px, top, cw, ch); x.restore();
    bmp.close?.();
    x.fillStyle = '#1d1a17'; x.font = '600 22px ' + FONT;
    const words = d.meta.title.split(' '); let line = '', ly = top + ch + 40;
    for (const w of words) { if (x.measureText(line + ' ' + w).width > cw && line) { x.fillText(line, px, ly); ly += 28; line = w; } else line = line ? line + ' ' + w : w; }
    x.fillText(line, px, ly);
    x.font = '400 15px ' + FONT; x.fillStyle = 'rgba(29,26,23,.6)';
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
  return `# DayTrace — примеры дней\n\nНазвания папок придуманы прототипом по тексту записи.\n\n| № | Дата | Папка | Техника | Песня | Музыка |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
}

function homeStage(items, ...actions) {
  const scene = scenery({ particles: false });
  const sync = animateScenery(scene, onCleanup);
  const weather = weatherControl(theme => {
    setScenery(scene, theme);
    sync();
  });
  return h('section', { class: 'landing', 'aria-labelledby': 'landing-title' }, scene,
    h('div', { class: 'landing-intro' },
      h('div', { class: 'landing-copy' },
        h('h1', { id: 'landing-title' }, ui('Как прошёл день?')),
        h('p', null, ui('Собери воспоминание из фото, заметки и песни.'))),
      h('div', { class: 'landing-actions' }, actions)),
    h('div', { class: 'landscape-panel' }, weather, memoryGallery(items)));
}

function viewEmpty() {
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const newBtn = h('a', { class: 'btn primary big', href: '#/new' }, ui('Записать день'));
  let busy = false;
  const openDemo = async index => {
    if (busy) return;
    busy = true;
    demoBtn.disabled = true;
    try {
      const days = await seedDemo(i => setText(status, ui('Собираю примеры · {current} из {total}…', {
        current: i + 1, total: DEMO_DAYS.length,
      })));
      if (!status.isConnected) return;
      if (index == null) route();
      else location.hash = `#/day/${days[index].id}`;
    } catch (error) {
      console.error(error);
      setText(status, ui('Не удалось собрать примеры. Попробуйте ещё раз.'));
    } finally { busy = false; demoBtn.disabled = false; }
  };
  const demoBtn = h('button', { class: 'btn big', type: 'button', onclick: () => openDemo() }, ui('Загрузить демо'));
  const examples = DEMO_DAYS.map((d, i) => ({
    title: ui(d.title), date: uiDate(d.date), image: `demo/photos/${d.photos[0]}.jpg`, action: () => openDemo(i),
  }));
  view.replaceChildren(homeStage(examples, newBtn, demoBtn), h('div', { class: 'landing-status' }, status));
}

// ---------- new day ----------
async function viewNew() {
  let photoFiles = [];
  const buildCancellation = new AbortController();
  onCleanup(() => buildCancellation.abort());
  const prepared = new WeakMap();
  function preparePhoto(file) {
    if (!prepared.has(file)) prepared.set(file, processPhoto(file).catch(error => {
      prepared.delete(file);
      throw error;
    }));
    return prepared.get(file);
  }
  const thumbs = h('div', { class: 'thumbs' });
  const urls = [];
  onCleanup(() => urls.forEach(u => URL.revokeObjectURL(u)));
  const err = {};
  const errEl = key => (err[key] = h('p', { class: 'field-error', id: `err-${key}`, hidden: true }));
  const showErr = (key, msg) => { setText(err[key], msg ? ui(msg) : ''); err[key].hidden = !msg; };
  const picker = photoTrackPicker(preparePhoto, song => {
    link.value = '';
    songFile.value = '';
    query.value = song.query;
    showErr('song', '');
  });
  onCleanup(picker.dispose);

  const renderThumbs = () => {
    urls.splice(0).forEach(url => URL.revokeObjectURL(url));
    thumbs.replaceChildren(...photoFiles.map((f, i) => {
      const u = URL.createObjectURL(f); urls.push(u);
      const number = i + 1;
      return h('div', { class: 'thumb' }, h('img', { src: u, alt: ui('Фото {number}', { number }) }),
        h('button', { type: 'button', class: 'thumb-x', 'aria-label': ui('Убрать фото {number}', { number }), title: ui('Убрать фото'), onclick: () => { photoFiles.splice(i, 1); renderThumbs(); } }, '×'));
    }));
    picker.refresh(photoFiles);
  };
  const addFiles = list => {
    const imgs = [...list].filter(f => f.type.startsWith('image/'));
    photoFiles = [...photoFiles, ...imgs].slice(0, 8);
    if (photoFiles.length) showErr('photos', '');
    renderThumbs();
  };

  const date = h('input', { type: 'date', id: 'f-date', value: todayISO(), max: todayISO() });
  const text = h('textarea', { id: 'f-text', rows: 7, 'aria-describedby': 'hint-text err-text', placeholder: ui('Например: гуляли по парку, всё в жёлтых листьях, было холодно, но мы пили какао и долго разговаривали…'), oninput: () => showErr('text', '') });
  const fileIn = h('input', {
    type: 'file', id: 'f-photos', accept: 'image/*', multiple: true, class: 'visually-hidden',
    onchange: event => { addFiles(event.target.files); event.target.value = ''; },
  });
  const drop = h('label', {
    class: 'drop', for: 'f-photos',
    ondragover: e => { e.preventDefault(); drop.classList.add('is-over'); },
    ondragleave: () => drop.classList.remove('is-over'),
    ondrop: e => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); },
  }, h('span', { class: 'drop-title' }, ui('Добавить фото')), h('span', { class: 'muted' }, ui('перетащите сюда или выберите файлы · до 8 снимков')));
  function editSong(event) {
    if (picker.selected && event.target !== query) query.value = '';
    picker.clearSelection();
    picker.stopPreview();
    showErr('song', '');
  }
  const link = h('input', { type: 'url', id: 'f-link', placeholder: 'https://open.spotify.com/track/…', oninput: editSong });
  const query = h('input', { type: 'text', id: 'f-query', placeholder: 'Frank Sinatra — Autumn Leaves', oninput: editSong });
  const songFile = h('input', { type: 'file', id: 'f-audio', accept: 'audio/*', onchange: editSong });
  link.addEventListener('change', async () => {
    if (query.value.trim()) return;
    const url = link.value;
    const t = await titleFromLink(url);
    if (t && link.value === url && !query.value.trim()) query.value = t;
  });
  const weatherOn = h('input', { type: 'checkbox', id: 'f-weather' });
  const city = h('input', { type: 'text', id: 'f-city', placeholder: ui('Астана'), value: getSetting('city', ''), disabled: true });
  const studioScene = scenery();
  const sceneCaption = h('p', { class: 'studio-season' });
  const weatherStatus = h('p', { class: 'hint weather-status', role: 'status' });
  let dayWeather = null, weatherRequest = 0;
  const refreshStudio = () => {
    const theme = atmosphere(date.value || todayISO(), dayWeather);
    setScenery(studioScene, theme);
    setText(sceneCaption, dayWeather ? weatherMessage(dayWeather) : ui(SEASON_RU[theme.season]));
  };
  const locate = h('button', { class: 'btn', type: 'button' }, ui('Определить по геолокации ↗'));
  const clearWeather = () => {
    weatherRequest++;
    dayWeather = null;
    locate.disabled = false;
    setText(locate, ui('Определить по геолокации ↗'));
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
    setText(weatherStatus, ui('Загружаю погоду за выбранную дату…'));
    try {
      const result = deviceCoordinates ? await fetchWeatherAt(deviceCoordinates, selectedDate) : await locateWeather(selectedDate);
      if (request !== weatherRequest) return;
      dayWeather = result;
      setText(weatherStatus, ui('Добавлено · {weather}', { weather: weatherMessage(result) }));
      setText(locate, ui('Обновить погоду ↗'));
      refreshStudio();
    } catch (error) {
      if (request === weatherRequest) setText(weatherStatus, ui('{error}. Можно указать город.', { error: ui(error.message) }));
    } finally { if (request === weatherRequest) locate.disabled = false; }
  };
  refreshStudio();

  const steps = h('ol', { class: 'steps', 'aria-live': 'polite' });
  const visibility = newDayVisibility();
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, ui('Собрать воспоминание'));

  const form = h('form', {
    class: 'form', novalidate: true,
    onsubmit: async e => {
      e.preventDefault();
      if (submit.disabled || locate.disabled) return;
      let ok = true;
      if (wordCount(text.value) < 3) { showErr('text', 'Напишите хотя бы пару предложений о дне — из слов система берёт свет и настроение.'); ok = false; }
      if (!photoFiles.length) { showErr('photos', 'Добавьте хотя бы одно фото этого дня.'); ok = false; }
      if (!ok) { form.querySelector('.field-error:not([hidden])')?.previousElementSibling?.focus?.(); return; }
      if (weatherOn.checked && city.value.trim()) setSetting('city', city.value.trim());
      picker.stopPreview();
      submit.disabled = true; setText(submit, ui('Собираю…'));
      const rows = {};
      steps.replaceChildren(...STEPS.map(([k, label]) => (rows[k] = h('li', { class: 'step' }, h('span', { class: 'step-dot' }), h('span', null, ui(label)), h('span', { class: 'step-note muted' })))));
      const step = (k, state, note = '') => { const r = rows[k]; r.className = 'step is-' + state; setText(r.querySelector('.step-note'), note); };
      try {
        const day = await buildDay({
          date: date.value || todayISO(), text: text.value.trim(), photoFiles,
          songLink: link.value.trim(), signal: buildCancellation.signal,
          songQuery: query.value.trim(), songFile: songFile.files[0] || null, photoSong: picker.selected,
          weatherCity: weatherOn.checked ? city.value.trim() : '',
          weather: dayWeather?.date === (date.value || todayISO()) ? dayWeather : null,
          visibility: visibility.value,
        }, step, preparePhoto);
        await sleep(400);
        if (form.isConnected) location.hash = `#/day/${day.id}`;
      } catch (ex) {
        if (buildCancellation.signal.aborted) return;
        console.error(ex);
        toast(ui('Не получилось собрать воспоминание: {error}. Попробуйте ещё раз.', { error: ui(ex.message) }), 'error');
        submit.disabled = false; setText(submit, ui('Собрать воспоминание'));
      }
    },
  },
    h('div', { class: 'field' }, h('label', { for: 'f-date' }, ui('Дата')), date),
    h('div', { class: 'field' },
      h('label', { for: 'f-text' }, ui('Как прошёл день?')),
      h('p', { class: 'hint', id: 'hint-text' }, ui('Пишите, как рассказали бы близкому другу: погода, свет, запахи, звуки, люди рядом, мелочи.')),
      text, errEl('text')),
    h('div', { class: 'field' }, h('span', { class: 'label-like' }, ui('Фото дня')), fileIn, drop, thumbs, errEl('photos')),
    h('fieldset', { class: 'field' },
      h('legend', null, ui('Песня дня')),
      h('label', { for: 'f-link', class: 'sub' }, ui('Ссылка на музыкальный сервис')), link,
      h('label', { for: 'f-query', class: 'sub' }, ui('Исполнитель — название')), query,
      h('p', { class: 'hint' }, ui('По названию находим официальный 30-секундный фрагмент и слушаем его: темп, тональность, энергию.')),
      picker.element,
      h('label', { for: 'f-audio', class: 'sub' }, ui('Или свой аудиофайл')), songFile, errEl('song')),
    h('fieldset', { class: 'field weather-field' },
      h('legend', null, ui('Погода дня')),
      h('p', { class: 'hint' }, ui('Open-Meteo получает округлённые координаты. Дневник сохраняет только сводку погоды.')),
      locate, weatherStatus,
      h('label', { class: 'check' }, weatherOn, h('span', null, ui('Указать город вручную'))),
      city),
    visibility.element,
    h('div', { class: 'row' }, submit, h('a', { class: 'btn ghost', href: '#/' }, ui('Отмена'))),
    steps);

  setUiAttribute(city, 'aria-label', ui('Город'));
  view.replaceChildren(h('section', { class: 'wrap studio' },
    h('aside', { class: 'studio-preview' }, studioScene, h('div', { class: 'studio-copy' },
      h('p', { class: 'label' }, ui('Атмосфера дня')), sceneCaption)),
    h('div', { class: 'studio-editor' }, h('h1', { class: 'h1' }, ui('Записать день')), form)));
}

// ---------- day view ----------
function photoViewer(photos) {
  if (!photos.length) return null;
  const urls = photos.map(photo => URL.createObjectURL(photo.blob));
  const photo = h('img', { class: 'photo-dialog-image', alt: '' });
  const counter = h('span', { class: 'small muted', 'aria-live': 'polite' });
  const savePhoto = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    const item = photos[index];
    savePhoto.disabled = true;
    try {
      const blob = item.original || (item.loadOriginal && await item.loadOriginal()) || item.blob;
      downloadBlob(blob, item.originalName || 'фото-' + (index + 1) + '.jpg');
    } catch (error) { toast(error.message, 'error'); }
    finally { savePhoto.disabled = false; }
  } }, ui('Скачать фото'));
  let index = 0;
  const select = (to) => {
    index = (to + urls.length) % urls.length;
    photo.src = urls[index];
    setUiAttribute(photo, 'alt', ui('Фото дня {number}', { number: index + 1 }));
    setText(counter, ui('{current} из {total}', { current: index + 1, total: urls.length }));
  };
  const dialog = h('dialog', { class: 'dialog photo-dialog', 'aria-label': ui('Фотографии дня') }, photo,
    h('div', { class: 'photo-dialog-controls' },
      urls.length > 1 ? h('button', { class: 'btn small', type: 'button', 'aria-label': ui('Предыдущее фото'), onclick: () => select(index - 1) }, '←') : null,
      urls.length > 1 && counter, savePhoto,
      urls.length > 1 ? h('button', { class: 'btn small', type: 'button', 'aria-label': ui('Следующее фото'), onclick: () => select(index + 1) }, '→') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => dialog.close() }, ui('Закрыть'))));
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
  return () => { select(0); dialog.showModal(); };
}

async function viewDay(id, current, readOnly = false) {
  const stored = await (readOnly ? cloudSharedDay(id) : getDay(id));
  if (!current()) return;
  if (!stored && readOnly) {
    view.replaceChildren(h('section', { class: 'wrap' }, h('h1', { class: 'h1' }, ui('Этот день недоступен')),
      h('a', { class: 'btn', href: '#/friends/feed' }, ui('Атмосфера друзей'))));
    return;
  }
  if (!stored) { location.hash = '#/archive'; return; }
  const day = readOnly ? stored : await upgradeDemo(stored);
  const list = readOnly ? [] : (await allDays()).sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  if (!current()) return;
  const idx = list.findIndex(d => d.id === id), prev = list[idx - 1], next = list[idx + 1];
  const title = entryTitle(day);
  let comp = computeDay(day);

  const canvas = h('canvas', { class: 'page', role: 'img', 'aria-label': ui('Воспоминание дня: {title}', { title }) });
  const back = h('canvas', { class: 'page-back', 'aria-hidden': 'true' });
  const flip = h('div', { class: 'flip', role: 'button', tabindex: '0', 'aria-label': ui('Перевернуть карточку'), 'aria-pressed': 'false' },
    h('div', { class: 'flip-inner' }, canvas, back));
  const stage = h('div', { class: 'stage' }, flip);
  const warmth = !readOnly && account && day._record &&
    h('section', { class: 'day-warmth', 'aria-labelledby': 'day-warmth-title', hidden: true });
  if (warmth) stage.append(warmth);
  const heading = h('header', { class: 'day-heading' },
    h('time', { class: 'day-date', datetime: day.date }, uiDate(day.date)),
    h('h1', { class: 'day-title', id: 'day-title' }, title));
  const reading = h('div', { class: 'day-reading' }, h('p', { class: 'entry' }, day.text));
  view.replaceChildren(h('article', { class: 'dayview', 'aria-labelledby': 'day-title' }, heading, stage, reading));

  const renderer = new PageRenderer(canvas);
  await renderer.load(day, comp);
  if (!current()) {
    renderer.dispose();
    return;
  }
  const openPhotos = readOnly ? null : photoViewer(day.photos);
  const sound = getSound();
  let playing = false, speaking = false, recording = false, t0 = performance.now(), buf = null, lastVideo = null;
  const audioWork = new AbortController();
  onCleanup(() => audioWork.abort());
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
  const voiceBtn = h('button', { class: 'day-menu-item', type: 'button' }, ui('Озвучить запись'));
  const songNote = h('p', { class: 'note muted', role: 'status' });
  const updatePlay = () => setText(playBtn, ui(playing ? '■ Остановить' : '▶ Слушать день'));
  updatePlay();

  async function start() {
    if (playBtn.disabled) return false;
    const { signal } = audioWork;
    playBtn.disabled = true;
    setText(songNote, ui('Загружаю музыку…'));
    try {
      await sound.resume();
      if (!buf) {
        try { buf = await loadSongBuffer(day.song || {}, signal); }
        catch (error) { if (day.song?.fileBlob) throw error; }
      }
      signal.throwIfAborted();
      if (!buf) {
        if (readOnly) {
          sound.stopAll();
          sound.startSketch(day.inputs.music, renderer.D);
          sound.startAmbient(day.meta.ambient);
          playing = true;
          updatePlay();
          setText(songNote, ui('Фрагмент недоступен. Звучит эскиз в том же темпе.'));
          return true;
        }
        setText(songNote, ui('Ищу доступную музыку по фото…'));
        const { song, music } = await findMusicForPhotos(aggregatePhotos(day.photos), signal);
        const originalLink = day.song?.originalLink || (!day.song?.autoPicked && (day.song?.link || day.song?.meta?.trackViewUrl));
        const originalTitle = day.song?.originalTitle || (!day.song?.autoPicked && (day.song?.meta?.title || day.song?.query));
        if (/^https?:\/\//i.test(originalLink) && originalLink !== song.link) song.originalLink = originalLink;
        if (originalTitle && originalTitle !== song.meta.title) song.originalTitle = originalTitle;
        clearTimeout(saveTimer);
        await pendingMoodSave;
        const updated = { ...day, song, inputs: { ...day.inputs, music } };
        const computed = computeDay(updated);
        updated.cover = await renderCover(updated, computed);
        updated.coverVer = COVER_VER;
        signal.throwIfAborted();
        await putDay(updated);
        signal.throwIfAborted();
        Object.assign(day, updated);
        comp = computed;
        renderer.setComputed(comp);
        drawBackPage(back, day, comp);
        lastVideo = null;
        recNote.textContent = '';
        renderInfo();
        buf = await loadSongBuffer(day.song, signal);
      }
      signal.throwIfAborted();
      const offset = clamp(day.inputs.music.segStart || 0, 0, Math.max(0, buf.duration - 1));
      sound.stopAll();
      sound.playSong(buf, offset, Math.min(renderer.D, buf.duration - offset));
      sound.startAmbient(day.meta.ambient);
      playing = true;
      updatePlay();
      setText(songNote, '');
      return true;
    } catch (error) {
      if (!signal.aborted) setText(songNote, ui(day.song?.fileBlob ? 'Не удалось открыть ваш аудиофайл.' :
        error.name === 'TimeoutError' ? 'Поиск музыки занял слишком много времени. Попробуйте ещё раз.' : error.message));
      return false;
    } finally { playBtn.disabled = false; }
  }
  function stop() { sound.stopAll(); stopSpeaking(); speaking = false; setText(voiceBtn, ui('Озвучить запись')); playing = false; t0 = performance.now(); updatePlay(); setText(songNote, ''); }
  playBtn.addEventListener('click', () => (playing ? stop() : start()));

  voiceBtn.addEventListener('click', async () => {
    if (speaking) { stopSpeaking(); speaking = false; sound.duck(false); setText(voiceBtn, ui('Озвучить запись')); return; }
    const pv = await pickVoice(comp.voice);
    if (!playing) await start();
    speaking = speak(day.text, comp.voice, pv.voice, {
      onstart: () => sound.duck(true),
      onend: () => { sound.duck(false); speaking = false; setText(voiceBtn, ui('Озвучить запись')); },
    });
    if (speaking) {
      setText(voiceBtn, ui('■ Остановить голос'));
    } else toast(ui('Синтез речи недоступен в этом браузере'));
  });

  flip.addEventListener('click', () => {
    const backVisible = flip.classList.toggle('is-flipped');
    flip.setAttribute('aria-pressed', String(backVisible));
    if (!warmth) return;
    warmth.hidden = true;
    if (backVisible) loadWarmth(day._record.id, warmth).then(hasHeat => {
      if (current() && flip.classList.contains('is-flipped')) warmth.hidden = !hasHeat;
    }).catch(() => {});
  });
  flip.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    flip.click();
  });
  drawBackPage(back, day, comp);

  // mood pad
  const dot = h('div', { class: 'pad-dot' });
  const pad = h('div', { class: 'pad', role: 'slider', tabindex: '0', 'aria-label': ui('Поправить настроение. Влево — тяжелее, вправо — приятнее, вверх — интенсивнее, вниз — спокойнее.') },
    h('span', { class: 'pad-l pad-left' }, ui('тяжело')), h('span', { class: 'pad-l pad-right' }, ui('приятно')),
    h('span', { class: 'pad-l pad-top' }, ui('интенсивно')), h('span', { class: 'pad-l pad-bottom' }, ui('спокойно')), dot);
  const placeDot = () => {
    dot.style.left = ((comp.mood.V + 1) / 2) * 100 + '%'; dot.style.top = (1 - comp.mood.E) * 100 + '%';
    setUiAttribute(pad, 'aria-valuetext', ui('приятность {valence}, энергия {energy}', {
      valence: comp.mood.V.toFixed(2), energy: comp.mood.E.toFixed(2),
    }));
  };
  let saveTimer = 0, pendingMoodSave = Promise.resolve();
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      pendingMoodSave = pendingMoodSave.then(async () => {
        day.cover = await renderCover(day, comp);
        day.coverVer = COVER_VER;
        await putDay(day);
      }).catch(error => toast(ui('Изменения не сохранены. {error}', { error: ui(error.message) }), 'error'));
    }, 900);
  };
  const applyOverride = o => {
    if (playBtn.disabled) return;
    day.override = o;
    comp = computeDay(day);
    renderer.setComputed(comp);
    drawBackPage(back, day, comp);
    renderInfo();
    scheduleSave();
  };
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
  const resetBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => applyOverride(null) }, ui('Вернуть как прочитала система'));

  // folder + video
  const folderBtn = h('button', { class: 'day-menu-item', type: 'button' }, ui(canUseFolders() ? 'Сохранить папку дня' : 'Скачать папку дня (ZIP)'));
  const recBtn = h('button', { class: 'day-menu-item', type: 'button' }, ui('Записать видео 30 с'));
  const recNote = h('p', { class: 'note muted', 'aria-live': 'polite' });
  async function saveFolder() {
    folderBtn.disabled = true;
    try {
      const cover = await renderer.poster(PW);
      const res = await saveToFolder(day, comp, { cover, video: lastVideo });
      toast(res.mode === 'folder'
        ? ui('Сохранено в «{path}» — {count} файлов', { path: `${res.root}/${res.name}`, count: res.files.length })
        : ui('Скачан ZIP с папкой дня'));
    } catch (e) { if (e.name !== 'AbortError') toast(ui('Не удалось сохранить папку: {error}', { error: ui(e.message) }), 'error'); }
    folderBtn.disabled = false;
  }
  folderBtn.addEventListener('click', saveFolder);
  recBtn.addEventListener('click', async () => {
    if (recording || playBtn.disabled) return;
    if (!('MediaRecorder' in window) || !canvas.captureStream) { toast(ui('Запись видео не поддерживается в этом браузере'), 'error'); return; }
    recording = true; recBtn.disabled = true;
    stop();
    if (!await start()) {
      recording = false;
      recBtn.disabled = false;
      return;
    }
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
    const tick = setInterval(() => {
      const seconds = Math.max(0, Math.ceil(D - (performance.now() - began) / 1000));
      setText(recNote, ui('Идёт запись… {seconds} с. Не переключайте вкладку.', { seconds }));
    }, 250);
    await sleep(D * 1000 + 150);
    rec.stop(); await done; clearInterval(tick);
    lastVideo = new Blob(chunks, { type: 'video/webm' });
    recording = false; recBtn.disabled = false;
    recNote.replaceChildren(uiTextNode(ui('Видео готово. ')),
      h('button', { class: 'linklike', type: 'button', onclick: () => downloadBlob(lastVideo, safeName(day.meta.title) + '.webm') }, ui('Скачать .webm')));
  });

  const delBtn = h('button', {
    class: 'day-menu-item day-menu-danger', type: 'button', onclick: async () => {
      if (!confirm(translate('Удалить день «{title}» из дневника? Это нельзя отменить.', { title }))) return;
      try {
        await deleteDay(day.id); toast(ui('День «{title}» удалён', { title })); location.hash = '#/archive';
      } catch (error) { toast(ui(error.message), 'error'); }
    },
  }, ui('Удалить день'));

  const why = h('div', { class: 'why-panel' });
  const design = h('section', { class: 'day-design', id: 'day-design', 'aria-labelledby': 'day-design-title', tabindex: '-1', hidden: true },
    h('div', { class: 'day-design-heading' },
      h('h2', { class: 'h2', id: 'day-design-title' }, ui('Поправить настроение')),
      h('button', { class: 'btn small', type: 'button', onclick: () => { showDesign(false); moreSummary.focus(); } }, ui('Закрыть'))),
    h('p', { class: 'muted small' }, ui('Если система прочитала день не так — передвиньте точку, страница перерисуется сразу.')),
    pad, resetBtn,
    h('details', { class: 'day-why' }, h('summary', null, ui('Почему так')), why));
  const designBtn = h('button', {
    class: 'day-menu-item', type: 'button', 'aria-controls': 'day-design', 'aria-expanded': 'false',
    onclick: () => showDesign(design.hidden),
  }, ui('Оформление'));
  const songCaption = h('p', { class: 'day-track' });
  const musicCredits = h('div', { class: 'day-menu-credits', hidden: true });
  const visibility = !readOnly && account && day._record && visibilityPicker(day.visibility, async event => {
    const select = event.target;
    select.disabled = true;
    try {
      await cloudSetVisibility(day, select.value);
      toast(ui('Видимость обновлена.'));
    } catch (error) {
      select.value = day.visibility;
      toast(ui(error.message), 'error');
    } finally {
      select.disabled = false;
    }
  });
  const moreSummary = h('summary', { class: 'btn day-more-trigger', 'aria-label': ui('Ещё') }, '⋯');
  const menu = h('div', { class: 'day-menu-panel' },
    voiceBtn,
    openPhotos && h('button', { class: 'day-menu-item', type: 'button', onclick: openPhotos }, ui('Фотографии дня')),
    designBtn, folderBtn, recBtn,
    (prev || next) && h('nav', { class: 'day-menu-neighbors', 'aria-label': ui('Соседние дни') },
      prev && h('a', { class: 'day-menu-item', href: `#/day/${prev.id}`, title: entryTitle(prev) }, ui('‹ Раньше')),
      next && h('a', { class: 'day-menu-item', href: `#/day/${next.id}`, title: entryTitle(next) }, ui('Позже ›'))),
    visibility && visibility.label, musicCredits, delBtn);
  const more = h('details', { class: 'day-more' }, moreSummary, menu);
  heading.append(h('div', { class: 'day-actions' }, playBtn,
    readOnly ? h('a', { class: 'btn', href: '#/friends/feed' }, ui('Атмосфера друзей')) : more),
  songCaption, songNote, recNote);
  if (!readOnly) reading.append(design);

  function showDesign(open) {
    design.hidden = !open;
    designBtn.setAttribute('aria-expanded', String(open));
    if (open) design.focus();
  }
  function closeMore(restoreFocus = false) {
    more.open = false;
    if (restoreFocus) moreSummary.focus({ preventScroll: true });
  }
  menu.addEventListener('click', event => {
    if (event.target.closest('button, a')) closeMore(true);
  }, true);
  const onOutsideMenu = event => {
    if (more.open && !more.contains(event.target)) closeMore();
  };
  document.addEventListener('pointerdown', onOutsideMenu);
  onCleanup(() => document.removeEventListener('pointerdown', onOutsideMenu));

  function renderInfo() {
    const { song } = day;
    const meta = song?.meta || {};
    const track = [meta.artist, meta.title || song?.query].filter(Boolean).join(' — ');
    const source = song?.link || meta.trackViewUrl;
    songCaption.replaceChildren(/^https?:\/\//i.test(source)
      ? h('a', { href: source, target: '_blank', rel: 'noopener' }, track)
      : track);
    musicCredits.replaceChildren(
      ...[
        meta.licenseUrl ? h('a', { class: 'day-menu-item', href: meta.licenseUrl, target: '_blank', rel: 'noopener' }, meta.license)
          : meta.license ? h('p', { class: 'note muted' }, meta.license) : null,
        /^https?:\/\//i.test(song?.originalLink)
          ? h('a', { class: 'day-menu-item', href: song.originalLink, target: '_blank', rel: 'noopener' }, ui('Ранее выбранная песня ↗'))
          : song?.originalTitle ? h('p', { class: 'note muted' }, ui('Ранее выбрано · {title}', { title: song.originalTitle })) : null,
      ].filter(Boolean));
    musicCredits.hidden = !musicCredits.childElementCount;
    why.replaceChildren(...whyContent());
    placeDot();
  }

  function whyContent() {
    const W = comp.weights, st = comp.style, env = day.inputs.music.envelope || [];
    const out = [
      h('h2', { class: 'h2' }, ui('Почему день выглядит так')),
      h('ol', { class: 'why' }, comp.recipe.map(r => h('li', null, h('span', { class: 'why-src' }, r.src), h('span', { class: 'why-sig' }, r.sig), h('span', { class: 'why-rule' }, r.rule)))),
      h('h3', { class: 'h3' }, ui('Смесь техник')),
      h('div', { class: 'bars' }, TECH_ORDER.map(k => h('div', { class: 'bar-row' + (k === comp.primary ? ' is-primary' : '') },
        h('span', { class: 'bar-label' }, ui(TECH[k].name), h('small', null, ui(TECH[k].ref))),
        h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: Math.max(1, W[k] * 100) + '%' } })),
        h('span', { class: 'bar-val' }, Math.round(W[k] * 100) + '%')))),
      h('h3', { class: 'h3' }, ui('Палитра дня')),
      h('div', { class: 'swatches' }, [...st.palette, ...st.accents].map(c => h('span', { class: 'sw', style: { background: rgbHex(c) }, title: rgbHex(c) }))),
    ];
    if (env.length) {
      const pts = env.map((v, i) => `${(i / (env.length - 1)) * 300},${40 - v * 36}`).join(' ');
      const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 42" class="spark" role="img"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`, 'image/svg+xml').documentElement;
      setUiAttribute(svg, 'aria-label', ui('Громкость песни во времени'));
      out.push(h('h3', { class: 'h3' }, ui('Энергия фрагмента')), svg);
    }
    out.push(h('p', { class: 'muted small' }, ui('Печать дня в углу страницы: четыре дуги — приятность (цветная), энергия, тепло, люди; в центре — время суток.')));
    return out;
  }

  renderInfo();

  const onKey = e => {
    if (e.key === 'Escape' && more.open) { closeMore(true); return; }
    if (e.key === 'Escape' && !design.hidden) { showDesign(false); moreSummary.focus(); return; }
    if (e.target.closest('input, textarea, select, button, a, summary, [role=slider], [role=button]')) return;
    if (e.key === ' ') { e.preventDefault(); playing ? stop() : start(); }
    else if (e.key === 'ArrowLeft' && prev) location.hash = `#/day/${prev.id}`;
    else if (e.key === 'ArrowRight' && next) location.hash = `#/day/${next.id}`;
    else if (e.key === 'Escape') location.hash = readOnly ? '#/friends/feed' : '#/archive';
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

renewSession().then(route).catch(error => {
  view.replaceChildren(h('section', { class: 'wrap' }, h('p', { role: 'alert' }, ui(error.message)),
    h('button', { class: 'btn', onclick: () => location.reload() }, ui('Попробовать снова')),
    h('button', { class: 'btn', onclick: signOut }, ui('Выйти'))));
});
