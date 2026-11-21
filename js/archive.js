import { h, plural, TIME_RU, SEASON_RU } from './util.js';
import { TECH, TECH_ORDER } from './mood.js';

const daysPerSpread = 4;
const shortDate = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('ru', { month: 'long', timeZone: 'UTC' });
const monthDate = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const moods = {
  bright: 'Радость', quiet: 'Спокойствие', nostalgia: 'Ностальгия',
  blue: 'Грусть', tense: 'Напряжение', lively: 'Драйв',
};

function moodOf(mood) {
  if (!mood) return '';
  if (mood.T > .48) return 'tense';
  if (mood.V < -.18) return 'blue';
  if (mood.E > .59) return 'lively';
  if (mood.N > .28) return 'nostalgia';
  if (mood.V > .24) return 'bright';
  return 'quiet';
}

const monthLabel = date => monthDate.format(new Date(date.slice(0, 7) + '-01')).replace(/\s*г\.$/, '');

function dateRange(entries) {
  const [start, end] = [entries[0].day.date, entries.at(-1).day.date].sort();
  if (start.slice(0, 7) === end.slice(0, 7)) return monthLabel(end);
  const from = start.slice(0, 4) === end.slice(0, 4) ? monthName.format(new Date(start)) : monthLabel(start);
  return `${from} — ${monthLabel(end)}`;
}

function print(entry, featured = false) {
  const { day, image, mood, date } = entry;
  return h('a', {
    class: 'album-print' + (featured ? ' album-print-featured' : ''), href: `#/day/${day.id}`,
    'aria-label': `${day.meta.title}, ${date}`,
  },
  h('div', { class: 'album-photo' },
    image && h('img', { src: image, alt: '', loading: 'lazy', decoding: 'async' })),
  h('div', { class: 'album-caption' },
    h('div', { class: 'album-meta' },
      h('time', { datetime: day.date }, shortDate.format(new Date(day.date))),
      mood && h('span', { class: 'album-mood', 'data-mood': mood }, moods[mood])),
    h('h4', null, day.meta.title)),
  h('span', { class: 'album-open', 'aria-hidden': 'true' }, '↗'));
}

function openAlbum(book, spread, onFinish) {
  const singlePage = matchMedia('(max-width: 560px)').matches;
  const state = singlePage ? 'album-opening-mobile' : 'album-opening';
  const cover = h('div', { class: 'album-opening-cover', 'aria-hidden': 'true' },
    h('img', { src: 'brand.svg', alt: '', width: 64, height: 64 }),
    h('span', null, 'DayTrace'));
  const leaf = spread.firstElementChild;
  const sheet = singlePage ? cover : h('div', { class: 'album-opening-sheet' }, leaf, cover);
  if (singlePage) spread.after(cover);
  else spread.prepend(sheet);
  spread.inert = true;
  book.classList.add(state);
  const duration = singlePage ? 540 : 880;
  book.style.setProperty('--album-opening-time', `${duration}ms`);
  const animation = sheet.animate(
    singlePage ? [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-96deg)' }]
      : [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }],
    { duration, easing: 'cubic-bezier(.33, .09, .24, 1)', fill: 'both' });
  const finish = () => {
    if (singlePage) cover.remove();
    else sheet.replaceWith(leaf);
    book.classList.remove(state);
    book.style.removeProperty('--album-opening-time');
    spread.inert = false;
    onFinish(animation);
  };
  animation.finished.then(finish, finish);
  return animation;
}

