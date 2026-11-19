// Voice-over of the entry with the browser's speech synthesis. The voice is chosen by rule, not at random:
// calm days → voice A (softer), dense/tense days → voice B (more collected); rate and pitch follow the mood.

export function voicesReady() {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise(res => {
    const done = () => res(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export async function pickVoice(rule) {
  const all = await voicesReady();
  const ru = all.filter(v => /^ru/i.test(v.lang));
  const pool = (ru.length ? ru : all).slice().sort((a, b) => score(b) - score(a));
  const voice = rule.slot === 'B' ? (pool[1] || pool[0]) : pool[0];
  return { voice: voice || null, name: voice ? voice.name.replace(/Microsoft |Google |Online \(Natural\) - .*$/g, '').trim() : 'системный голос', ru: ru.length > 0 };
}

const score = v => (/natural|neural|online/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 0.5);

export function speak(text, rule, voice, { onstart, onend } = {}) {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = rule.rate; u.pitch = rule.pitch; u.volume = 1;
  u.onstart = () => onstart?.();
  u.onend = u.onerror = () => onend?.();
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
