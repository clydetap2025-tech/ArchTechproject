// Reading the diary entry: mood axes, time, season, place, people, sensory anchors, folder title.
// Works offline with a local lexicon and deterministic rules.

import {
  LEX, TIME_STEMS, SEASON_STEMS, WEATHER_STEMS, PLACES, WHO, EVENTS, WEAK_EVENTS, DETAILS,
  SENSORY, AMBIENT_STEMS, TIME_NOUNS, SEASON_ADJ, WEATHER_ADJ,
} from './lexicon.js';
import { norm, tokenize, clamp, wordCount, capitalize, parseISO } from './util.js';

const matchTok = (tok, stem) => (stem[0] === '=' ? tok === stem.slice(1) : tok.startsWith(stem));

function firstIndex(tokens, ntext, stems) {
  let best = Infinity;
  for (const s of stems) {
    if (s.includes(' ')) {
      const i = ntext.indexOf(s);
      if (i >= 0) best = Math.min(best, tokenize(ntext.slice(0, i)).length);
    } else {
      const i = tokens.findIndex(t => matchTok(t, s));
      if (i >= 0) best = Math.min(best, i);
    }
  }
  return best;
}

function countMatches(tokens, ntext, stems) {
  let n = 0;
  for (const s of stems) {
    if (s.includes(' ')) { if (ntext.includes(s)) n++; }
    else n += tokens.filter(t => matchTok(t, s)).length;
  }
  return n;
}

const pickEarliest = (tokens, ntext, list) => {
  let best = null, bi = Infinity;
  for (const e of list) { const i = firstIndex(tokens, ntext, e.stems); if (i < bi) { bi = i; best = e; } }
  return best;
};
const pickFirstInList = (tokens, ntext, list) => list.find(e => firstIndex(tokens, ntext, e.stems) < Infinity) || null;

function seasonFromDate(iso) {
  const m = parseISO(iso).getMonth();
  return [11, 0, 1].includes(m) ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
}

export function splitPhrases(text) {
  return String(text)
    .split(/[.!?…;\n]+/)
    .flatMap(s => s.split(/,(?!\s*(?:что|как|будто|словно|чтобы|когда|где|который|которая|которые|которое)\s)|\s[—–-]\s|\sно\s/i))
    .map(s => s.trim().replace(/^(и|а|но)\s+/i, ''))
    .filter(s => s.length > 1);
}

function sensoryOf(tokens) {
  const found = [];
  tokens.forEach((tok, i) => {
    for (const [stems, sense] of SENSORY) if (stems.some(s => matchTok(tok, s))) { found.push({ i, sense }); break; }
  });
  return found;
}

const lowerFirst = s => (s && s[1] && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s);

function trimWords(phrase, max, centerIdx = 0) {
  const words = phrase.split(/\s+/);
  if (words.length <= max) return phrase;
  const start = centerIdx < max ? 0 : words.length - max;
  return words.slice(start, start + max).join(' ');
}

