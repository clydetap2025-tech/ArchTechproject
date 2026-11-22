import { account, request } from './account.js';
import { h } from './util.js';
import { moodMessage, sharedWeather } from './day-sharing.js';
import { setText, translate, ui, uiDate } from './i18n.js';

export const listFriends = () => request('daytrace/friends');

function socialPage(title, tab, ...content) {
  const nav = (href, label, active) =>
    h('a', { class: 'btn small' + (active ? ' primary' : ''), href, 'aria-current': active ? 'page' : null }, ui(label));
  return h('section', { class: 'wrap social-page', 'aria-labelledby': 'social-title' },
    h('header', { class: 'social-heading' },
      h('h1', { class: 'h1', id: 'social-title' }, ui(title)),
      h('nav', { class: 'row tight', 'aria-label': ui('Друзья') },
        nav('#/friends', 'Друзья', tab === 'friends'), nav('#/friends/feed', 'Атмосфера друзей', tab === 'feed'))),
    ...content);
}

export function friendsPage(friends) {
  const list = h('ul', { class: 'friends-list' });
  const notice = h('p', { class: 'small muted', role: 'status' });
  const invitation = h('input', { type: 'text', readonly: true, 'aria-label': ui('Ссылка-приглашение'), hidden: true });
  const invite = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    invite.disabled = true;
    try {
      const { token } = await request('daytrace/invites', { method: 'POST' });
      const url = new URL(location.pathname, location.origin);
      url.hash = '/friends/join/' + token;
      invitation.value = url.href;
      invitation.hidden = false;
      try {
        await navigator.clipboard.writeText(url.href);
        setText(notice, ui('Ссылка скопирована. Она действует сутки и используется один раз.'));
      } catch {
        invitation.select();
        setText(notice, ui('Скопируйте ссылку. Она действует сутки и используется один раз.'));
      }
    } catch (error) {
      setText(notice, ui(error.message));
    } finally {
      invite.disabled = false;
    }
  } }, ui('Пригласить друга'));
  function update() {
    if (!friends.length) {
      list.replaceChildren(h('li', { class: 'muted' }, ui('Пока здесь никого. Пригласите друга, чтобы делиться днями.')));
      return;
    }
    list.replaceChildren(...friends.map(friend => {
      const remove = h('button', {
        type: 'button', class: 'btn ghost small', 'aria-label': ui('Удалить из друзей: {name}', { name: friend.name }),
        onclick: async () => {
          if (!confirm(translate('Удалить {name} из друзей?', { name: friend.name }))) return;
          remove.disabled = true;
          try {
            await request('collections/friendships/records/' + friend.friendship, { method: 'DELETE' });
            friends = friends.filter(item => item.friendship !== friend.friendship);
            update();
            invite.focus({ preventScroll: true });
          } catch (error) {
            if (error.status === 404) {
              friends = await listFriends().catch(() => friends);
              update();
            }
            setText(notice, ui(error.message));
          } finally {
            remove.disabled = false;
          }
        },
      }, ui('Удалить из друзей'));
      return h('li', { class: 'friend-row' }, h('strong', null, friend.name), remove);
    }));
  }
  update();
  return socialPage('Друзья', 'friends', h('div', { class: 'friend-invite' }, invite, invitation, notice), list);
}

export function invitationPage(token, onAccepted) {
  const valid = /^[a-zA-Z0-9]{48}$/.test(token);
  const notice = h('p', { class: 'muted', role: 'status' });
  const accept = h('button', { type: 'button', class: 'btn primary', onclick: async () => {
    accept.disabled = true;
    try {
      const friend = await request('daytrace/invites/accept', { method: 'POST', body: { token } });
      if (accept.isConnected) onAccepted(friend.name);
    } catch (error) {
      setText(notice, ui(error.status === 404 ? 'Ссылка уже использована или истекла.' :
        error.status === 400 ? 'Своё приглашение принять нельзя.' : error.message));
    } finally {
      accept.disabled = false;
    }
  } }, ui('Принять приглашение'));
  return socialPage('Приглашение в друзья', '',
    h('p', { class: 'muted' }, ui(valid
      ? 'После принятия вы сможете видеть открытые друг другу дни.'
      : 'Эта ссылка-приглашение недействительна.')),
    valid && accept, notice);
}

function atmosphereCard(day, friend) {
  const palette = day.palette.filter(color => /^#[a-f0-9]{6}$/.test(color));
  return h('li', { class: 'friend-atmosphere' },
    h('div', { class: 'friend-atmosphere-meta' }, h('h2', null, friend.name),
      h('time', { datetime: day.date }, uiDate(day.date))),
    h('div', { class: 'friend-palette', role: 'img', 'aria-label': ui('Палитра дня') },
      palette.map(color => h('span', { style: { backgroundColor: color } }))),
    h('div', { class: 'friend-signals' },
      h('span', { class: 'friend-mood' }, moodMessage(day.mood_label)),
      day.bpm > 0 && h('span', null, day.bpm + ' BPM'),
      h('span', { class: 'friend-weather' }, sharedWeather(day.weather_summary))),
    day.visibility === 'full' && h('a', { href: '#/friends/day/' + day.id, class: 'btn small' }, ui('Открыть день')));
}

export async function friendsFeed(friends) {
  const names = new Map(friends.map(friend => [friend.id, friend]));
  const list = h('ul', { class: 'friends-feed' });
  const notice = h('p', { class: 'muted', role: 'status' });
  let page = 1;
  const next = h('button', { type: 'button', class: 'btn small', hidden: true, onclick: async () => {
    try { await loadPage(); }
    catch (error) { setText(notice, ui(error.message)); }
  } }, ui('Показать ещё'));
  async function loadPage() {
    next.disabled = true;
    try {
      const params = new URLSearchParams({ filter: 'owner!="' + account.id + '"', sort: '-date,-id', page, perPage: 36 });
      const result = await request('collections/day_atmospheres/records?' + params);
      for (const day of result.items) {
        const friend = names.get(day.owner);
        if (friend) list.append(atmosphereCard(day, friend));
      }
      next.hidden = page >= result.totalPages;
      page++;
      setText(notice, list.childElementCount ? '' : ui('Здесь появятся дни, которыми поделились друзья.'));
    } finally {
      next.disabled = false;
    }
  }
  await loadPage();
  return socialPage('Атмосфера друзей', 'feed', list, notice, next);
}
