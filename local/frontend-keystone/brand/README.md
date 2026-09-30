# Keystone AI brand assets

- `keystone-mark.svg`: primary mark, ink tile (#0F1420), paper stones (#F7F8FA), brass keystone.
- `keystone-mark-light.svg`: light tile (#E8EEF4), ink stones, brass keystone.
- `keystone-mark-plain.svg`: no tile, ink stones, brass keystone (on glass and paper).
- `../public/images/keystone-mark.svg`: the favicon (the primary mark at 64 px).

These files are written by `scripts/build-brand.mjs`; edit the geometry, not the files.

## The mark

A round arch of six voussoirs on two coursed piers, locked at the crown by its
keystone. It reads as an arch and as a front doorway. The keystone is the one stone
that holds the others in place: the product's name and its idea (the engine assembles
the house; the checks lock it).

- **Geometry** (`src/data/keystoneMark.js`, 32-unit grid): arch centre (16, 19.6),
  extrados radius 11, intrados 7.7; keystone 26 degrees wide, standing 2.7 above the
  arch and 1.1 below its soffit; joints 3.6 degrees; piers 6.2 deep in two courses.
- **Colour:** ink or paper stones; the keystone is always brass (#B0843A on light
  grounds, #C9A15A on the ink tile). Brass appears nowhere else on the site.
- **Motion** (`src/site/Mark.jsx`, styles in `src/styles/glass.css`):
  - intro, once per visit in the nav: the stones are set pair by pair from the piers
    up, the keystone drops into the crown and settles, one glint crosses the arch;
  - loop, the working indicator: the same building, repeated;
  - hover or focus on a lockup: the keystone lifts and settles.
  - Reduced motion shows the finished mark (the loop becomes a slow keystone pulse).
- **Wordmark:** "Keystone" in Onest 800 and "AI" in Onest 400, beside the mark.
- **3D:** the footer badge (`src/site/Badge3D.jsx`) builds the same arch in ceramic
  on a glass slab, with a brass keystone.
- **CAD:** the DXF title block draws the arch's outline (`src/lib/dxf.js`).

The previous name and mark (Parti Studio, the P drawn as a floor plan) are shelved in
`docs/shelf/parti-studio/` at the repository root.