export function analyzeText(text, dateISO) {
  const nt = norm(text);
  const toks = tokenize(text);
  const sums = { v: 0, e: 0, w: 0, t: 0, s: 0, n: 0 };
  const hits = [];

  toks.forEach((tok, i) => {
    for (const [stems, wts] of LEX) {
      if (!stems.some(s => matchTok(tok, s))) continue;
      const neg = i > 0 && ['не', 'без', 'ни'].includes(toks[i - 1]);
      for (const k in wts) sums[k] += neg ? (k === 'v' ? -wts[k] * 0.7 : wts[k] * 0.3) : wts[k];
      hits.push({ word: (neg ? 'не ' : '') + tok, w: wts, neg });
      break;
    }
  });
  const excl = (text.match(/!/g) || []).length;
  sums.e += Math.min(excl, 3) * 0.15;
  const ell = (text.match(/\.\.\.|…/g) || []).length;
  sums.e -= ell * 0.1; sums.n += ell * 0.1;

  const valence = Math.tanh(sums.v / 1.6);
  const energy = clamp(0.45 + 0.5 * Math.tanh(sums.e / 1.6));
  const warmth = Math.tanh(sums.w / 1.5);
  const tension = clamp(Math.tanh(sums.t / 1.4));
  const social = Math.tanh(sums.s / 1.2);
  const nostalgia = clamp(Math.tanh(sums.n / 1.2));

  // time of day
  let timeOfDay = null, best = 0;
  for (const [k, stems] of Object.entries(TIME_STEMS)) {
    const c = countMatches(toks, nt, stems) * (k === 'night' ? 1.3 : 1);
    if (c > best) { best = c; timeOfDay = k; }
  }
  const timeExplicit = !!timeOfDay;

  // season
  let season = null; best = 0;
  for (const [k, stems] of Object.entries(SEASON_STEMS)) {
    const c = countMatches(toks, nt, stems);
    if (c > best) { best = c; season = k; }
  }
  const seasonExplicit = !!season;
  if (!season) season = seasonFromDate(dateISO);

  let weather = null;
  for (const [k, stems] of Object.entries(WEATHER_STEMS)) if (countMatches(toks, nt, stems) > 0) { weather = k; break; }

  const place = pickEarliest(toks, nt, PLACES);
  const who = pickEarliest(toks, nt, WHO);
  const event = pickFirstInList(toks, nt, EVENTS);
  const weak = pickFirstInList(toks, nt, WEAK_EVENTS);
  const detail = pickFirstInList(toks, nt, DETAILS);

  // caption + sensory margin notes, always the user's own words
  const phrases = splitPhrases(text);
  // Caption: people usually end a story with how it felt, so later phrases weigh more.
  const scored = phrases.map((p, i) => {
    const tk = tokenize(p);
    let sc = 0;
    for (const tok of tk) for (const [stems, w] of LEX) if (stems.some(s => matchTok(tok, s))) {
      sc += 0.5 * Math.abs(w.v || 0) + 0.4 * Math.max(w.w || 0, 0) + 0.4 * Math.max(w.s || 0, 0); break;
    }
    const sens = sensoryOf(tk);
    sc += sens.length * 0.2;
    if (tk.length >= 3 && tk.length <= 9) sc += 0.8;
    if (tk.length <= 2) sc -= 0.4;
    if (tk.length > 10) sc -= 1;
    sc += (i / Math.max(1, phrases.length - 1)) * 1.2;
    return { p, sc, tk, sens };
  });
  const capPick = [...scored].sort((a, b) => b.sc - a.sc)[0];
  const caption = capPick ? lowerFirst(trimWords(capPick.p, 9)) : '';
  const usedSenses = new Set();
  const sensory = scored
    .filter(x => x !== capPick && x.sens.length)
    .sort((a, b) => (b.sens.length + (b.tk.length >= 2 ? 1 : 0)) - (a.sens.length + (a.tk.length >= 2 ? 1 : 0)))
    .filter(x => { const s = x.sens[0].sense; if (usedSenses.has(s)) return false; usedSenses.add(s); return true; })
    .slice(0, 3)
    .map(x => {
      let p = x.p;
      if (p.split(/\s+/).length > 7) {
        const parts = p.split(/\s+и\s+/);
        p = parts.find(part => sensoryOf(tokenize(part)).length) || p;
      }
      const si = sensoryOf(tokenize(p))[0]?.i ?? 0;
      return lowerFirst(trimWords(p, 7, si));
    });

  // ambient sound layers named by the entry
  const amb = Object.entries(AMBIENT_STEMS)
    .map(([k, stems]) => [k, countMatches(toks, nt, stems)])
    .filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  let ambient = amb.slice(0, 2);
  if (!ambient.length) {
    if (place?.kind === 'nature' && (season === 'spring' || season === 'summer')) ambient = ['birds'];
    else if (place?.kind === 'nature' && season === 'autumn') ambient = ['leaves'];
    else if (place?.kind === 'city') ambient = ['city'];
    else if (place?.kind === 'work') ambient = ['office'];
    else if (season === 'winter') ambient = ['wind'];
  }

  const topHits = [...hits]
    .sort((a, b) => sumAbs(b.w) - sumAbs(a.w))
    .map(h => h.word).filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 4);

  const a = {
    valence, energy, warmth, tension, social, nostalgia,
    timeOfDay, timeExplicit, season, seasonExplicit, weather,
    place: place && { nom: place.nom, g: place.g, loc: place.loc, kind: place.kind },
    who: who?.phrase || null, event: event?.phrase || null, weak: weak?.phrase || null, detail: detail?.nom || null,
    caption, sensory, ambient, hits: topHits, words: wordCount(text), analyzer: 'local',
  };
  a.title = makeTitle(a, dateISO);
  return a;
}

const sumAbs = w => Object.values(w).reduce((s, x) => s + Math.abs(x), 0);

const DRINKS = new Set(['какао', 'чай', 'кофе', 'глинтвейн', 'вино', 'мороженое', 'арбуз', 'пироги', 'торт', 'яблоки', 'шашлыки', 'пицца']);
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

// Folder title rules: 3–7 words, concrete images only, never a named emotion.
// Pattern A: [season] place + "и" + detail  → «Осенний парк и какао»
// Pattern B: [weather|season] time + place + who/event → «Ночь в офисе перед сдачей»
export function makeTitle(a, dateISO) {
  const adjFor = g => {
    if (a.weather && WEATHER_ADJ[a.weather]) return WEATHER_ADJ[a.weather][g];
    if (a.seasonExplicit || a.place?.kind === 'nature') return SEASON_ADJ[a.season]?.[g] || null;
    return null;
  };
  let parts;
  if (a.place && a.detail && !a.timeExplicit && !a.who && !a.event) {
    parts = { adj: adjFor(a.place.g), head: a.place.nom, g: a.place.g, loc: null, tail: 'и ' + a.detail };
  } else {
    const head = a.timeExplicit ? TIME_NOUNS[a.timeOfDay] : a.place ? { w: a.place.nom, g: a.place.g, isPlace: true } : TIME_NOUNS.day;
    let weak = a.weak;
    if (weak && a.weather === 'rain' && weak.includes('дожд')) weak = null;
    if (weak && a.weather === 'snow' && weak.includes('снег')) weak = null;
    const tail = a.event || a.who || weak || (a.detail && DRINKS.has(a.detail) ? 'и ' + a.detail : null);
    parts = { adj: adjFor(head.g), head: head.w, g: head.g, loc: a.place && !head.isPlace ? a.place.loc : null, tail };
  }
  const join = p => [p.adj, p.head, p.loc, p.tail].filter(Boolean).join(' ');
  let t = join(parts);
  if (wordCount(t) > 7) { parts.adj = null; t = join(parts); }
  if (wordCount(t) > 7) { parts.tail = null; t = join(parts); }
  if (wordCount(t) < 3 && !parts.adj) { parts.adj = SEASON_ADJ[a.season]?.[parts.g] || null; t = join(parts); }
  if (wordCount(t) < 3) t = `${t} в ${MONTHS_PREP[parseISO(dateISO).getMonth()]}`;
  return capitalize(t);
}
