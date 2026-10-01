// Paint schemes for the 3D study model. Exterior schemes follow common Nepali
// house finishes (painted plaster with contrasting floor bands and window
// trims, Newari exposed brick with dark timber); interior schemes give one
// colour to every room or a colour per room type. These are visual choices for
// the household, not specifications: paint makers' codes are chosen later.

export const EXTERIOR_SCHEMES = [
    { id: 'kathmandu-cream', name: 'Kathmandu cream', note: 'Cream plaster, white floor bands, dark brown windows',
        wall: '#efe4cc', band: '#fbfaf6', trim: '#4a3426', parapet: '#efe4cc', plinth: '#8c8478', roof: '#b9b4aa' },
    { id: 'newari-brick', name: 'Newari brick', note: 'Exposed red brick (dachi appa look), dark timber windows, cream bands',
        wall: '#a4513a', band: '#e8dcc2', trim: '#3b2618', parapet: '#a4513a', plinth: '#5e4a3c', roof: '#a8a197' },
    { id: 'white-maroon', name: 'White and maroon', note: 'White walls with maroon bands and trims (Bhaktapur / monastery look)',
        wall: '#f6f4ee', band: '#7a2024', trim: '#7a2024', parapet: '#f6f4ee', plinth: '#6b6560', roof: '#b9b4aa' },
    { id: 'terai-ochre', name: 'Warm ochre', note: 'Warm yellow plaster with white bands and green windows',
        wall: '#e6c26a', band: '#fbfaf6', trim: '#2f5b3a', parapet: '#e6c26a', plinth: '#857a64', roof: '#b4afa4' },
    { id: 'sky-blue', name: 'Sky blue', note: 'Pale blue plaster, white bands, charcoal windows',
        wall: '#bcd5e6', band: '#fbfbf9', trim: '#2f3a42', parapet: '#bcd5e6', plinth: '#7b7f82', roof: '#b4b6b4' },
    { id: 'sage-green', name: 'Sage green', note: 'Soft green plaster, white bands, dark wood windows',
        wall: '#c6d4b4', band: '#fbfaf6', trim: '#4a3426', parapet: '#c6d4b4', plinth: '#7a7d70', roof: '#b4b4ac' },
    { id: 'peach', name: 'Peach', note: 'Peach plaster, white bands, brown windows',
        wall: '#f0c6a6', band: '#fbfaf6', trim: '#5a3a28', parapet: '#f0c6a6', plinth: '#857668', roof: '#b9b2a8' },
    { id: 'modern-grey', name: 'Modern grey and wood', note: 'Light grey plaster, charcoal bands, timber-look windows',
        wall: '#c4c7c8', band: '#3c4146', trim: '#8a5a32', parapet: '#3c4146', plinth: '#3c4146', roof: '#9da1a3' },
];

const ROOM_TYPES = ['livingRoom', 'kitchen', 'diningAnnex', 'primaryBedroom', 'bedroom', 'guestBedroom', 'bathroom',
    'puja', 'study', 'lobby', 'primaryAlcove', 'livingAnnex', 'utilityFlex', 'serviceNiche', 'store', 'laundry'];
const all = colour => Object.fromEntries(ROOM_TYPES.map(t => [t, colour]));

export const INTERIOR_SCHEMES = [
    { id: 'off-white', name: 'Off-white everywhere', note: 'Bright and neutral; easiest to repaint', rooms: all('#f4f1ea') },
    { id: 'warm-beige', name: 'Warm beige', note: 'Warm, hides dust; popular in Kathmandu homes', rooms: all('#e8dcc4') },
    { id: 'light-grey', name: 'Light grey', note: 'Cool and modern', rooms: all('#dadde0') },
    { id: 'soft-sage', name: 'Soft sage', note: 'Calm green tint', rooms: all('#dce5d3') },
    { id: 'pastel-mix', name: 'Pastel per room', note: 'Living cream, kitchen butter, bedrooms blue/peach, baths white',
        rooms: { ...all('#f1ece1'), livingRoom: '#f1e6cf', livingAnnex: '#f1e6cf', kitchen: '#f3e6b4', diningAnnex: '#f3e6b4',
            primaryBedroom: '#f3d9c8', primaryAlcove: '#f3d9c8', bedroom: '#d6e4ef', guestBedroom: '#dce8d6', study: '#e0e6d4',
            bathroom: '#f6f6f3', puja: '#f6e7a6' } },
    { id: 'vastu-guidance', name: 'Vaastu colour guidance', note: 'Common guidance (not from the supplied library — check with your Vaastu consultant): puja yellow, kitchen orange tint, master bedroom earthy pink, other bedrooms light blue, living light green',
        rooms: { ...all('#f2efe6'), puja: '#f5e08a', kitchen: '#f3cfa0', diningAnnex: '#f3dcb8', primaryBedroom: '#e9c4b6',
            primaryAlcove: '#e9c4b6', bedroom: '#cfe0ee', guestBedroom: '#d4e3ee', livingRoom: '#d9e8cf', livingAnnex: '#d9e8cf',
            study: '#dfe9d2', bathroom: '#f7f7f4' } },
];

export const DEFAULT_EXTERIOR = EXTERIOR_SCHEMES[0].id;
export const DEFAULT_INTERIOR = INTERIOR_SCHEMES[0].id;
export const exteriorScheme = id => EXTERIOR_SCHEMES.find(s => s.id === id) || EXTERIOR_SCHEMES[0];
export const interiorScheme = id => INTERIOR_SCHEMES.find(s => s.id === id) || INTERIOR_SCHEMES[0];
export const roomPaint = (scheme, type) => scheme.rooms[type] || scheme.rooms.livingRoom || '#f4f1ea';

// Intervals [a, b] on a line minus the given gaps (both sorted or not).
export function subtractIntervals(a, b, gaps) {
    let parts = [[a, b]];
    for (const [g1, g2] of gaps) {
        parts = parts.flatMap(([p1, p2]) => g2 <= p1 || g1 >= p2 ? [[p1, p2]]
            : [[p1, Math.max(p1, g1)], [Math.min(p2, g2), p2]].filter(([x, y]) => y - x > 1));
    }
    return parts;
}
