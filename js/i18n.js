import { translations } from './translations.js';

export const languages = { ru: 'Русский', kk: 'Қазақша', en: 'English' };
const locales = { ru: 'ru-RU', en: 'en-US' };
// Some embedded browsers ship without Kazakh month and weekday names.
const kazakhMonths = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];
const kazakhWeekdays = ['жексенбі', 'дүйсенбі', 'сейсенбі', 'сәрсенбі', 'бейсенбі', 'жұма', 'сенбі'];
const storageKey = 'pv:language';
let language = 'ru';
try {
  const saved = localStorage.getItem(storageKey);
  if (Object.hasOwn(languages, saved)) language = saved;
} catch { /* The interface can still be switched in this tab. */ }

const textBindings = new WeakMap();
const attributeBindings = new WeakMap();

class Message {
  constructor(format) { this.format = format; }
  toString() { return this.format(language); }
}

export function getLanguage() { return language; }

export function translate(source, values = {}) {
  const entry = Object.hasOwn(translations, source) ? translations[source] : null;
  const text = (language === 'en' ? entry?.[0] : language === 'kk' ? entry?.[1] : null) || source;
  return text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

export function ui(source, values) { return new Message(() => translate(source, values)); }
export function localized(format) { return new Message(format); }
export function uiDate(iso, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  const date = new Date(iso);
  return localized(lang => {
    if (!Number.isFinite(date.getTime())) return iso || '';
    if (lang === 'kk') {
      if (options.weekday) return kazakhWeekdays[date.getUTCDay()];
      return [
        options.day && date.getUTCDate(),
        options.month && kazakhMonths[date.getUTCMonth()],
        options.year && date.getUTCFullYear(),
      ].filter(Boolean).join(' ');
    }
    const label = new Intl.DateTimeFormat(locales[lang], { timeZone: 'UTC', ...options }).format(date);
    return lang === 'ru' ? label.replace(/\s*г\.$/, '') : label;
  });
}

export function isMessage(value) { return value instanceof Message; }

export function uiTextNode(message) {
  const node = document.createTextNode(String(message));
  textBindings.set(node, message);
  return node;
}

export function setText(element, value) {
  if (isMessage(value)) element.replaceChildren(uiTextNode(value));
  else element.textContent = value;
}

export function setAttribute(element, name, value) {
  let bindings = attributeBindings.get(element);
  if (isMessage(value)) {
    if (!bindings) attributeBindings.set(element, bindings = new Map());
    bindings.set(name, value);
  } else {
    bindings?.delete(name);
  }
  element.setAttribute(name, String(value));
}

function renderLanguage() {
  document.documentElement.lang = language;
  const nodes = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) {
    const node = nodes.currentNode;
    const message = textBindings.get(node);
    if (message) {
      const value = String(message);
      if (node.data !== value) node.data = value;
    }
    const attributes = attributeBindings.get(node);
    if (attributes) for (const [name, value] of attributes) node.setAttribute(name, String(value));
  }
}

export function setLanguage(next) {
  if (!Object.hasOwn(languages, next) || next === language) return;
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the in-memory choice. */ }
  renderLanguage();
}

if (typeof document !== 'undefined') {
  document.querySelectorAll('[data-ui]').forEach(element => setText(element, ui(element.textContent.trim())));
  document.querySelectorAll('[data-ui-attrs]').forEach(element => {
    for (const name of element.dataset.uiAttrs.split(' ')) setAttribute(element, name, ui(element.getAttribute(name)));
  });
  document.documentElement.lang = language;
}
