// Preserve individual kinds and counts; only a declared old picker version
// permits collapsing its known Study/Home Office alias pair.
export const FEATURE_ROOM_CHOICES = [
    { kind: 'study', value: 'Study', label: 'Study / home office', aliases: ['study'] },
    { kind: 'movie_room', value: 'Home Theater', label: 'Home theater', aliases: ['movie room', 'media room', 'home theater', 'theater room', 'cinema room'] },
    { kind: 'gym', value: 'Gym', label: 'Gym', aliases: ['gym', 'home gym', 'exercise room', 'workout room', 'fitness room'] },
    { kind: 'gaming_room', value: 'Gaming Room', label: 'Gaming room', aliases: ['gaming room', 'game room', 'gaming'] },
    { kind: 'library', value: 'Library', label: 'Library', aliases: ['library', 'library room', 'reading room', 'book room'] },
    { kind: 'wine_cellar', value: 'Wine Cellar', label: 'Wine cellar', aliases: ['wine cellar', 'wine room', 'cellar'] },
    { kind: 'music_room', value: 'Music Room', label: 'Music room', aliases: ['music room', 'music studio', 'recording room', 'music'] },
    { kind: 'guest_bedroom', value: 'Guest Suite', label: 'Guest room', aliases: ['guest bedroom', 'guest room', 'guest suite'] },
    { kind: 'playroom', value: 'Playroom', label: 'Playroom', aliases: ['play room', 'playroom'] },
];
const office = { kind: 'home_office', value: 'Home Office', label: 'Home office', aliases: ['home office', 'office', 'work room'] };
const choices = [...FEATURE_ROOM_CHOICES, office];
const phrase = value => value.toLowerCase().replace(/[.\-_]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\bstudies\b/g, 'study').replace(/\blibraries\b/g, 'library')
    .replace(/\b(rooms|offices|gyms|suites|cellars|theaters|theatres|studios|games)\b/g, word => word.slice(0, -1));

export function parseFeatureSelections(value = '') {
    return String(value).split(/[,;]/).map(raw => raw.trim()).filter(raw => raw && !/^(none|n\/a)$/i.test(raw)).map(raw => {
        const match = /^(\d+)\s+(.*)$/.exec(raw);
        const count = match ? Number(match[1]) : 1;
        const choice = choices.find(item => item.aliases.includes(phrase(match ? match[2] : raw)));
        return { raw, kind: choice && Number.isSafeInteger(count) && count > 0 && count <= 32 ? choice.kind : null, count };
    });
}

export function featureCount(value, kind) {
    return parseFeatureSelections(value).filter(item => item.kind === kind).reduce((sum, item) => sum + item.count, 0);
}

export function featureChoicesFor(value) {
    return featureCount(value, 'home_office') ? [...FEATURE_ROOM_CHOICES, office] : FEATURE_ROOM_CHOICES;
}

export function withFeatureCount(value, kind, count) {
    const choice = choices.find(item => item.kind === kind);
    if (!choice || !Number.isInteger(count) || count < 0 || count > 32) throw new Error('Invalid room count');
    const parts = parseFeatureSelections(value);
    const first = parts.findIndex(item => item.kind === kind);
    const retained = parts.filter(item => item.kind !== kind).map(item => item.raw);
    if (count) retained.splice(first < 0 ? retained.length : first, 0, `${count} ${choice.value}`);
    return retained.join(', ');
}

export function normalizeFeatureSelections(value = '', sourceVersion = null) {
    const parts = String(value).split(/[,;]/).map(part => part.trim()).filter(part => part && !/^(none|n\/a)$/i.test(part));
    const oldAliasPair = sourceVersion === 1 && parts.some(part => /^1\s+study$/i.test(part)) && parts.some(part => /^1\s+home office$/i.test(part));
    return parts.filter(part => !(oldAliasPair && /^1\s+home office$/i.test(part))).join(', ');
}
