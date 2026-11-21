// The song: link parsing, official 30-second previews (iTunes Search API), and a description-based
// fallback when no audio can be analysed. We never store someone else's song — only the link,
// the preview URL and the analysed "fingerprint".
import { decodeAudio, analyzeAudio } from './audio.js';
import { norm } from './util.js';
import { photoTrack } from './photo-tracks.js';

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

function photoMusicSearch({ lum, contrast, sat, warmth }) {
  if (lum < .28) return { genre: 'Piano', queries: ['piano nocturne', 'quiet piano'],
    tracks: ['night-docks', 'evening-fall', 'space-jazz', 'hard-boiled'],
    reason: 'Тени на фото подсказали камерное фортепиано и ночной джаз.' };
  if (sat > .48 && contrast > .19) return { genre: 'Jazz', queries: ['jazz swing instrumental', 'jazz piano'],
    tracks: ['casa-bossa', 'carefree', 'hard-boiled', 'space-jazz'],
    reason: 'Насыщенные цвета и контраст подсказали музыку с заметным ритмом.' };
  if (warmth > .065) return { genre: 'Acoustic folk', queries: ['acoustic guitar instrumental', 'folk guitar instrumental'],
    tracks: ['clear-air', 'laid-back-guitars', 'easy-lemon', 'carefree'],
    reason: 'К тёплой палитре подошла акустическая гитара.' };
  return { genre: 'Piano', queries: ['quiet piano', 'piano nocturne'],
    tracks: ['gymnopedie', 'dream-culture', 'luminous-rain', 'cool-vibes'],
    reason: 'Ровному свету и сдержанным цветам подошла мягкая инструментальная музыка.' };
}

export function suggestMusicForPhotos(stats) {
  const { tracks, reason } = photoMusicSearch(stats);
  return tracks.map(id => photoTrack(id, reason));
}

function metadataText(field) {
  const fragment = document.createElement('template');
  fragment.innerHTML = field?.value || '';
  return fragment.content.textContent.replace(/\s+/g, ' ').trim();
}

async function commonsTracks(query, genre, signal) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrnamespace: '6', gsrlimit: '18',
    gsrsearch: 'filetype:audio ' + query, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
    format: 'json', formatversion: '2', origin: '*',
  });
  const response = await fetch('https://commons.wikimedia.org/w/api.php?' + params, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
  });
  if (!response.ok) return [];
  const { query: result } = await response.json();
  return (result?.pages || []).flatMap(page => {
    const file = page.imageinfo?.[0];
    if (!file?.url?.startsWith('https://upload.wikimedia.org/wikipedia/commons/') ||
        !file.descriptionurl?.startsWith('https://commons.wikimedia.org/wiki/File:') ||
        file.size < 180000 || file.size > 9 * 1024 * 1024 ||
        !/\.(mp3|ogg|oga|opus|wav)$/i.test(new URL(file.url).pathname)) return [];
    const license = metadataText(file.extmetadata?.LicenseShortName);
    const artist = metadataText(file.extmetadata?.Artist).slice(0, 160);
    const licenseUrl = metadataText(file.extmetadata?.LicenseUrl);
    const licensed = /^(?:CC0|Public domain)$/i.test(license) ||
      (artist && /^CC BY [0-9]/i.test(license) && /^https:\/\/creativecommons\.org\/licenses\/by\//.test(licenseUrl));
    if (!licensed) return [];
    const preview = new URL(file.url);
    preview.search = '';
    const title = page.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').slice(0, 140);
    return [{
      artist, title, genre, license, licenseUrl: /^https:\/\/creativecommons\.org\//.test(licenseUrl) ? licenseUrl : null,
      previewUrl: preview.href, trackViewUrl: file.descriptionurl, source: 'Wikimedia Commons',
      rank: (page.index || 1) - (file.mime === 'audio/mpeg' ? 6 : 0),
    }];
  }).sort((a, b) => a.rank - b.rank);
}

export async function findMusicForPhotos(stats, cancellation = new AbortController().signal) {
  const { queries, genre, reason } = photoMusicSearch(stats);
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(22000)]);
  const trySong = async song => {
    try {
      const buffer = await loadSongBuffer(song, signal);
      if (buffer?.duration >= 12 && buffer.duration <= 600) {
        const music = analyzeAudio(buffer);
        if (music) return { song, music };
      }
    } catch (error) {
      signal.throwIfAborted();
      console.warn('Music candidate unavailable', error);
    }
    return null;
  };
  for (const song of suggestMusicForPhotos(stats)) {
    signal.throwIfAborted();
    const result = await trySong({ ...song, autoPicked: true });
    if (result) return result;
  }
  const tried = new Set();
  for (const query of queries) {
    signal.throwIfAborted();
    const candidates = await commonsTracks(query, genre, signal).catch(error => {
      signal.throwIfAborted();
      console.warn('Music catalogue unavailable', error);
      return [];
    });
    for (const candidate of candidates.slice(0, 5)) {
      if (tried.has(candidate.previewUrl)) continue;
      tried.add(candidate.previewUrl);
      const { rank, ...meta } = candidate;
      const song = { link: meta.trackViewUrl, query: [meta.artist, meta.title].filter(Boolean).join(' — '),
        service: meta.source, meta, autoPicked: true, reason };
      const result = await trySong(song);
      if (result) return result;
    }
  }
  throw new Error('Не удалось найти доступную музыку по фото. Попробуйте снова или укажите свою песню');
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

export async function loadSongBuffer(song, signal) {
  const key = song.fileBlob ? 'file:' + (song.fileName || '') + song.fileBlob.size : song.meta?.previewUrl;
  if (!key) return null;
  if (audioCache.has(key)) return audioCache.get(key);
  let ab;
  if (song.fileBlob) ab = await song.fileBlob.arrayBuffer();
  else {
    const timeout = AbortSignal.timeout(8500);
    const r = await fetch(https(song.meta.previewUrl), { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
    if (!r.ok) throw new Error('preview ' + r.status);
    ab = await r.arrayBuffer();
  }
  signal?.throwIfAborted();
  const buf = await decodeAudio(ab);
  signal?.throwIfAborted();
  if (audioCache.size >= 3) audioCache.delete(audioCache.keys().next().value);
  audioCache.set(key, buf);
  return buf;
}

export async function analyzeSong(song, signal) {
  try {
    const buf = await loadSongBuffer(song, signal);
    if (buf) { const f = analyzeAudio(buf); if (f) return f; }
  } catch (e) {
    signal?.throwIfAborted();
    console.warn('audio analysis failed', e);
  }
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
