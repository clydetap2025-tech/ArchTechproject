import { request } from './account.js';
import { cloudLatestDay } from './cloud-days.js';
import { makeFingerprint } from './day-sharing.js';
import { computeDay } from './mood.js';
import { aggregatePhotos } from './photo.js';
import { suggestMusicForPhotos } from './music.js';
import { isPhotoTrack, photoTrack } from './photo-tracks.js';
import { h } from './util.js';
import { setText, ui } from './i18n.js';

const isColor = value => /^#[a-f0-9]{6}$/i.test(value);
const heatPath = id => 'daytrace/heat/' + id;

export function warmthButton(dayId) {
  const status = h('p', { class: 'small muted', role: 'status' });
  const opener = h('button', { type: 'button', class: 'btn small', 'aria-haspopup': 'dialog',
    onclick: () => openWarmth(dayId, opener, status),
  }, ui('Отправить тепло'));
  return h('div', { class: 'friend-warmth' }, opener, status);
}

async function openWarmth(dayId, opener, status) {
  const content = h('div', { class: 'heat-options' });
  const error = h('p', { class: 'small muted', role: 'status' }, ui('Загружаю подборку…'));
  const close = h('button', { type: 'button', class: 'btn small', onclick: () => dialog.close() }, ui('Закрыть'));
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'heat-title' },
    h('h2', { class: 'h2', id: 'heat-title' }, ui('Отправить тепло')), content, error, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();

  const send = async (kind, value) => {
    const choices = [...content.querySelectorAll('button')];
    choices.forEach(button => button.disabled = true);
    try {
      await request(heatPath(dayId), { method: 'POST', body: { kind, value } });
      setText(status, ui('Тепло отправлено.'));
      dialog.close();
      if (opener.isConnected) opener.focus({ preventScroll: true });
    } catch (ex) {
      setText(error, ui(ex.status === 404 ? 'Этот день недоступен' : ex.message));
      choices.forEach(button => button.disabled = false);
    }
  };
  try {
    const day = await cloudLatestDay();
    if (!dialog.isConnected) return;
    const palette = day ? makeFingerprint(day, computeDay(day)).palette : [];
    const songs = suggestMusicForPhotos(day ? aggregatePhotos(day.photos) : { lum: .5, contrast: .1, sat: .15, warmth: 0 });
    if (palette.length) content.append(h('p', null, ui('Цвет из вашей последней записи')),
      h('div', { class: 'heat-colors' }, palette.map((color, index) =>
        h('button', { type: 'button', style: { backgroundColor: color },
          'aria-label': ui('Отправить цвет {number}: {color}', { number: index + 1, color }), onclick: () => send('color', color),
        }))));
    content.append(h('p', null, ui('Трек из подборки')),
      h('div', { class: 'heat-tracks' }, songs.map(song => h('button', {
        type: 'button', class: 'btn small', onclick: () => send('track', song.meta.previewUrl.split('/').at(-1).replace(/\.mp3$/, '')),
      }, song.meta.title))));
    setText(error, '');
  } catch (ex) {
    setText(error, ui(ex.message));
  }
}

export async function loadWarmth(id, panel) {
  let results;
  try { results = await request(heatPath(id)); }
  catch { return; }
  const rows = results.flatMap(item => {
    let itemContent;
    if (item.kind === 'color' && isColor(item.value)) {
      itemContent = h('span', { class: 'heat-swatch', role: 'img', style: { backgroundColor: item.value },
        'aria-label': ui('Цвет {color}', { color: item.value }),
      });
    } else if (item.kind === 'track' && isPhotoTrack(item.value)) {
      const track = photoTrack(item.value);
      itemContent = h('a', { class: 'linklike', href: track.link, target: '_blank', rel: 'noopener' }, track.meta.title);
    }
    return itemContent ? [h('li', null, itemContent, h('span', null, item.name))] : [];
  });
  panel.replaceChildren(h('h2', { id: 'day-warmth-title' }, ui('От друзей')), h('ul', null, rows));
  return rows.length > 0;
}
