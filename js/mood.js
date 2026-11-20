// The visual system: inputs → mood coordinates → technique blend → style parameters + "why" recipe.
// Layer rule: PHOTOS give the material (palette, composition), TEXT gives light and meaning
// (technique, temperature, title), MUSIC gives time and motion (rhythm, pulse, transitions, texture).
import { clamp, rgbToHsl, hslToRgb, hueLerp, lum, hsl, colorName, TIME_RU, plural } from './util.js';
import { aggregatePhotos } from './photo.js';
import { AMBIENT_RU } from './lexicon.js';

export const TECH = {
  monet: { name: 'Импрессионизм', ref: 'Пейзаж и свет', why: 'просторный верхний кадр и мягко скруглённые углы' },
  kandinsky: { name: 'Конструктивизм', ref: 'Городская фотосетка', why: 'строгие рамки, асимметричная нижняя пара и короткий переход' },
  matisse: { name: 'Вырезки', ref: 'Цветовой фотоколлаж', why: 'смещённая линия стыка в нижней паре и живой ритм кадров' },
  hopper: { name: 'Тишина', ref: 'Окна и вечерний свет', why: 'один большой кадр, чуть смещённая нижняя пара и спокойный переход' },
  ma: { name: 'Ма', ref: 'Японский минимализм', why: 'большой главный кадр и равные по ширине дополнительные снимки' },
  film: { name: 'Плёнка', ref: 'Домашний фотоархив', why: 'главный снимок с двумя деталями и дата в шапке страницы' },
};
export const TECH_ORDER = ['monet', 'kandinsky', 'matisse', 'hopper', 'ma', 'film'];

const LIGHT_DESC = {
  morning: 'свежий светлый тон',
  day: 'ровный дневной свет',
  evening: 'тёплый вечерний тон',
  night: 'холодный искусственный свет, глубокие тени',
};
const TIME_TEMP = { morning: 0.1, day: 0, evening: 0.3, night: -0.35 };

const pct = x => Math.round(x * 100) + '%';
const signed = x => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100) / 100).toFixed(2);

function makeTimeline(music, beats, count) {
  const duration = clamp(music.segDur || 30, 12, 30);
  const beat = 60 / clamp(music.bpm || 96, 50, 200);
  const interval = clamp(beats * beat, 2.4, 9);
  const slots = Math.min(count, Math.max(1, Math.round(duration / interval)));
  const groups = Math.max(1, slots, Math.ceil(count / 3));
  const step = Math.max(1, Math.round(duration / groups / beat)) * beat;
  const cuts = [0];
  for (let group = 1; group < groups; group++) {
    const next = (music.beatOffset || 0) + group * step;
    cuts.push(clamp(next, cuts[group - 1] + 1, duration - (groups - group)));
  }
  return { duration, cuts };
}

