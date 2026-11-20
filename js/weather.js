import { todayISO } from './util.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum';
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const PHOTOS = { winter: 'winterForest', autumn: 'autumnAlley', spring: 'villageGarden', summer: 'seaHorizon', rain: 'rainWindow' };

export function landscapeURL(scene) {
  return new URL(`../demo/photos/${PHOTOS[scene] || PHOTOS.summer}.jpg`, import.meta.url).href;
}

async function getJSON(endpoint, params) {
  const response = await fetch(endpoint + '?' + new URLSearchParams(params), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Погодный сервис временно недоступен');
  return response.json();
}

function weatherText(code) {
  if (SNOW.has(code)) return 'снег';
  if (code >= 95) return 'гроза';
  if (RAIN.has(code)) return code < 61 ? 'морось' : 'дождь';
  if (code === 45 || code === 48) return 'туман';
  return code === 0 ? 'ясно' : 'облачно';
}

export function seasonAt(date, hemisphere) {
  const month = Number(date?.slice(5, 7));
  if (month < 1 || month > 12 || !month) return 'summer';
  const offset = hemisphere === 'south' ? 6 : 0;
  return ['winter', 'spring', 'summer', 'autumn'][Math.floor(((month + offset) % 12) / 3)];
}

export function atmosphere(date, weather, entry) {
  const season = (entry?.seasonExplicit && entry.season) || seasonAt(weather?.date || date, weather?.hemisphere);
  const snowing = weather ? SNOW.has(weather.code) || weather.snowfall > 0 : entry?.weather === 'snow';
  const raining = weather ? RAIN.has(weather.code) : entry?.weather === 'rain';
  const snowy = snowing || weather?.snowDepth > 0.01;
  return { season, scene: snowy ? 'winter' : raining && season !== 'autumn' ? 'rain' : season,
    motion: snowing ? 'snow' : raining ? 'rain' : season === 'autumn' && !snowy ? 'leaves' : 'still' };
}

export function deviceLocation() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(new Error('Местоположение доступно на HTTPS или localhost'));
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      resolve({ latitude: coords.latitude, longitude: coords.longitude });
    }, error => {
      const messages = { 1: 'Доступ к местоположению закрыт', 2: 'Устройство не определило местоположение', 3: 'Не удалось определить местоположение вовремя' };
      reject(new Error(messages[error.code] || 'Местоположение недоступно'));
    }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
  });
}

export async function fetchWeatherAt(location, date) {
  const { latitude, longitude, city = null } = location;
  // A coarse location is sufficient for a forecast, and is never stored in the diary.
  const params = { latitude: latitude.toFixed(1), longitude: longitude.toFixed(1), timezone: 'auto' };
  const hemisphere = latitude < 0 ? 'south' : 'north';
  if (!date) {
    const data = await getJSON(FORECAST, { ...params, current: 'temperature_2m,weather_code,snowfall', hourly: 'snow_depth', forecast_days: 1 });
    const current = data.current;
    if (!Number.isFinite(current?.weather_code)) throw new Error('Нет данных о текущей погоде');
    const localHour = current.time.slice(0, 13) + ':00';
    const hour = data.hourly?.time?.indexOf(localHour);
    return { city, date: current.time.slice(0, 10), hemisphere, code: current.weather_code,
      text: weatherText(current.weather_code), temperature: current.temperature_2m, snowfall: current.snowfall,
      snowDepth: hour >= 0 ? data.hourly.snow_depth?.[hour] : null };
  }

  const age = (Date.parse(todayISO()) - Date.parse(date)) / 86400000;
  const data = await getJSON(age > 60 ? ARCHIVE : FORECAST, { ...params, daily: DAILY, start_date: date, end_date: date });
  const daily = data.daily;
  const code = daily?.weather_code?.[0];
  if (!Number.isFinite(code)) throw new Error('Нет данных о погоде за эту дату');
  return { city, date, hemisphere, code, text: weatherText(code), tmax: daily.temperature_2m_max[0],
    tmin: daily.temperature_2m_min[0], snowfall: daily.snowfall_sum?.[0] };
}

export async function fetchWeatherByCity(city, date) {
  const data = await getJSON('https://geocoding-api.open-meteo.com/v1/search', { name: city, count: 1, language: 'ru' });
  const match = data.results?.[0];
  if (!match) throw new Error('Город не найден');
  return fetchWeatherAt({ latitude: match.latitude, longitude: match.longitude, city: match.name }, date);
}

export function weatherLabel(weather) {
  if (!weather) return '';
  const temperature = weather.temperature ?? weather.tmax;
  return [weather.city, weather.text, Number.isFinite(temperature) ? `${Math.round(temperature)}°C` : ''].filter(Boolean).join(' · ');
}
