// lib/tile/canonicalRoomTypes.js

function normalizeRoomType(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[&]/g, 'and')
    .replace(/[\s\-]+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!s) return 'room';

  const aliases = new Map([
    ['living', 'living_room'],
    ['livingroom', 'living_room'],
    ['great_room', 'living_room'],
    ['family_room', 'living_room'],
    ['dining', 'dining_room'],
    ['diningroom', 'dining_room'],
    ['study_room', 'study'],
    ['office', 'study'],
    ['office_room', 'study'],
    ['home_office', 'study'],
    ['game_room', 'gaming_room'],
    ['play_room', 'playroom'],
    ['gaming', 'gaming_room'],
    ['media_room', 'movie_room'],
    ['home_theater', 'movie_room'],
    ['theater_room', 'movie_room'],
    ['library_room', 'library'],
    ['book_room', 'library'],
    ['gym_room', 'gym'],
    ['home_gym', 'gym'],
    ['exercise_room', 'gym'],
    ['workout_room', 'gym'],
    ['wine_room', 'wine_cellar'],
    ['cellar', 'wine_cellar'],
    ['wine_storage', 'wine_cellar'],
    ['music_studio', 'music_room'],
    ['recording_room', 'music_room'],
    ['playroom', 'playroom'],
    ['bonus_loft', 'loft'],
    ['flex_room', 'loft'],
    ['game_room', 'gaming_room'],
    ['powder', 'powder_room'],
    ['powderroom', 'powder_room'],
    ['half_bath', 'powder_room'],
    ['half_bathroom', 'powder_room'],
    ['wc', 'powder_room'],
    ['full_bath', 'bathroom'],
    ['full_bathroom', 'bathroom'],
    ['guest_bath', 'bathroom'],
    ['guest_bathroom', 'bathroom'],
    ['shared_bath', 'bathroom'],
    ['shared_bathroom', 'bathroom'],
    ['master_bedroom', 'primary_bedroom'],
    ['master_bed', 'primary_bedroom'],
    ['primary_suite', 'primary_bedroom'],
    ['master_bath', 'primary_bathroom'],
    ['master_bathroom', 'primary_bathroom'],
    ['primary_bath', 'primary_bathroom'],
    ['ensuite', 'primary_bathroom'],
    ['en_suite', 'primary_bathroom'],
    ['guest_room', 'guest_bedroom'],
    ['guest_bed', 'guest_bedroom'],
    ['foyer', 'entry'],
    ['entryway', 'entry'],
    ['mud_room', 'mudroom'],
    ['laundry_room', 'laundry'],
    ['walk_in_closet', 'closet'],
    ['walkin_closet', 'closet'],
    ['reach_in_closet', 'closet'],
    ['storage_room', 'storage'],
    ['covered_porch', 'covered_porch'],
    ['open_deck', 'open_deck'],
    ['screened_porch', 'screened_porch'],
    ['patio', 'patio'],
    ['porch', 'covered_porch'],
    ['deck', 'open_deck'],
    ['veranda', 'covered_porch'],
    ['lanai', 'screened_porch'],
    ['sunroom', 'screened_porch'],
  ]);

  if (aliases.has(s)) return aliases.get(s);

  if (s.includes('master_bed') || s.includes('primary_bed')) return 'primary_bedroom';
  if (s.includes('guest_bed')) return 'guest_bedroom';
  if (s.includes('bedroom')) return 'bedroom';
  if (s.includes('master_bath') || s.includes('primary_bath') || s.includes('ensuite') || s.includes('en_suite')) return 'primary_bathroom';
  if (s.includes('powder')) return 'powder_room';
  if (s.includes('bath')) return 'bathroom';
  if (s.includes('play_room') || s.includes('playroom')) return 'playroom';
  if (s.includes('gaming') || s.includes('game_room')) return 'gaming_room';
  if (s.includes('movie') || s.includes('theater') || s.includes('media_room')) return 'movie_room';
  if (s.includes('library')) return 'library';
  if (s.includes('gym') || s.includes('exercise') || s.includes('workout')) return 'gym';
  if (s.includes('study') || s.includes('office')) return 'study';
  if (s.includes('loft')) return 'loft';
  if (s.includes('wine') || s.includes('cellar')) return 'wine_cellar';
  if (s.includes('music') || s.includes('recording')) return 'music_room';
  if (s.includes('porch')) return 'covered_porch';
  if (s.includes('deck')) return 'open_deck';
  if (s.includes('patio')) return 'patio';
  if (s.includes('lanai') || s.includes('sunroom')) return 'screened_porch';
  if (s.includes('living')) return 'living_room';
  if (s.includes('dining')) return 'dining_room';
  if (s.includes('mudroom') || s.includes('mud_room')) return 'mudroom';
  if (s.includes('laundry')) return 'laundry';

  return s;
}

function isBedroomType(type) {
  const t = normalizeRoomType(type);
  return t === 'primary_bedroom' || t === 'bedroom' || t === 'guest_bedroom';
}

