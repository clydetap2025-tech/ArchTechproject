import { h } from './util.js';
import { getLanguage, languages, setLanguage, ui } from './i18n.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const changes = new EventTarget();
const sessionPreferences = new Map();
const storageKey = kind => 'pv:motion:' + kind;

function readPreference(kind) {
  try { return localStorage.getItem(storageKey(kind)) !== 'off'; }
  catch { return sessionPreferences.get(kind) ?? true; }
}

function savePreference(kind, enabled) {
  sessionPreferences.set(kind, enabled);
  try { localStorage.setItem(storageKey(kind), enabled ? 'on' : 'off'); }
  catch { /* The preference still applies to this tab. */ }
  changes.dispatchEvent(new Event(kind));
}

export function motionEnabled(kind) {
  return readPreference(kind) && !reducedMotion.matches;
}

export function watchMotion(kind, callback) {
  const onStorage = event => {
    if (event.key === storageKey(kind) || event.key === null) callback();
  };
  changes.addEventListener(kind, callback);
  reducedMotion.addEventListener('change', callback);
  window.addEventListener('storage', onStorage);
  return () => {
    changes.removeEventListener(kind, callback);
    reducedMotion.removeEventListener('change', callback);
    window.removeEventListener('storage', onStorage);
  };
}

const settings = [
  ['book', 'Анимация книги', 'Заставка и перелистывание в архиве'],
  ['background', 'Анимация фона', 'Видео с погодой на главной'],
];

export function openSettings(trigger) {
  const language = h('select', {
    class: 'settings-language', onchange: event => setLanguage(event.target.value),
  }, Object.entries(languages).map(([code, label]) => h('option', { value: code, lang: code }, label)));
  language.value = getLanguage();
  const close = h('button', {
    class: 'settings-close', type: 'button', 'aria-label': ui('Закрыть настройки'), autofocus: true,
    onclick: () => dialog.close(),
  }, '×');
  const dialog = h('dialog', { class: 'settings-dialog', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'settings-heading' },
      h('h2', { id: 'settings-title' }, ui('Настройки')), close),
    h('p', { class: 'settings-scope' }, ui('Сохраняются в этом браузере.')),
    h('div', { class: 'settings-options' },
      h('label', { class: 'settings-option' }, h('strong', null, ui('Язык интерфейса')), language),
      settings.map(([kind, title, description]) => {
        const toggle = h('input', {
          class: 'settings-switch', type: 'checkbox', role: 'switch',
          'aria-label': ui(title), onchange: event => savePreference(kind, event.target.checked),
        });
        toggle.checked = readPreference(kind);
        return h('label', { class: 'settings-option' },
          h('span', null, h('strong', null, ui(title)), h('small', null, ui(description))), toggle);
      })));

  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
