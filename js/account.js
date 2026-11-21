import { accountServer } from './account-config.js';
import { h } from './util.js';

const key = 'pv:account:' + accountServer;
function readSession() {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
// A document belongs to one session. Switching accounts discards in-flight UI and media.
export const account = readSession();
window.addEventListener('storage', e => {
  if ((e.key === key || e.key === null) && readSession()?.id !== account?.id) location.reload();
});
window.addEventListener('pageshow', e => {
  if (e.persisted && readSession()?.token !== account?.token) location.reload();
});

export async function request(path, { method = 'GET', body, token = account?.token, binary = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = token;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(accountServer + '/api/' + path, { method, headers, body, cache: 'no-store', credentials: 'omit' });
  } catch { throw new Error('Сервер дневника недоступен. Проверьте соединение и попробуйте снова.'); }
  if (!response.ok) {
    if (response.status === 401 && account && token === account.token) signOut();
    const error = new Error(response.status === 413 ? 'Файлы слишком большие для сервера.' :
      'Не удалось выполнить запрос к дневнику (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  if (binary) return response.blob();
  try { return await response.json(); }
  catch { throw new Error('К этому сайту ещё не подключён сервер дневника.'); }
}

export function signOut() {
  localStorage.removeItem(key);
  location.replace(location.pathname + location.search + '#/');
  location.reload();
}

export async function renewSession() {
  if (!account) return;
  try {
    const refreshed = await request('collections/users/auth-refresh', { method: 'POST' });
    if (readSession()?.id !== account.id) return;
    account.token = refreshed.token;
    localStorage.setItem(key, JSON.stringify(account));
  } catch (error) {
    if (error.status === 403) signOut();
    throw error;
  }
}

export function loginForm(destination) {
  let register = false;
  const title = h('h1', { id: 'auth-title', tabindex: '-1' });
  const description = h('p', { class: 'auth-description' });
  const email = h('input', {
    type: 'email', id: 'account-email', name: 'email', required: true, autocomplete: 'email',
    placeholder: 'Электронная почта', autocapitalize: 'none', spellcheck: 'false',
  });
  const password = h('input', {
    type: 'password', id: 'account-password', name: 'password', required: true, placeholder: 'Пароль',
  });
  const reveal = h('button', { class: 'auth-reveal', type: 'button', 'aria-controls': password.id, onclick: () => {
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    reveal.textContent = visible ? 'Скрыть' : 'Показать';
    reveal.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль');
  } }, 'Показать');
  const passwordHint = h('p', { id: 'auth-password-hint', class: 'auth-hint', hidden: true }, 'От 8 символов');
  const submit = h('button', { class: 'auth-submit', type: 'submit' });
  const message = h('p', { class: 'auth-message', role: 'status' });
  const switchText = h('span');
  const toggle = h('button', { class: 'auth-switch-button', type: 'button', onclick: () => {
    register = !register;
    password.value = '';
    render();
    title.focus({ preventScroll: true });
  } });
  function render() {
    title.textContent = register ? 'Создать аккаунт' : 'Вход в дневник';
    description.textContent = register ? 'Сохраняйте свои дни и возвращайтесь к ним.' : 'Войдите, чтобы открыть свои записи.';
    submit.textContent = register ? 'Зарегистрироваться' : 'Войти';
    switchText.textContent = register ? 'Уже есть аккаунт?' : 'Нет аккаунта?';
    toggle.textContent = register ? 'Войти' : 'Создать аккаунт';
    password.type = 'password';
    reveal.textContent = 'Показать';
    reveal.setAttribute('aria-label', 'Показать пароль');
    password.autocomplete = register ? 'new-password' : 'current-password';
    password.minLength = register ? 8 : 1;
    passwordHint.hidden = !register;
    if (register) password.setAttribute('aria-describedby', passwordHint.id);
    else password.removeAttribute('aria-describedby');
    message.textContent = '';
  }
  render();
  const form = h('form', { class: 'auth-form', oninput: () => { message.textContent = ''; }, onsubmit: async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = toggle.disabled = true;
    email.readOnly = password.readOnly = true;
    form.setAttribute('aria-busy', 'true');
    submit.textContent = register ? 'Создаём аккаунт…' : 'Входим…';
    message.textContent = '';
    try {
      const identity = email.value.trim();
      const secret = password.value;
      if (register) await request('collections/users/records', { method: 'POST',
        body: { email: identity, password: secret, passwordConfirm: secret } });
      const session = await request('collections/users/auth-with-password', { method: 'POST', body: { identity, password: secret } });
      localStorage.setItem(key, JSON.stringify({ id: session.record.id, email: session.record.email, token: session.token }));
      location.replace(location.pathname + location.search + destination);
      location.reload();
    } catch (e) {
      message.textContent = e.status === 400 ? (register ? 'Проверьте почту и пароль. Если аккаунт уже существует, войдите.' : 'Проверьте почту и пароль.') : e.message;
    } finally {
      submit.disabled = toggle.disabled = false;
      email.readOnly = password.readOnly = false;
      form.removeAttribute('aria-busy');
      submit.textContent = register ? 'Зарегистрироваться' : 'Войти';
    }
  } },
  h('div', { class: 'auth-field' }, h('label', { for: email.id, class: 'visually-hidden' }, 'Электронная почта'), email),
  h('div', null,
    h('div', { class: 'auth-field auth-password' }, h('label', { for: password.id, class: 'visually-hidden' }, 'Пароль'), password, reveal),
    passwordHint),
  message, submit);
  return h('section', { class: 'auth-screen', 'aria-labelledby': title.id },
    h('div', { class: 'auth-panel' },
      h('div', { class: 'auth-heading' }, title, description),
      form, h('p', { class: 'auth-switch' }, switchText, ' ', toggle)));
}
