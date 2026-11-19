// The song: link parsing, official 30-second previews (iTunes Search API), and a description-based
// fallback when no audio can be analysed. We never store someone else's song — only the link,
// the preview URL and the analysed "fingerprint".
import { decodeAudio, analyzeAudio } from './audio.js';
import { norm } from './util.js';

export function parseLink(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  const s = [
    [/open\.spotify\.com/i, 'Spotify'], [/music\.yandex\./i, 'Яндекс Музыка'], [/music\.youtube\.com/i, 'YouTube Music'],
    [/(youtube\.com|youtu\.be)/i, 'YouTube'], [/music\.apple\.com/i, 'Apple Music'], [/deezer\.com/i, 'Deezer'],
    [/soundcloud\.com/i, 'SoundCloud'], [/vk\.com|vk\.ru/i, 'VK Музыка'], [/zvuk\.com/i, 'Звук'],
  ].find(([re]) => re.test(u));
  return { url: u, service: s ? s[1] : 'ссылка' };
}

// Best effort: official oEmbed endpoints give a track title for YouTube / Spotify links.
export async function titleFromLink(link) {
  const p = parseLink(link);
  if (!p) return null;
  let endpoint = null;
  if (/youtu/i.test(p.url)) endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(p.url)}`;
  else if (/spotify/i.test(p.url)) endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(p.url)}`;
  if (!endpoint) return null;
  try {
    const r = await fetch(endpoint);
    if (!r.ok) return null;
    const j = await r.json();
    const t = String(j.title || '').replace(/\s*[([].*?(official|video|lyric|audio|клип).*?[)\]]/ig, '').trim();
    if (!t) return null;
    if (/[-—–]/.test(t)) return t;
    return j.author_name ? `${j.author_name.replace(/\s*-\s*Topic$/i, '')} — ${t}` : t;
  } catch { return null; }
}

// on an https site (Vercel) an http:// preview would be blocked as mixed content
const https = u => String(u).replace(/^http:\/\//i, 'https://');

export async function searchSong(query) {
  for (const country of ['us', 'kz']) {
    try {
      const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5&country=${country}`);
      if (!r.ok) continue;
      const j = await r.json();
      // prefer the original artist over covers: overlap of query words with the artist name
      const qt = new Set(norm(query).split(/[^a-zа-я0-9]+/).filter(w => w.length > 1));
      const overlap = s => norm(s).split(/[^a-zа-я0-9]+/).filter(w => qt.has(w)).length;
      const ranked = (j.results || []).filter(x => x.previewUrl)
        .map((x, i) => ({ x, s: overlap(x.artistName) * 2 + overlap(x.trackName) - i * 0.05 }))
        .sort((a, b) => b.s - a.s);
      const t = ranked[0]?.x || (j.results || [])[0];
      if (t) {
        return {
          artist: t.artistName, title: t.trackName,
          year: t.releaseDate ? new Date(t.releaseDate).getFullYear() : null,
          genre: t.primaryGenreName || null, previewUrl: t.previewUrl ? https(t.previewUrl) : null,
          artwork: t.artworkUrl100 ? https(t.artworkUrl100.replace('100x100', '600x600')) : null,
          trackViewUrl: t.trackViewUrl || null, source: 'iTunes',
        };
      }
    } catch { /* offline */ }
  }
  return null;
}

const audioCache = new Map();

export async function loadSongBuffer(song) {
  const key = song.fileBlob ? 'file:' + (song.fileName || '') + song.fileBlob.size : song.meta?.previewUrl;
  if (!key) return null;
  if (audioCache.has(key)) return audioCache.get(key);
  let ab;
  if (song.fileBlob) ab = await song.fileBlob.arrayBuffer();
  else { const r = await fetch(https(song.meta.previewUrl)); if (!r.ok) throw new Error('preview ' + r.status); ab = await r.arrayBuffer(); }
  const buf = await decodeAudio(ab);
  audioCache.set(key, buf);
  return buf;
}

export async function analyzeSong(song) {
  try {
    const buf = await loadSongBuffer(song);
    if (buf) { const f = analyzeAudio(buf); if (f) return f; }
  } catch (e) { console.warn('audio analysis failed', e); }
  return describeFeatures(song.meta);
}

// When audio is unavailable: features from genre + era (the brief allows "at least a description").
const GENRES = [
  [/jazz|vocal|standards|swing|easy listening/i, 92, 0.32, 0.35],
  [/electronic|dance|house|techno|trance|edm|drum/i, 126, 0.82, 0.7],
  [/metal|punk|hard rock/i, 150, 0.92, 0.75],
  [/hip-hop|rap|trap/i, 92, 0.66, 0.55],
  [/r&b|soul|funk|disco/i, 112, 0.66, 0.55],
  [/rock/i, 122, 0.72, 0.6],
  [/alternative|indie/i, 112, 0.55, 0.5],
  [/classical|soundtrack|score|piano|new age|ambient/i, 74, 0.2, 0.3],
  [/country|folk|singer|acoustic|bard|шансон|авторск/i, 100, 0.4, 0.42],
  [/pop|k-pop|j-pop|эстрад/i, 112, 0.62, 0.58],
];

export function describeFeatures(meta) {
  const g = (meta?.genre || '');
  const row = GENRES.find(([re]) => re.test(g)) || [null, 104, 0.5, 0.5];
  return {
    source: 'description', bpm: row[1], beatOffset: 0, mode: null, keyIndex: 0, key: 'тональность неизвестна', keyConf: 0,
    energy: row[2], brightness: row[3], pulse: 0.5, dynamics: 0.4, segStart: 0, segDur: 30, duration: 30, envelope: [],
  };
}

export function eraOf(year) {
  if (!year) return null;
  if (year < 1970) return { key: 'vintage', ru: 'винтаж', texture: 'плёночное зерно и виньетка' };
  if (year < 1990) return { key: 'analog', ru: 'аналоговая эпоха', texture: 'тёплые засветки, мягкий контраст' };
  if (year < 2010) return { key: 'early-digital', ru: 'ранняя цифра', texture: 'чистое изображение, лёгкое зерно' };
  return { key: 'modern', ru: 'современность', texture: 'чистая фактура без зерна' };
}