function isBathroomType(type) {
  const t = normalizeRoomType(type);
  return t === 'bathroom' || t === 'primary_bathroom' || t === 'powder_room';
}

function isPublicRoomType(type) {
  const t = normalizeRoomType(type);
  return ['entry', 'living_room', 'dining_room', 'kitchen', 'loft'].includes(t);
}

function isOutdoorType(type) {
  const t = normalizeRoomType(type);
  return ['covered_porch', 'open_deck', 'screened_porch', 'patio'].includes(t);
}

function isCirculationType(type) {
  const t = normalizeRoomType(type);
  return ['hallway', 'stairs', 'entry'].includes(t);
}

function getFeatureKey(type) {
  const t = normalizeRoomType(type);
  if (t === 'study') return 'study';
  if (t === 'gaming_room') return 'gaming_room';
  if (t === 'guest_bedroom') return 'guest_bedroom';
  if (t === 'gym') return 'gym';
  if (t === 'library') return 'library';
  if (t === 'movie_room') return 'movie_room';
  if (t === 'wine_cellar') return 'wine_cellar';
  if (t === 'music_room') return 'music_room';
  return t;
}

function roomTypeToDisplayBase(type) {
  const t = normalizeRoomType(type);
  switch (t) {
    case 'primary_bedroom': return 'Primary Bedroom';
    case 'primary_bathroom': return 'Primary Bathroom';
    case 'bedroom': return 'Bedroom';
    case 'guest_bedroom': return 'Guest Bedroom';
    case 'bathroom': return 'Bathroom';
    case 'powder_room': return 'Powder Room';
    case 'living_room': return 'Living Room';
    case 'dining_room': return 'Dining Room';
    case 'gaming_room': return 'Gaming Room';
    case 'playroom': return 'Playroom';
    case 'study': return 'Study';
    case 'loft': return 'Loft';
    case 'gym': return 'Gym';
    case 'library': return 'Library';
    case 'movie_room': return 'Movie Room';
    case 'wine_cellar': return 'Wine Cellar';
    case 'music_room': return 'Music Room';
    case 'garage': return 'Garage';
    case 'stairs': return 'Stairs';
    case 'hallway': return 'Hallway';
    case 'kitchen': return 'Kitchen';
    case 'laundry': return 'Laundry';
    case 'mudroom': return 'Mudroom';
    case 'storage': return 'Storage';
    case 'entry': return 'Entry';
    case 'closet': return 'Closet';
    case 'covered_porch': return 'Covered Porch';
    case 'open_deck': return 'Open Deck';
    case 'screened_porch': return 'Screened Porch';
    case 'patio': return 'Patio';
    default:
      return String(t || 'Room')
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

function roomDisplayBase(room) {
  const explicit = String(room?.requestedFeatureLabel || room?.label || '').trim();
  if (explicit && !room?.openConcept) return explicit;
  return roomTypeToDisplayBase(room?.type);
}

function makeDisplayLabels(planSpec) {
  const counts = new Map();
  for (const lvl of planSpec.levels || []) {
    for (const room of lvl.rooms || []) {
      const t = normalizeRoomType(room.type);
      const base = roomDisplayBase({ ...room, type: t });
      const countKey = (t === 'bedroom' || t === 'bathroom') ? t : `label:${base}`;
      counts.set(countKey, (counts.get(countKey) || 0) + 1);
    }
  }
  const running = new Map();
  for (const lvl of planSpec.levels || []) {
    for (const room of lvl.rooms || []) {
      // Open-concept rooms carry their own label — preserve it
      if (room.openConcept && room.label) {
        room.type = normalizeRoomType(room.type);
        continue;
      }
      const t = normalizeRoomType(room.type);
      const base = roomDisplayBase({ ...room, type: t });
      const countKey = (t === 'bedroom' || t === 'bathroom') ? t : `label:${base}`;
      running.set(countKey, (running.get(countKey) || 0) + 1);
      const idx = running.get(countKey);
      const total = counts.get(countKey) || 1;
      let label = base;
      const bedroomIdentity = /^bedroom_(\d+)$/.exec(String(room.programId || ''));
      if (t === 'bedroom' && bedroomIdentity) label = `Bedroom ${bedroomIdentity[1]}`;
      else if (t === 'bedroom' && total > 1) label = `Bedroom ${idx}`;
      if (t === 'bathroom' && total > 1) label = `Bathroom ${idx}`;
      const featureIdentity = /^feature_.+_(\d+)$/.exec(String(room.programId || ''));
      if (t !== 'bedroom' && t !== 'bathroom' && total > 1) label = `${base} ${featureIdentity ? featureIdentity[1] : idx}`;
      room.type = t;
      room.label = label;
    }
  }
  return planSpec;
}

module.exports = {
  normalizeRoomType,
  isBedroomType,
  isBathroomType,
  isPublicRoomType,
  isOutdoorType,
  isCirculationType,
  getFeatureKey,
  roomTypeToDisplayBase,
  roomDisplayBase,
  makeDisplayLabels,
};
