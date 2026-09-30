/* Copy the studio uses at runtime: refinement suggestions and render
   lighting presets. */

export const REFINEMENT_SUGGESTIONS = [
    "Make the living room 4 feet wider",
    "Make the primary bedroom bigger",
    "Expand the kitchen",
    "Make the master bathroom larger",
    "Widen the hallways",
    "Make the garage wider",
    "Expand the dining room",
];

export const RENDER_REFINEMENTS = [
    { label: 'Golden Hour',  hint: 'warm late-afternoon sunlight, long shadows, golden orange sky. Only change the lighting and sky; keep the house architecture identical.' },
    { label: 'Overcast Day', hint: 'soft diffuse overcast lighting, muted tones, grey cloud-covered sky. Only change the lighting and sky; keep the house architecture identical.' },
    { label: 'Night Lit',    hint: 'night scene with interior lights glowing warmly through windows, landscape uplighting, and a deep blue sky. Only change the lighting and sky; keep the house architecture identical.' },
    { label: 'Sunrise',      hint: 'sunrise with a pink-orange gradient sky and long warm shadows across the facade. Only change the lighting and sky; keep the house architecture identical.' },
];
