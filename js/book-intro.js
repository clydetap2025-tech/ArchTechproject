import { motionEnabled, watchMotion } from './preferences.js';

const dialog = document.getElementById('book-intro');
const model = dialog.querySelector('.book-model');
const lid = dialog.querySelector('.book-lid');
const shadow = dialog.querySelector('.book-shadow');
const skipArrivalKey = 'pv:skip-book-arrival';
const leaves = [];
let frame = 0;
let deadline = 0;

// Four hinged strips let the free edge lag behind the bound edge as paper turns.
function bindLeaves() {
  for (let layer = 0; layer < 3; layer++) {
    const sheet = document.createElement('div');
    sheet.className = 'book-leaf';
    const strips = [];
    let parent = sheet;
    for (let index = 0; index < 4; index++) {
      const strip = document.createElement('div');
      strip.className = 'book-bend';
      strip.style.setProperty('--sheet-x', (index * 100 / 3) + '%');
      parent.append(strip);
      parent = strip;
      strips.push(strip);
    }
    model.insertBefore(sheet, lid);
    leaves.push({ sheet, strips });
  }
}

function ease(from, until, t) {
  const x = Math.max(0, Math.min(1, (t - from) / (until - from)));
  return x * x * (3 - 2 * x);
}

function pose(t) {
  const opening = ease(.15, .78, t);
  const lift = ease(0, .24, t);
  const exit = ease(.81, 1, t);
  const tilt = 18 - opening * 10;
  const zoom = 1.08 - opening * .15 + exit * .16;
  model.style.transform = [
    `translateX(${-46 + opening * 45}%) translateY(${(1 - lift) * 2}%)`,
    `rotateX(${tilt}deg) rotateY(${-14 + 10 * opening}deg) rotateZ(${-7 + opening * 5}deg)`,
    `scale3d(${zoom}, ${zoom}, ${zoom})`,
  ].join(' ');
  lid.style.transform = `translateZ(calc(var(--block) + ${3 - 7 * opening}px)) rotateY(${-174 * opening}deg)`;
  shadow.style.transform = `translateX(${-opening * 3}%) rotate(${-7 + opening * 5}deg) scale(${1 + opening * .77}, .95)`;
  leaves.forEach(({ sheet, strips }, index) => {
    const delay = (2 - index) * .046;
    const turn = ease(.27 + delay, .78 + delay, t);
    const curl = Math.sin(Math.PI * turn);
    const angle = (170 + index * 1.3) * turn;
    sheet.style.transform = `translateZ(calc(var(--block) + ${.65 + index * .8}px)) rotateY(${-angle - 23 * curl}deg)`;
    sheet.style.setProperty('--shade', (.15 * curl).toFixed(3));
    strips.forEach((strip, position) => {
      strip.style.transform = `rotateY(${curl * (position === 0 ? 3 : 14)}deg)`;
    });
  });
  dialog.style.opacity = String(1 - exit);
}

function finish() {
  cancelAnimationFrame(frame);
  clearTimeout(deadline);
  if (dialog.open) dialog.close();
}

export function skipBookOnReload(destination) {
  try { sessionStorage.setItem(skipArrivalKey, destination); } catch { /* Storage is optional. */ }
}

export function openBook() {
  try {
    const skipArrival = sessionStorage.getItem(skipArrivalKey) === (location.hash || '#/');
    sessionStorage.removeItem(skipArrivalKey);
    if (skipArrival) return;
  } catch { /* Storage is optional. */ }
  if (location.hash === '#/archive' || !motionEnabled('book') || document.hidden || dialog.open ||
      typeof dialog.showModal !== 'function') return;
  if (!leaves.length) bindLeaves();
  const duration = 2350;
  let start;
  pose(0);
  dialog.showModal();
  function draw(now) {
    start ??= now;
    const progress = (now - start) / duration;
    if (progress >= 1) { finish(); return; }
    pose(progress);
    frame = requestAnimationFrame(draw);
  }
  frame = requestAnimationFrame(draw);
  deadline = setTimeout(finish, duration + 500);
}

dialog.querySelector('.book-skip').addEventListener('click', finish);
dialog.addEventListener('keydown', event => event.stopPropagation());
dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
watchMotion('book', () => { if (!motionEnabled('book')) finish(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
window.addEventListener('pagehide', finish);
