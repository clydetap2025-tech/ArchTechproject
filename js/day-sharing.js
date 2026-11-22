import { MOOD_LABELS, moodOf } from './mood.js';
import { rgbHex } from './util.js';
import { ui, localized, translate } from './i18n.js';

export const visibilityLabels = {
  private: 'Только я', atmosphere: 'Друзья видят атмосферу', full: 'Друзья видят день целиком',
};
export const visibilityOf = value => Object.hasOwn(visibilityLabels, value) ? value : 'private';

const conditions = {
  clear: 'ясно', cloudy: 'облачно', fog: 'туман', rain: 'дождь', drizzle: 'морось', snow: 'снег', storm: 'гроза',
};

export function makeFingerprint(day, comp) {
  const weather = day.inputs.weather;
  const condition = Object.keys(conditions).find(key => conditions[key] === weather?.text);
  const colors = comp.style.palette.slice(0, 5).map(color => rgbHex(color.map(Math.round)));
  while (colors.length < 5) colors.push(colors.at(-1) || '#25392f');
  return {
    palette: colors, bpm: day.inputs.music.bpm, mood_v: comp.mood.V, mood_e: comp.mood.E,
    mood_label: moodOf(comp.mood), weather: { condition, temperature: weather?.temperature ?? weather?.tmax },
  };
}

export const moodMessage = label => ui(MOOD_LABELS[label] || MOOD_LABELS.quiet);
export function sharedWeather(summary) {
  return localized(() => [
    conditions[summary?.condition] && translate(conditions[summary.condition]),
    Number.isFinite(summary?.temperature) && summary.temperature + '°C',
  ].filter(Boolean).join(' · ') || translate('Погода не добавлена'));
}