export function computeDay(day, override = day.override) {
  const T = day.inputs.text, M = day.inputs.music, meta = day.song?.meta || {}, Wx = day.inputs.weather || null;
  const P = aggregatePhotos(day.photos.map(p => ({ stats: p.stats, taken: p.taken })));

  const modeSign = M.mode === 'minor' ? -1 : M.mode === 'major' ? 1 : 0;
  const modeW = modeSign ? clamp(M.keyConf ?? 0.5) : 0;
  const seasonWarm = { summer: 0.6, spring: 0.2, autumn: 0.05, winter: -0.6 }[T.season] ?? 0;
  const localTemperature = Wx?.tmax ?? Wx?.temperature;
  const weatherWarm = Number.isFinite(localTemperature) ? clamp((localTemperature - 12) / 25, -1, 1) * 0.5 : 0;
  const photoWarm = clamp(P.warmth * 2.5, -1, 1);

  let V = clamp(0.65 * T.valence + 0.2 * modeSign * modeW + 0.15 * (P.lum - 0.5) * 2, -1, 1);
  let E = clamp(0.45 * T.energy + 0.45 * M.energy + 0.1 * clamp(P.sat * 1.4));
  const W = clamp(0.5 * T.warmth + 0.35 * photoWarm + 0.15 * (seasonWarm + weatherWarm), -1, 1);
  const Tn = clamp(0.7 * T.tension + 0.25 * M.energy * (modeSign < 0 ? 1 : 0.5));
  const S = T.social;
  const age = meta.year ? clamp((2026 - meta.year - 12) / 40) : 0;
  const N = clamp(0.6 * T.nostalgia + 0.4 * age);
  const overridden = !!(override && (override.valence != null || override.energy != null));
  if (override?.valence != null) V = clamp(override.valence, -1, 1);
  if (override?.energy != null) E = clamp(override.energy);
  const light = (T.timeExplicit && T.timeOfDay) || P.timeGuess || T.timeOfDay || 'day';
  const kind = T.place?.kind;

  // ---- technique scores (soft, so neighbouring techniques blend) ----
  const scores = {
    monet: (1 - E) * 0.8 + Math.max(V, 0) * 0.7 + Math.max(W, 0) * 0.4 - Math.max(-W, 0) * 0.4 + (kind === 'nature' ? 0.4 : 0)
      + (light === 'day' || light === 'evening' ? 0.2 : light === 'morning' ? 0.1 : 0) - Tn * 0.8,
    kandinsky: Tn * 1.2 + E * 0.7 + (kind === 'work' || kind === 'city' ? 0.3 : 0) + (light === 'night' ? 0.2 : 0) - Math.max(W, 0) * 0.3 - N * 0.3,
    matisse: Math.max(V, 0) * 0.9 + E * 0.8 + Math.max(S, 0) * 0.5 - Tn * 0.6 + (T.season === 'summer' ? 0.2 : 0),
    hopper: Math.max(-V, 0) * 0.8 + (1 - E) * 0.5 + Math.max(-S, 0) * 0.6 + (light === 'evening' || light === 'night' ? 0.3 : 0)
      + (kind === 'home' || kind === 'city' ? 0.2 : 0) - Math.max(S, 0) * 0.3,
    ma: (1 - E) * 0.7 + (1 - Math.abs(V)) * 0.4 + (light === 'morning' ? 0.4 : 0) + Math.max(-S, 0) * 0.2 + (P.n <= 2 ? 0.15 : 0)
      + (1 - M.energy) * 0.3 - Tn * 0.5,
    film: N * 1.4 + Math.max(S, 0) * 0.2 + (age > 0.5 ? 0.3 : 0) + Math.max(W, 0) * 0.2,
  };
  const mx = Math.max(...Object.values(scores));
  const ex = {}; let sum = 0;
  for (const k of TECH_ORDER) { ex[k] = Math.exp((scores[k] - mx) / 0.22); sum += ex[k]; }
  const w = {}; for (const k of TECH_ORDER) w[k] = ex[k] / sum;
  const ranked = [...TECH_ORDER].sort((a, b) => w[b] - w[a]);
  const primary = ranked[0], secondary = ranked[1];
  // ---- photo layout, accent colors and beat-aligned transitions ----
  const st = {};
  st.sat = clamp(0.75 + 0.25 * V + 0.3 * E - 0.5 * w.hopper - 0.55 * w.ma + 0.45 * w.matisse + 0.1 * w.kandinsky, 0.1, 1.6);
  st.temp = clamp(W * 0.7 + TIME_TEMP[light], -1, 1);
  st.value = (modeSign < 0 ? 0.92 - 0.05 * modeW : 1 + 0.03 * modeSign * modeW) * (light === 'night' ? 0.94 : 1);
  st.crossfade = primary === 'kandinsky' ? .16 : .46 - .2 * E;
  st.timeline = makeTimeline(M, E > .72 ? 4 : E > .45 ? 8 : 16, P.n);

  // palette: from the photos, shifted by temperature, saturation and the song's mode
  const pal = P.palette.map(c => {
    let [hh, s, l] = rgbToHsl(...c.rgb);
    hh = hueLerp(hh, st.temp >= 0 ? 32 : 218, Math.abs(st.temp) * 0.3);
    return hslToRgb(hh, clamp(s * (0.6 + 0.5 * st.sat) + 0.3 * w.matisse), clamp(l * st.value * (light === 'night' ? 0.88 : 1)));
  }).sort((a, b) => lum(a) - lum(b));
  // Hues come from the photos and the tonal ladder keeps the swatches readable.
  const ladder = [0.1, 0.3, 0.5, 0.68, 0.86].map(v => v * (light === 'night' ? 0.88 : 1));
  st.palette = pal.map((c, i) => {
    const [hh, s, l] = rgbToHsl(...c);
    return hslToRgb(hh, s, clamp(l + (ladder[i] - l) * 0.6));
  });
  const [dh] = rgbToHsl(...P.palette[0].rgb);
  const warmDom = dh < 70 || dh > 330;
  st.accents = {
    monet: [hsl(44, 0.62, 0.72), hsl(dh, 0.45, 0.62), hsl(dh + 40, 0.4, 0.55)],
    kandinsky: [warmDom ? hsl(222, 0.72, 0.42) : hsl(6, 0.78, 0.5), hsl(46, 0.9, 0.56), hsl(dh + 180, 0.5, 0.33)],
    matisse: [hsl(dh + 150, 0.75, 0.46), hsl(dh + 30, 0.85, 0.58), hsl(dh - 90, 0.7, 0.45), hsl(222, 0.7, 0.45)],
    hopper: [hsl(38, 0.75, 0.62), hsl(dh, 0.22, 0.24), hsl(dh + 20, 0.18, 0.38)],
    ma: [hsl(6, 0.72, 0.46), hsl(30, 0.1, 0.12), hsl(dh, 0.15, 0.7)],
    film: [hsl(24, 1, 0.55), hsl(42, 0.35, 0.86), hsl(dh, 0.3, 0.5)],
  }[primary];

  const mood = { V, E, W, T: Tn, S, N, light, overridden };

  // ---- voice ----
  const voice = {
    rate: +(0.8 + 0.34 * E - (light === 'night' ? 0.05 : 0)).toFixed(2),
    pitch: +(0.92 + 0.16 * ((V + 1) / 2) - 0.08 * Tn).toFixed(2),
    slot: E > 0.58 || Tn > 0.5 ? 'B' : 'A',
  };
  voice.why = voice.slot === 'A'
    ? `спокойный день → мягкий голос, темп ${voice.rate}`
    : `насыщенный день → собранный голос, темп ${voice.rate}`;

  // ---- recipe: why the page looks like this ----
  const recipe = [];
  const add = (src, sig, rule) => recipe.push({ src, sig, rule });
  // name the colours a person would notice: chromatic clusters first, near-black/white only as a fallback
  const chromatic = P.palette.filter(c => { const [, s, l] = rgbToHsl(...c.rgb); return s > 0.18 && l > 0.14 && l < 0.88 && c.share > 0.04; });
  const colorWords = [...new Set((chromatic.length ? chromatic : P.palette).slice(0, 2).map(c => colorName(c.rgb)))].join(' и ');
  add('Фото', `${P.n} ${plural(P.n, 'снимок', 'снимка', 'снимков')}, главные цвета — ${colorWords}`,
    `палитра собрана из ваших фото и сдвинута ${st.temp > 0.08 ? 'в тепло' : st.temp < -0.08 ? 'в холод' : 'нейтрально'} (${signed(st.temp)})`);
  add('Фото', P.n === 1 ? 'один кадр' : `${P.n} ${plural(P.n, 'кадр', 'кадра', 'кадров')}`,
    P.n === 1 ? 'один снимок занимает всю фотозону' : 'крупный снимок дополнен деталями в нижней фотополосе');
  const valWord = V > 0.35 ? 'светлое' : V > 0.08 ? 'скорее светлое' : V > -0.15 ? 'смешанное' : V > -0.4 ? 'приглушённое' : 'тяжёлое';
  const enWord = E > 0.7 ? 'очень живое' : E > 0.5 ? 'живое' : E > 0.32 ? 'спокойное' : 'тихое';
  add('Текст', T.hits?.length ? `«${T.hits.slice(0, 3).join('», «')}»` : 'тон записи',
    `настроение записи: ${valWord}, ${enWord}${Tn > 0.5 ? ', напряжённое' : ''}${overridden ? ' (поправлено вручную)' : ''}`);
  add('Текст', `${TIME_RU[light]}${T.timeExplicit ? '' : ' (по фото)'}`, `свет: ${LIGHT_DESC[light]}`);
  const PLACE_RULE = {
    nature: 'природа усиливает спокойные раскладки', work: 'работа добавляет геометрию и сетку',
    city: 'город добавляет ритм и геометрию', home: 'интерьер добавляет тишины и пустоты', travel: 'дорога добавляет движения',
  };
  if (T.place) add('Текст', `место: ${T.place.nom}`, PLACE_RULE[kind] || 'место задаёт композицию');
  add('Музыка', M.source === 'audio' ? `${M.bpm} BPM` : `≈${M.bpm} BPM (по жанру)`,
    st.timeline.cuts.length > 1 ? `смена фотосцены по долям трека, переход ${st.crossfade.toFixed(2)} с` : 'музыка влияет на мягкое приближение в кадре');
  if (modeSign) add('Музыка', M.key, modeSign < 0
    ? 'минор немного приглушает акцентную палитру' : 'мажор немного осветляет акцентную палитру');
  add('Музыка', `энергия ${pct(M.energy)}`, 'энергия влияет на темп и приближение снимков');
  // when signals disagree we don't average them: each keeps its own layer
  const musicUp = M.energy > 0.55 || (modeSign > 0 && modeW > 0.4);
  const musicDown = M.energy < 0.4 && modeSign < 0;
  if (T.valence < -0.1 && musicUp) add('Спор', 'грустный текст, живая песня', 'палитра остаётся приглушённой (её задаёт текст), а движение живым (его задаёт музыка) — так выглядит горько-сладкий день');
  else if (T.valence > 0.25 && musicDown) add('Спор', 'светлый текст, тихая минорная песня', 'палитра тёплая (из текста и фото), но кадры текут медленно (из музыки) — нежная ностальгия');
  add('Система', w[secondary] >= 0.05 ? `${TECH[primary].name} ${pct(w[primary])} + ${TECH[secondary].name} ${pct(w[secondary])}` : `${TECH[primary].name} ${pct(w[primary])}`, TECH[primary].why);
  add('Голос', voice.slot === 'A' ? 'мягкий голос' : 'собранный голос', voice.why);
  if (day.meta?.ambient?.length) add('Звук', day.meta.ambient.map(k => AMBIENT_RU[k]).join(' + '), 'тихий фон под песней — из слов вашей записи');
  if (Wx) add('Погода', [Wx.city, Wx.text, Number.isFinite(localTemperature) ? `${Math.round(localTemperature)}°` : null].filter(Boolean).join(' · '),
    'погода этого дня влияет на пейзаж и тепло палитры');

  return { mood, weights: w, scores, primary, secondary, style: st, recipe, voice, photo: P };
}
