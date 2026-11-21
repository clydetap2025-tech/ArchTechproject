import { h } from './util.js';
import { landscapeURL } from './weather.js';
import { motionEnabled, watchMotion } from './preferences.js';
import { ui } from './i18n.js';

export function scenery({ particles = true } = {}) {
  return h('div', { class: 'scenery', 'aria-hidden': 'true' },
    h('div', { class: 'scenery-photo' }),
    particles && h('div', { class: 'scenery-canopy' }),
    particles && h('div', { class: 'scenery-particles' }, Array.from({ length: 24 }, (_, index) => {
      const particle = h('i');
      particle.style.setProperty('--x', `${(index * 37 + 8) % 100}%`);
      particle.style.setProperty('--y', `${(index * 61 + 19) % 100}%`);
      particle.style.setProperty('--size', `${2 + index % 6}px`);
      particle.style.setProperty('--duration', `${9 + index % 10}s`);
      particle.style.setProperty('--delay', `${-(index * 7) % 19}s`);
      return particle;
    })));
}

const sceneryMedia = (name, type) => new URL(`../demo/scenery/${name}.${type}`, import.meta.url).href;

export function setScenery(scene, theme) {
  scene.dataset.scene = theme.scene;
  scene.dataset.motion = theme.motion;
  scene.style.setProperty('--landscape', `url("${landscapeURL(theme.scene)}")`);
}

export function animateScenery(scene, onCleanup) {
  const book = document.getElementById('book-intro');
  const video = h('video', { class: 'scenery-video', muted: true, loop: true, playsinline: true, preload: 'none' });
  video.muted = true;
  let visible = false;

  function sync() {
    const { scene: season, motion } = scene.dataset;
    const next = motion === 'rain' && season !== 'winter' ? 'rain' : season;
    const enabled = motionEnabled('background');
    video.poster = sceneryMedia(next, 'jpg');
    scene.style.setProperty('--scenery-poster', `url("${video.poster}"), var(--landscape)`);
    if (!enabled || !visible || document.hidden || book.open) {
      video.pause();
      if (!enabled || video.dataset.scene !== next) video.classList.remove('is-playing');
      return;
    }
    if (video.dataset.scene !== next) {
      video.classList.remove('is-playing');
      video.dataset.scene = next;
      video.src = sceneryMedia(next, 'mp4');
    }
    if (video.paused) video.play().catch(() => { /* The still frame is available if autoplay fails. */ });
  }

  video.addEventListener('playing', () => video.classList.add('is-playing'));
  video.addEventListener('error', () => video.classList.remove('is-playing'));
  scene.querySelector('.scenery-photo').after(video);
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  visibility.observe(scene);
  document.addEventListener('visibilitychange', sync);
  book.addEventListener('close', sync);
  const stopWatchingMotion = watchMotion('background', sync);
  onCleanup(() => {
    visibility.disconnect();
    document.removeEventListener('visibilitychange', sync);
    book.removeEventListener('close', sync);
    stopWatchingMotion();
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  return sync;
}

export function memoryGallery(items) {
  const previous = h('button', { class: 'gallery-arrow', type: 'button', 'aria-label': ui('Предыдущая карточка') }, '←');
  const next = h('button', { class: 'gallery-arrow', type: 'button', 'aria-label': ui('Следующая карточка') }, '→');
  const position = h('span', { class: 'gallery-count', 'aria-live': 'polite' });
  const cards = items.map(item => h(item.href ? 'a' : 'button', {
    class: 'memory-card', href: item.href, type: item.href ? null : 'button', onclick: item.action, 'aria-label': item.title,
  },
  h('img', { src: item.image, alt: '', draggable: 'false', decoding: 'async' }),
  h('span', { class: 'memory-caption' },
    h('span', { class: 'memory-date' }, item.date),
    h('span', { class: 'memory-name' }, item.title)),
  h('span', { class: 'memory-open', 'aria-hidden': 'true' }, '↗')));
  const track = h('div', { class: 'gallery-track' }, cards);
  let active = 0;
  const render = () => {
    cards.forEach((card, index) => {
      let relative = (index - active + cards.length) % cards.length;
      if (relative > cards.length / 2) relative -= cards.length;
      const distance = Math.abs(relative);
      card.dataset.distance = distance;
      card.style.setProperty('--slot', relative);
      card.style.setProperty('--distance', distance);
      card.style.zIndex = 8 - distance;
      card.inert = distance > 2;
      card.tabIndex = distance === 0 ? 0 : -1;
    });
    position.textContent = `${String(active + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
  };
  const move = step => { active = (active + step + cards.length) % cards.length; render(); };
  previous.onclick = () => move(-1);
  next.onclick = () => move(1);
  let gesture, muteClickUntil = 0, lastWheel = 0;
  track.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  track.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    if (cards.length > 1 && Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(event.clientY - gesture.y)) {
      move(dx < 0 ? 1 : -1);
      muteClickUntil = performance.now() + 300;
    }
    gesture = null;
  });
  track.addEventListener('pointercancel', () => { gesture = null; });
  track.addEventListener('click', event => {
    if (performance.now() < muteClickUntil) { event.preventDefault(); event.stopPropagation(); return; }
    const index = cards.indexOf(event.target.closest('.memory-card'));
    if (index >= 0 && index !== active) {
      event.preventDefault();
      event.stopPropagation();
      active = index;
      render();
    }
  }, true);
  track.addEventListener('wheel', event => {
    if (cards.length < 2 || event.ctrlKey || !(event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 250) return;
    const delta = event.deltaX || event.deltaY;
    if (!delta) return;
    lastWheel = now;
    move(delta > 0 ? 1 : -1);
  }, { passive: false });
  const gallery = h('section', { class: 'memory-gallery', 'aria-label': ui('Галерея воспоминаний') }, track,
    h('div', { class: 'gallery-controls', hidden: cards.length < 2 }, previous, position, next));
  gallery.addEventListener('keydown', event => {
    if (cards.length < 2 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const fromCard = cards.includes(document.activeElement);
    move(event.key === 'ArrowLeft' ? -1 : 1);
    if (fromCard) cards[active].focus();
  });
  render();
  return gallery;
}
