// The visual system: inputs → mood coordinates → technique blend → style parameters + "why" recipe.
// Layer rule: PHOTOS give the material (palette, composition), TEXT gives light and meaning
// (technique, temperature, title), MUSIC gives time and motion (rhythm, pulse, transitions, texture).
import { clamp, rgbToHsl, hslToRgb, hueLerp, lum, hsl, colorName, TIME_RU, plural } from './util.js';
import { aggregatePhotos } from './photo.js';
import { eraOf } from './music.js';
import { AMBIENT_RU } from './lexicon.js';

export const TECH = {
  monet: { name: 'Импрессионизм', ref: 'Клод Моне', when: 'спокойный тёплый день, природа, мягкий свет', why: 'мазки вместо контуров: в хорошем воспоминании свет важнее деталей', trans: 'dissolve' },
  kandinsky: { name: 'Конструктивизм', ref: 'Василий Кандинский', when: 'напряжение, скорость, город, дедлайн', why: 'острые углы и жёсткая сетка дают напряжение; Кандинский строил «Композиции» как музыку', trans: 'cut' },
  matisse: { name: 'Вырезки', ref: 'Анри Матисс', when: 'радость, движение, друзья, праздник', why: 'плоский чистый цвет без полутонов — радость без оговорок; формы пляшут на сильную долю', trans: 'slide' },
  hopper: { name: 'Тишина', ref: 'Эдвард Хоппер, Вильгельм Хаммерсхёй', when: 'вечер, одиночество, дом или пустой город', why: 'пустое пространство и свет из окна: одиночество без драмы', trans: 'fade' },
  ma: { name: 'Ма', ref: 'японский минимализм, суми-э', when: 'созерцание, раннее утро, тишина, мало событий', why: 'пауза как содержание: много бумаги, тушь и один кадр', trans: 'ink' },
  film: { name: 'Плёнка', ref: 'домашний фотоархив, Polaroid', when: 'ностальгия, семья, старая песня', why: 'зерно, засветки и штамп даты — культурный код воспоминания', trans: 'burn' },
};
export const TECH_ORDER = ['monet', 'kandinsky', 'matisse', 'hopper', 'ma', 'film'];

const TRANS_RU = { dissolve: 'мягкое растворение', cut: 'резкая склейка в долю', slide: 'сдвиг, как вырезанный лист', fade: 'медленное затемнение', ink: 'растекание туши', burn: 'плёночная вспышка' };
const TRANS_DUR = { dissolve: 1.8, cut: 0.14, slide: 0.55, fade: 2.2, ink: 1.9, burn: 0.9 };
const LIGHT_DESC = {
  morning: 'низкое солнце слева, свежий светлый тон',
  day: 'ровный дневной свет',
  evening: 'тёплый низкий свет справа, длинные тени',
  night: 'холодный искусственный свет, глубокие тени',
};
const TIME_TEMP = { morning: 0.1, day: 0, evening: 0.3, night: -0.35 };

const f2 = x => (Math.round(x * 100) / 100).toFixed(2);
const pct = x => Math.round(x * 100) + '%';
const signed = x => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100) / 100).toFixed(2);