function flipSpread(stage, spread, direction, onFinish) {
  const current = stage.firstElementChild;
  const singlePage = matchMedia('(max-width: 560px)').matches;
  const forward = direction > 0;
  const moving = forward ? 1 : 0;
  const resting = 1 - moving;
  const front = (singlePage ? current : current.children[moving]).cloneNode(true);
  const back = singlePage ? null : spread.children[resting].cloneNode(true);
  const still = singlePage ? null : current.children[resting].cloneNode(true);
  still?.classList.add('album-stationary');
  const sheet = h('div', { class: 'album-sheet' },
    h('div', { class: 'album-sheet-face' }, front),
    back && h('div', { class: 'album-sheet-face album-sheet-back' }, back));
  const layer = h('div', {
    class: 'album-turn-layer' + (singlePage ? ' album-turn-single' : ''),
    'data-turn': forward ? 'forward' : 'backward', 'aria-hidden': 'true', inert: true,
  }, still, sheet);
  const oldHeight = current.getBoundingClientRect().height;
  spread.inert = true;
  stage.replaceChildren(spread, layer);
  spread.style.minHeight = `${Math.max(oldHeight, spread.getBoundingClientRect().height)}px`;
  for (const image of stage.querySelectorAll('img[loading="lazy"]')) image.loading = 'eager';
  const angle = (forward ? -1 : 1) * (singlePage ? 96 : 180);
  const duration = singlePage ? 480 : 700;
  layer.style.setProperty('--album-turn-time', `${duration}ms`);
  const animation = sheet.animate(
    [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${angle}deg)` }],
    { duration, easing: 'cubic-bezier(.5, .1, .26, 1)' });
  const finish = () => {
    layer.remove();
    spread.inert = false;
    spread.style.removeProperty('min-height');
    onFinish(animation);
  };
  animation.finished.then(finish, finish);
  return animation;
}

export function archiveAlbum(source, { status, demoButton, exportButton }) {
  const entries = source.map(entry => {
    const { day, comp, date } = entry;
    const tech = comp?.primary || '';
    const light = comp?.mood.light || '';
    const mood = moodOf(comp?.mood);
    const haystack = [
      day.meta.title, day.text, day.song?.meta?.artist, day.song?.meta?.title, day.date, date,
      TECH[tech]?.name, TIME_RU[light], SEASON_RU[day.inputs.text.season], moods[mood],
    ].join(' ').toLocaleLowerCase('ru');
    return { ...entry, tech, light, mood, month: day.date.slice(0, 7), haystack };
  });
  const filters = { query: '', month: '', mood: '', tech: '', light: '' };
  let spreadIndex = 0;
  let newest = true;
  let turn = null;
  const stage = h('div', { class: 'album-stage' });
  const book = h('div', { class: 'album-book' }, stage);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pageCount = h('span');
  const position = h('span', { class: 'album-position', 'aria-live': 'polite' },
    h('span', { class: 'album-position-label' }, 'Разворот '), pageCount);
  const prev = h('button', {
    type: 'button', class: 'album-turn', 'aria-label': 'Предыдущий разворот',
    onclick: () => go(-1),
  }, '←');
  const next = h('button', {
    type: 'button', class: 'album-turn', 'aria-label': 'Следующий разворот',
    onclick: () => go(1),
  }, '→');
  const pagination = h('div', { class: 'album-pagination' }, prev, position, next);

  function refresh() {
    turn?.cancel();
    turn = null;
    spreadIndex = 0;
    render();
  }

  function go(direction) {
    if (turn) return;
    spreadIndex += direction;
    render(direction);
  }

  function finishTurn(animation) {
    if (turn === animation) turn = null;
  }

  function render(direction = 0, opening = false) {
    const ordered = newest ? entries : [...entries].reverse();
    const matches = ordered.filter(item =>
      item.haystack.includes(filters.query) &&
      ['month', 'mood', 'tech', 'light'].every(key => !filters[key] || item[key] === filters[key]));
    const spreadCount = Math.ceil(matches.length / daysPerSpread);
    pagination.hidden = spreadCount <= 1;
    if (!spreadCount) {
      stage.replaceChildren(h('div', { class: 'album-blank', role: 'status' },
        h('h3', null, entries.length ? 'Записи не найдены' : 'Альбом пока пуст'),
        h('p', null, entries.length ? 'Попробуй изменить запрос или фильтры.' : 'Добавь первый день или открой примеры.'),
        !entries.length && h('div', { class: 'album-blank-actions' },
          h('a', { class: 'album-home-link', href: '#/' }, 'На главную'), demoButton)));
      return;
    }
    const items = matches.slice(spreadIndex * daysPerSpread, (spreadIndex + 1) * daysPerSpread);
    const [main, ...rest] = items;
    const excerpt = (main.day.meta.caption || main.day.text || '').trim();
    const spread = h('div', { class: 'album-spread' },
      h('div', { class: 'album-leaf album-lead' },
        h('h3', { class: 'album-period' }, dateRange(items)), print(main, true)),
      h('div', { class: 'album-leaf album-index-page' },
        rest.length ? rest.map(item => print(item)) :
          h('div', { class: 'album-note' },
            excerpt && h('blockquote', null, excerpt),
            main.day.song?.meta?.title && h('p', null,
              [main.day.song.meta.artist, main.day.song.meta.title].filter(Boolean).join(' — ')))));
    const animate = !reducedMotion.matches && typeof spread.animate === 'function';
    if (direction && animate) {
      turn = flipSpread(stage, spread, direction, finishTurn);
    } else {
      stage.replaceChildren(spread);
      if (opening && animate) turn = openAlbum(book, spread, finishTurn);
    }
    pageCount.textContent = `${spreadIndex + 1} из ${spreadCount}`;
    prev.disabled = spreadIndex === 0;
    next.disabled = spreadIndex === spreadCount - 1;
  }

  function choices(key, legend, values, display) {
    if (!values.length) return null;
    const buttons = ['', ...values].map(value => h('button', {
      class: 'album-chip', type: 'button', value, 'data-mood': key === 'mood' && value ? value : null,
      'aria-pressed': String(!value), onclick: () => {
        filters[key] = filters[key] === value ? '' : value;
        buttons.forEach(button => button.setAttribute('aria-pressed', String(button.value === filters[key])));
        refresh();
      },
    }, value ? display(value) : 'Все'));
    return h('fieldset', { class: 'album-filter-group' }, h('legend', null, legend), h('div', null, buttons));
  }

  const months = [...new Set(entries.map(item => item.month))];
  const avail = (key, values) => values.filter(value => entries.some(item => item[key] === value));
  const title = h('h1', { class: 'album-title', id: 'archive-title' }, 'Архив');
  const search = h('input', {
    type: 'search', 'aria-label': 'Поиск по дневнику', placeholder: 'Поиск по дневнику',
    disabled: !entries.length, oninput: event => {
      filters.query = event.target.value.trim().toLocaleLowerCase('ru');
      refresh();
    },
  });
  const month = h('select', { 'aria-label': 'Период', disabled: !entries.length, onchange: event => {
    filters.month = event.target.value;
    refresh();
  } }, h('option', { value: '' }, 'Все месяцы'),
  months.map(value => h('option', { value }, monthLabel(value))));
  const tech = choices('tech', 'Техника', avail('tech', TECH_ORDER), value => TECH[value].name);
  const light = choices('light', 'Время суток', avail('light', Object.keys(TIME_RU)), value => TIME_RU[value]);
  const sidebar = h('aside', { class: 'album-sidebar', 'aria-label': 'Поиск и фильтры архива' },
    title, h('p', { class: 'album-count' }, `${entries.length} ${plural(entries.length, 'запись', 'записи', 'записей')}`),
    h('div', { class: 'album-fields' },
      h('label', { class: 'album-search' }, h('span', { 'aria-hidden': 'true' }), search),
      h('label', { class: 'album-select' }, month)),
    choices('mood', 'Настроение', avail('mood', Object.keys(moods)), key => moods[key]),
    (tech || light) && h('details', { class: 'album-filters' }, h('summary', null, 'Другие фильтры'), tech, light));
  const sort = h('select', { 'aria-label': 'Порядок записей', onchange: event => {
    newest = event.target.value === 'recent';
    refresh();
  } }, h('option', { value: 'recent' }, 'Сначала новые'), h('option', { value: 'older' }, 'Сначала старые'));
  const actions = h('details', { class: 'album-actions' },
    h('summary', { 'aria-label': 'Действия с архивом' }, '···'),
    h('div', { class: 'album-action-menu' }, demoButton, exportButton));
  const section = h('section', { class: 'archive-list', 'aria-labelledby': title.id }, sidebar,
    h('div', { class: 'album-main' },
      entries.length > 0 && h('div', { class: 'album-toolbar' }, pagination,
        h('div', { class: 'album-options' }, h('label', { class: 'album-select' }, sort), actions)),
      status, book));
  section.addEventListener('pointerdown', event => {
    if (actions.open && !actions.contains(event.target)) actions.open = false;
  });
  actions.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    actions.open = false;
    actions.querySelector('summary').focus();
  });
  render(0, true);
  return section;
}
