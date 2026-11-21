// Clips from Kevin MacLeod's CC BY 4.0 catalogue. The ISRC links to each original recording.
const tracks = {
  'night-docks': ['Night on the Docks - Piano', 'Jazz', 'USUAN1100135'],
  'evening-fall': ['Evening Fall (Piano)', 'Piano', 'USUAN1100235'],
  'hard-boiled': ['Hard Boiled', 'Jazz', 'USUAN1700076'],
  'space-jazz': ['Space Jazz', 'Jazz', 'USUAN2100030'],
  'clear-air': ['Clear Air', 'Acoustic folk', 'USUAN1100626'],
  'laid-back-guitars': ['Laid Back Guitars', 'Acoustic folk', 'USUAN1100181'],
  'easy-lemon': ['Easy Lemon (30 second)', 'Acoustic folk', 'USUAN1200078'],
  'carefree': ['Carefree', 'Pop', 'USUAN1400037'],
  'casa-bossa': ['Casa Bossa Nova', 'Jazz', 'USUAN1600012'],
  'gymnopedie': ['Gymnopédie No. 1', 'Classical', 'USUAN1100787'],
  'dream-culture': ['Dream Culture', 'Piano', 'USUAN1300046'],
  'luminous-rain': ['Luminous Rain', 'Piano', 'USUAN1100169'],
  'cool-vibes': ['Cool Vibes', 'Jazz', 'USUAN1100863'],
};

export function photoTrack(id, reason) {
  const [title, genre, isrc] = tracks[id];
  const artist = 'Kevin MacLeod';
  const service = 'Incompetech';
  const link = 'https://incompetech.com/music/royalty-free/index.html?isrc=' + isrc;
  const meta = {
    title, artist, genre, source: service, trackViewUrl: link, previewUrl: 'demo/music/' + id + '.mp3',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  };
  return { link, query: artist + ' — ' + title, service, meta, photoSuggested: true, reason };
}