export function computeDay(day, override = day.override) {
  const T = day.inputs.text, M = day.inputs.music, meta = day.song?.meta || {}, Wx = day.inputs.weather || null;
  const P = aggregatePhotos(day.photos.map(p => ({ stats: p.stats, taken: p.taken })));

  const modeSign = M.mode === 'minor' ? -1 : M.mode === 'major' ? 1 : 0;
  const modeW = modeSign ? clamp(M.keyConf ?? 0.5) : 0;
  const seasonWarm = { summer: 0.6, spring: 0.2, autumn: 0.05, winter: -0.6 }[T.season] ?? 0;
  const weatherWarm = Wx ? clamp((Wx.tmax - 12) / 25, -1, 1) * 0.5 : 0;
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
  const era = eraOf(meta.year);
  const vintage = era?.key === 'vintage' ? 1 : era?.key === 'analog' ? 0.6 : 0;

  // ---- continuous style parameters (one shader, blended by weights) ----
  const st = {};
  st.paint = clamp(w.monet + w.hopper * 0.35 + w.matisse * 0.35 + w.film * 0.15 + w.ma * 0.2);
  st.flow = clamp(w.monet + w.ma * 0.3 + w.film * 0.1);
  st.flowSpeed = 0.35 + E * 1.2;
  st.edges = clamp(w.kandinsky * 0.9 + w.matisse * 0.25 + w.ma * 0.12);
  st.poster = clamp(w.kandinsky * 0.75 + w.matisse * 0.9);
  st.palMap = clamp(w.matisse * 0.8 + w.kandinsky * 0.6 + w.monet * 0.3 + w.hopper * 0.25 + w.ma * 0.2 + w.film * 0.1);
  st.ink = clamp(w.ma * 0.95);
  st.levels = clamp(0.15 + w.kandinsky * 0.8 + w.matisse * 0.55 + w.film * 0.2 + w.ma * 0.65);
  st.sat = clamp(0.75 + 0.25 * V + 0.3 * E - 0.5 * w.hopper - 0.55 * w.ma + 0.45 * w.matisse + 0.1 * w.kandinsky, 0.1, 1.6);
  st.contrast = clamp(0.92 + 0.35 * Tn + 0.15 * E - 0.2 * w.monet + 0.25 * w.hopper + 0.25 * w.kandinsky + 0.25 * w.matisse - 0.1 * w.film, 0.7, 1.6);
  st.temp = clamp(W * 0.7 + TIME_TEMP[light], -1, 1);
  st.lift = clamp(0.04 + 0.14 * w.film + 0.08 * w.monet + 0.05 * w.ma - 0.04 * Tn - 0.08 * w.matisse, 0, 0.3);
  st.grain = clamp(0.025 + 0.16 * w.film + 0.05 * w.hopper + 0.04 * w.monet + 0.05 * vintage, 0, 0.25);
  st.grainSize = 1 + (1 - M.brightness) * 1.4;
  st.bloom = clamp(0.35 * w.monet + 0.3 * w.film + (light === 'evening' ? 0.12 : 0) + 0.1 * w.matisse);
  st.leak = clamp(w.film * 0.9 - 0.1);
  st.vig = clamp(0.15 + 0.35 * w.film + 0.35 * w.hopper + (light === 'night' ? 0.25 : 0));
  st.shaft = clamp(w.hopper * 0.9 + (light !== 'night' ? 0.15 * w.monet : 0));
  st.shaftAng = { morning: 0.6, day: 1.2, evening: 2.5, night: 1.9 }[light];
  st.value = (modeSign < 0 ? 0.92 - 0.05 * modeW : 1 + 0.03 * modeSign * modeW) * (light === 'night' ? 0.94 : 1);
  st.edgeSoft = clamp(w.monet + w.ma * 0.9);
  st.air = clamp(0.12 + 0.35 * (1 - E) + (modeSign < 0 ? 0.12 : 0) + 0.25 * w.ma + 0.15 * w.hopper - 0.2 * w.matisse);
  st.motion = 0.25 + E * 0.9;
  st.pulse = 0.015 + 0.06 * E * clamp(M.pulse ?? 0.5);
  st.shotBeats = E > 0.72 ? 4 : E > 0.45 ? 8 : 16;
  st.transition = TECH[primary].trans;
  st.transDur = TRANS_DUR[st.transition] * (st.transition === 'cut' ? 1 : 1.2 - E * 0.5);
  st.kbRange = 0.05 + 0.1 * (1 - E);
  st.tilt = primary === 'film' || primary === 'matisse' ? (1 - Tn) * 0.05 : 0;
  st.titleWeight = Math.round(clamp(300 + 560 * clamp(0.55 * E + 0.65 * Tn - 0.1), 300, 860));
  st.titleItalic = (w.film + w.monet * 0.6 + N * 0.4) > 0.55 && Tn < 0.45;
  st.titleUpper = primary === 'kandinsky';
  st.tracking = primary === 'kandinsky' ? 0.05 : primary === 'ma' ? 0.02 : 0;
  st.titleSize = Math.round(74 + 12 * E * (primary === 'kandinsky' ? 1.4 : 1) - 8 * st.air);

  // palette: from the photos, shifted by temperature, saturation and the song's mode
  const pal = P.palette.map(c => {
    let [hh, s, l] = rgbToHsl(...c.rgb);
    hh = hueLerp(hh, st.temp >= 0 ? 32 : 218, Math.abs(st.temp) * 0.3);
    return hslToRgb(hh, clamp(s * (0.6 + 0.5 * st.sat) + 0.3 * w.matisse), clamp(l * st.value * (light === 'night' ? 0.88 : 1)));
  }).sort((a, b) => lum(a) - lum(b));
  // hues come from the photos, the tonal ladder from the system: every palette spans dark → light,
  // so the gradient map keeps a readable image even for night shots or pale pastels
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
  const bp = 60 / (M.bpm || 100);
  const shotSec = clamp(st.shotBeats * bp, 2.4, 9);
  const recipe = [];
  const add = (src, sig, rule) => recipe.push({ src, sig, rule });
  // name the colours a person would notice: chromatic clusters first, near-black/white only as a fallback
  const chromatic = P.palette.filter(c => { const [, s, l] = rgbToHsl(...c.rgb); return s > 0.18 && l > 0.14 && l < 0.88 && c.share > 0.04; });
  const colorWords = [...new Set((chromatic.length ? chromatic : P.palette).slice(0, 2).map(c => colorName(c.rgb)))].join(' и ');
  add('Фото', `${P.n} ${plural(P.n, 'снимок', 'снимка', 'снимков')}, главные цвета — ${colorWords}`,
    `палитра собрана из ваших фото и сдвинута ${st.temp > 0.08 ? 'в тепло' : st.temp < -0.08 ? 'в холод' : 'нейтрально'} (${signed(st.temp)})`);
  add('Фото', P.n === 1 ? 'один кадр' : `${P.n} ${plural(P.n, 'кадр', 'кадра', 'кадров')}`,
    P.n === 1 ? 'один кадр — медленный наезд на всё воспоминание' : `кадры идут по ритму песни, все успевают прозвучать за 30 секунд`);
  const valWord = V > 0.35 ? 'светлое' : V > 0.08 ? 'скорее светлое' : V > -0.15 ? 'смешанное' : V > -0.4 ? 'приглушённое' : 'тяжёлое';
  const enWord = E > 0.7 ? 'очень живое' : E > 0.5 ? 'живое' : E > 0.32 ? 'спокойное' : 'тихое';
  add('Текст', T.hits?.length ? `«${T.hits.slice(0, 3).join('», «')}»` : 'тон записи',
    `настроение записи: ${valWord}, ${enWord}${Tn > 0.5 ? ', напряжённое' : ''}${overridden ? ' (поправлено вручную)' : ''}`);
  add('Текст', `${TIME_RU[light]}${T.timeExplicit ? '' : ' (по фото)'}`, `свет: ${LIGHT_DESC[light]}`);
  const PLACE_RULE = {
    nature: 'природа усиливает живописные техники', work: 'работа добавляет геометрию и сетку',
    city: 'город добавляет ритм и геометрию', home: 'интерьер добавляет тишины и пустоты', travel: 'дорога добавляет движения',
  };
  if (T.place) add('Текст', `место: ${T.place.nom}`, PLACE_RULE[kind] || 'место задаёт композицию');
  add('Музыка', M.source === 'audio' ? `${M.bpm} BPM` : `≈${M.bpm} BPM (по жанру)`,
    `кадр меняется каждые ${st.shotBeats} ${plural(st.shotBeats, 'долю', 'доли', 'долей')} ≈ ${shotSec.toFixed(1)} с; переход — ${TRANS_RU[st.transition]}`);
  if (modeSign) add('Музыка', M.key, modeSign < 0
    ? `минор: −${Math.round((1 - st.value) * 100)}% яркости и больше воздуха (${pct(st.air)})`
    : `мажор: светлее, композиция плотнее (воздух ${pct(st.air)})`);
  add('Музыка', `энергия ${pct(M.energy)}`, `пульсация кадра на долю ${(st.pulse * 100).toFixed(1)}%, скорость мазков ×${f2(st.flowSpeed)}`);
  if (M.source === 'audio') add('Музыка', `тембр ${M.brightness > 0.5 ? 'яркий' : 'глухой'} (${M.centroid} Гц)`, `зерно ${st.grainSize > 1.7 ? 'крупное' : 'мелкое'}, ${M.brightness > 0.5 ? 'края чётче' : 'края мягче'}`);
  if (era) add('Музыка', `${meta.year}${meta.genre ? ', ' + meta.genre : ''}`, `${era.ru}: ${era.texture}`);
  // when signals disagree we don't average them: each keeps its own layer
  const musicUp = M.energy > 0.55 || (modeSign > 0 && modeW > 0.4);
  const musicDown = M.energy < 0.4 && modeSign < 0;
  if (T.valence < -0.1 && musicUp) add('Спор', 'грустный текст, живая песня', 'палитра остаётся приглушённой (её задаёт текст), а движение живым (его задаёт музыка) — так выглядит горько-сладкий день');
  else if (T.valence > 0.25 && musicDown) add('Спор', 'светлый текст, тихая минорная песня', 'палитра тёплая (из текста и фото), но кадры текут медленно (из музыки) — нежная ностальгия');
  add('Система', w[secondary] >= 0.05 ? `${TECH[primary].name} ${pct(w[primary])} + ${TECH[secondary].name} ${pct(w[secondary])}` : `${TECH[primary].name} ${pct(w[primary])}`, TECH[primary].why);
  add('Голос', voice.slot === 'A' ? 'мягкий голос' : 'собранный голос', voice.why);
  if (day.meta?.ambient?.length) add('Звук', day.meta.ambient.map(k => AMBIENT_RU[k]).join(' + '), 'тихий фон под песней — из слов вашей записи');
  if (Wx) add('Погода', `${Wx.city}: ${Wx.text}, ${Math.round(Wx.tmax)}°`, 'реальная погода этого дня в штампе даты и в тепле палитры');

  return { mood, weights: w, scores, primary, secondary, style: st, recipe, voice, photo: P };
}
