import { aggregatePhotos } from './photo.js';
import { suggestMusicForPhotos } from './music.js';
import { setAttribute, setText, ui } from './i18n.js';
import { h } from './util.js';

export function photoTrackPicker(preparePhoto, onSelect) {
  const status = h('p', { class: 'hint', role: 'status' }, ui('Добавьте фото, чтобы увидеть подборку.'));
  const previewError = h('p', { class: 'field-error', role: 'status', hidden: true });
  const list = h('ul', { class: 'photo-track-list', hidden: true });
  const source = h('p', { class: 'hint photo-track-source', hidden: true },
    ui('Фрагменты по 30 секунд'), ' · ',
    h('a', { href: 'https://incompetech.com/music/royalty-free/music.html', target: '_blank', rel: 'noopener' }, 'Incompetech'),
    ' · ', h('a', { href: 'https://creativecommons.org/licenses/by/4.0/', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'));
  const element = h('section', { class: 'photo-track-picker', 'aria-labelledby': 'photo-tracks-title' },
    h('h2', { id: 'photo-tracks-title' }, ui('Подборка по фото')), status, list, previewError, source);
  const audio = new Audio();
  let revision = 0;
  let selected = null;
  let active = null;
  let rows = [];

  function updateSelection() {
    for (const row of rows) {
      const chosen = row.song.meta.previewUrl === selected?.meta.previewUrl;
      row.select.setAttribute('aria-pressed', String(chosen));
      setText(row.action, ui(chosen ? 'Выбрано' : 'Выбрать'));
    }
  }

  function showPlayback(row, playing) {
    row.play.setAttribute('aria-pressed', String(playing));
    setText(row.icon, playing ? 'Ⅱ' : '▶');
    setAttribute(row.play, 'aria-label', ui(playing ? 'Остановить фрагмент «{title}»' : 'Послушать фрагмент «{title}»',
      { title: row.song.meta.title }));
  }

  function stopPreview() {
    if (!active) return;
    const { row } = active;
    active = null;
    audio.pause();
    showPlayback(row, false);
  }
  audio.addEventListener('ended', stopPreview);

  async function togglePreview(row) {
    const wasActive = active?.row === row;
    stopPreview();
    if (wasActive) return;
    previewError.hidden = true;
    const playback = { row };
    active = playback;
    showPlayback(row, true);
    try {
      audio.src = row.song.meta.previewUrl;
      await audio.play();
    } catch {
      if (active !== playback) return;
      stopPreview();
      setText(previewError, ui('Не удалось воспроизвести фрагмент. Попробуйте другой трек.'));
      previewError.hidden = false;
    }
  }

  function trackRow(song) {
    const icon = h('span', { 'aria-hidden': 'true' });
    const play = h('button', { class: 'btn small photo-track-play', type: 'button', onclick: () => togglePreview(row) }, icon);
    const action = h('span', { class: 'photo-track-action' });
    const select = h('button', { class: 'photo-track-select', type: 'button', onclick: () => {
      selected = song;
      updateSelection();
      onSelect(song);
    } },
    h('span', { class: 'photo-track-copy' }, h('strong', null, song.meta.title), h('small', null, song.meta.artist)),
    action);
    const row = { song, play, icon, select, action, element: h('li', { class: 'photo-track' }, play, select) };
    showPlayback(row, false);
    return row;
  }

  async function refresh(files) {
    const request = ++revision;
    stopPreview();
    previewError.hidden = true;
    rows = [];
    list.replaceChildren();
    list.hidden = true;
    source.hidden = true;
    setText(status, ui(files.length ? 'Подбираю музыку по фото…' : 'Добавьте фото, чтобы увидеть подборку.'));
    if (!files.length) return;
    const results = await Promise.allSettled(files.map(preparePhoto));
    if (request !== revision) return;
    const photos = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!photos.length) {
      setText(status, ui('Для подбора нужен хотя бы один снимок, который удалось открыть.'));
      return;
    }
    const suggestions = suggestMusicForPhotos(aggregatePhotos(photos));
    rows = suggestions.map(trackRow);
    updateSelection();
    list.replaceChildren(...rows.map(row => row.element));
    list.hidden = false;
    source.hidden = false;
    setText(status, ui(suggestions[0].reason));
  }

  return {
    element, refresh, stopPreview,
    get selected() { return selected; },
    clearSelection() { selected = null; updateSelection(); },
    dispose() {
      revision++;
      stopPreview();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
