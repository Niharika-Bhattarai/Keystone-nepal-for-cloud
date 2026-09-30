---
name: Keystone AI
description: Frosted glass over the house; the drawing is the headline.
colors:
  ink: "#0F1420"
  ink-hover: "#1E2738"
  slate-secondary: "#34404F"
  keystone-blue: "#1C5A8C"
  keystone-blue-deep: "#174B75"
  keystone-blue-wash: "rgba(28, 90, 140, 0.12)"
  live-green: "#1F7A4C"
  error-red: "#B42318"
  sheet-white: "#FFFFFF"
  paper: "#F7F8FA"
  sky-ground: "#BCD2E4"
  rule: "rgba(15, 20, 32, 0.12)"
  glass-clear: "rgba(255, 255, 255, 0.50)"
  glass-frost: "rgba(255, 255, 255, 0.62)"
  glass-deep: "rgba(15, 20, 32, 0.64)"
  glass-rim: "rgba(255, 255, 255, 0.58)"
  deep-fallback: "#161C2A"
  control-edge: "#7C8696"
  rendered-slate: "#535F64"
typography:
  display:
    fontFamily: "Onest, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(30px, min(4.2vw, 7.2vh), 60px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(32px, 5vw, 62px)"
    fontWeight: 700
    lineHeight: 1.03
    letterSpacing: "-0.04em"
  headline-section:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(28px, 3.8vw, 46px)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(15px, 1.25vw, 18px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Onest, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.3
  data-mono:
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
rounded:
  pill: "999px"
  panel: "30px"
  card: "24px"
  edit-card: "20px"
  sheet: "18px"
  peek: "16px"
  field: "14px"
  inset: "8px"
spacing:
  hair: "6px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  panel: "26px"
  section: "64px"
  section-wide: "104px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.sheet-white}"
  button-glass:
    backgroundColor: "rgba(255, 255, 255, 0.55)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-glass-hover:
    backgroundColor: "rgba(255, 255, 255, 0.75)"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  chip:
    backgroundColor: "rgba(255, 255, 255, 0.6)"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 11px"
  segmented-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  input:
    backgroundColor: "rgba(255, 255, 255, 0.8)"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "44px"
  glass-panel-frost:
    backgroundColor: "{colors.glass-frost}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  glass-panel-clear:
    backgroundColor: "{colors.glass-clear}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
  glass-panel-deep:
    backgroundColor: "{colors.glass-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
  drawing-sheet:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.sheet}"
  segmented-quiet:
    backgroundColor: "rgba(15, 20, 32, 0.06)"
    rounded: "{rounded.pill}"
  segmented-quiet-selected:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.ink}"
  edit-card:
    backgroundColor: "rgba(255, 255, 255, 0.92)"
    textColor: "{colors.ink}"
    rounded: "{rounded.edit-card}"
    padding: "{spacing.md}"
---

# Design System: Keystone AI

Conversion update (2026-09-26): retain this approved visual system. References below
to passkey controls are historical: sign-in/account controls now occupy that role.
Use PRODUCT.md for current tiers and conversion limitations.

Studio update (2026-09-29): the Studio's Edit mode adds direct manipulation — dragging
walls, taking a wall out or merging rooms, moving furniture — drawn straight onto the
engine's own plan rather than in a separate editor UI. See Components > Plan Editor.

## Overview

**Creative North Star: "The Plan on the Window"**

Every page is a pane of slightly frosted glass laid over a photograph of the house, and the drawing is the thing you look at through it. The house image is the backdrop, never the subject; the engine's plan is the headline, drawn live, on white paper, inside the glass. The interface is calm, pale, and quiet so that ink linework carries the page.

Density is moderate: rounded glass panels (24 to 30px) float over the scene with 12 to 16px gutters, headings are heavy and tight-tracked Onest, and all primary actions are solid ink pills. Colour is almost absent. Ink and a cool slate carry text; Keystone Blue appears only where something is focused, linked, or in progress; green is a single live dot. Motion is slow and physical: panels settle in once from a soft blur, the backdrop drifts over 28 seconds, light follows the pointer across glass, and the plan draws itself stroke by stroke.

The system rejects a stock-photo hero with feature cards, drawings placed on glass or tinted grounds, and chrome that competes with the linework.

**Key Characteristics:**
- The exterior house photograph sits behind every page as a fixed, slowly drifting scene; subpages blur it (10px) for long reading.
- Three glass tint levels with fixed text rules, and never more than three stacked.
- Drawings always sit on white paper inside the glass.
- Ink pill buttons for primary actions; translucent glass pills for secondary.
- One sans family (Onest); JetBrains Mono is reserved for measurements, briefs and code-like data.
- The replayable plan-draw sequence is the signature interaction, carried from the hero into the scroll story and the studio.
- Edit mode overlays that same drawing with a transparent, direct-manipulation layer — grips, dashed targets, a dense card tint — instead of a separate editor screen.

## Colors

A near-monochrome ink-on-glass palette with one restrained blue and one green dot.

### Primary
- **Drafting Ink** (#0F1420): all body and heading text on clear and frost glass, the fill of every primary button, selected segment, pressed brief chip and progress bar. Hover deepens to a lifted ink (#1E2738).

### Secondary
- **Keystone Blue** (#1C5A8C): focus rings (2px, 3px offset), inline links, the in-progress drawing pulse, the winning footprint in the how-it-works walkthrough, and "soon" tags (as a 12% wash with the deeper #174B75 as text). Never a large fill.

### Tertiary
- **Live Green** (#1F7A4C): a 7px dot on live tags, the finished-drawing beat, the unlocked passkey state and confirmation text. A signal, not a surface.
- **Error Red** (#B42318): field error borders and messages only.
- **Keystone Brass** (#B0843A, #C9A15A on the ink tile): the keystone of the mark and nothing else.
- **Studio Vermillion** (#D13F1B, hover #B8360F, pressed #A3300D): the one call to action that opens the studio (the hero's "Design my house, free" and the nav's "Open the studio"). White text, 4.7:1. Nothing else is vermillion.

### Neutral
- **Cool Slate** (#34404F): secondary text (leads, captions, fine print), on frost glass or paper only, never on clear.
- **Sheet White** (#FFFFFF): the ground of every drawing.
- **Paper** (#F7F8FA): opaque studio ground, reduced-transparency fallback, cost panels, and text on deep glass.
- **Sky Ground** (#BCD2E4): page colour behind the scene image while it loads.
- **Hairline Rule** (rgba(15,20,32,0.12)): dividers between ledger rows, list items and FAQ entries.
- **Glass Clear / Frost / Deep** and **Glass Rim**: the three tint levels and the 1px light edge; see Elevation & Depth.
- **Control Edge** (#7C8696): hover border of studio fields, the 3:1 non-text contrast floor for controls.
- **Rendered Slate** (#535F64): used only as the ground of the studio's Rendered plan view and its PNG export.

### Named Rules
**The Ink Carries Action Rule.** Primary actions are solid ink, not blue; the single exception is opening the studio, in Studio Vermillion. Keystone Blue marks focus, links and progress; if a screen shows more than a few touches of blue, something is misusing it.

**The Green Is a Dot Rule.** Live Green appears as a dot, an icon tint or one short confirmation line. It never fills a panel or button.

**The Paper Ground Rule.** Drawings sit on white paper, never on glass, tint or a dark ground. The single cited exception is the studio's Rendered view, which keeps the engine's slate presentation ground because that is what its PNG export produces.

## Typography

**Display Font:** Onest (with ui-sans-serif, system-ui, Segoe UI)
**Body Font:** Onest
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SFMono-Regular, Menlo), data only

**Character:** One geometric-humanist sans does everything from 60px headlines to 12.5px labels, set heavy and tightly tracked at display sizes so headlines read as solid blocks over the glass. Mono appears only where the content itself is a measurement, a brief or code-like output.

### Hierarchy
- **Display** (700, clamp(30px, min(4.2vw, 7.2vh), 60px), 1.02, -0.045em): the home h1 only; its height clamp keeps the hero inside one screen.
- **Headline** (700, clamp(32px, 5vw, 62px), 1.03, -0.04em): subpage h1.
- **Section Headline** (700, clamp(28px, 3.8vw, 46px), 1.06, -0.035em): section h2s inside a glass head panel. Story step headings sit between (clamp(24px, 2.4vw, 34px)).
- **Title** (700, 15 to 20px, -0.01 to -0.02em): card, ledger, tier and dialog headings (dialog h2 at 24px).
- **Lead** (400, clamp(15px, 1.25vw, 18px), 1.55, max 58ch): the one line under a headline, in Cool Slate on frost, Paper on deep.
- **Body** (400, 15px, 1.55): running text; paragraphs cap at 62 to 70ch.
- **Label** (600, 12.5px): field labels, segmented controls, level switches. Onest, sentence case.
- **Data Mono** (500, 11 to 14px): the brief text in the live panel, draw-progress beats, room areas, footprint sizes, the passkey field and the typed-brief output peek. Numbers elsewhere use tabular figures in Onest.

### Named Rules
**The Mono Is Data Rule.** JetBrains Mono sets measurements, briefs and code-like data, and nothing else. It is never a label style: no uppercase tracked mono captions, no mono section markers, no mono tags as decoration.

**The Headline Stands Alone Rule.** No kicker, eyebrow or small caption sits above a heading. A section opens with its heading, inside its glass head panel.

**The Figures in Prose Rule.** Numbers are stated in sentences and captions (score, estimate range, engine facts), not blown up into big-number stat tiles.

## Layout

Content sits in a 1220px centred wrap with 16px side padding, 28px from 700px. Sections breathe 64px vertically, 104px from 900px. Glass panels group into grids with 12px gaps (16px on wide screens); every section opens with a glass head panel (26px padding, 30px radius, max 760px) holding the heading and lead.

The home hero is exactly one screen under the floating nav: a frost headline card (~38%) beside a clear live-drawing panel (~62%) from 860px; on phones the card stacks above a shorter live panel, lead hidden, still inside one screen. The scroll story pins a 360px copy panel beside a full-height viewer from 900px. Two-column subpage layouts (walkthrough, FAQ) put a 340 to 360px glass rail beside the content, sticky under the nav. Output and figure grids go 1, 2, 3 columns at 640 and 1000px (760px for figures). The desktop nav links appear at 960px; below that a full-screen glass sheet menu replaces them.

Every drawing is sized to its own proportion inside the space it has, never stretched or cropped to a fixed box.

## Elevation & Depth

Depth is glass over a photograph: translucency and blur do the layering, reinforced by an inner light rim and one soft offset shadow per stack. Three levels, checked at the worst point of the exterior render:

- **Clear** (50% white, blur 14px, saturate 1.5): ink text only. The live panel, story viewer, block titles.
- **Frost** (62% white, blur 18px, saturate 1.6): Cool Slate secondary text allowed. The default panel.
- **Deep** (64% ink, blur 18px): white or Paper text only. Contrast panels such as the price anchor's second column.

Without backdrop-filter support, or with reduced transparency, clear and frost resolve to 92 to 94% white and deep to #161C2A.

These three sit over the exterior house photograph. A fourth, denser tint — Dense Card,
92% white — exists only inside the studio's Edit mode, over the plan drawing rather
than the photograph; see Components > Plan Editor.

### Shadow Vocabulary
- **Glass rest** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.18), 0 10px 30px rgba(15,20,32,0.14)`): every glass panel.
- **Deep glass** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 14px 36px rgba(15,20,32,0.3)`): deep panels.
- **Nested glass** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.8)`): glass inside glass carries only the rim.
- **Ink button** (`box-shadow: 0 6px 18px rgba(15,20,32,0.25)`): primary buttons.
- **Sheet lift** (`box-shadow: 0 1px 0 rgba(255,255,255,0.6), 0 12px 30px rgba(15,20,32,0.12)`): the white drawing sheet inside the live panel.
- **Studio window** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 40px 120px -30px rgba(15,20,32,0.45)`): the studio overlay pane.

### Named Rules
**The Glass Over Imagery Rule.** Glass sits only over the house imagery, at most three layers stacked, and only the outermost layer casts a drop shadow.

**The Tint Floor Rule.** Clear never drops below 50% white, frost below 62%, deep below 64% ink, and each level's text rule holds: clear takes ink only, frost allows Cool Slate, deep takes white only.

**The Only the House Rule.** While the studio is open, only the house photograph sits under its overlay; the page's own panels are hidden, not blurred behind it.

## Shapes

Soft, generous rounding with pills for everything interactive. Controls, chips, tags, segmented controls and the nav bar are full pills (999px). Glass panels run 24px (default card) to 26 to 30px (section heads, ledgers, dialogs, footer); the studio window is 28px, its floating edit-mode cards 20px. Inside the glass, the drawing sheet steps down to 18px, output peeks to 16px, fields to 14px and small inset tokens to 8 to 10px, so radius shrinks as you move inward. Borders are a 1px light rim on glass and a hairline ink rule on dividers; no heavy strokes. The Keystone AI mark is a round arch of voussoirs on coursed piers, locked by a brass keystone, on a 32-unit grid (in a tile with an 8-unit radius where it needs one); see `brand/README.md`.

## Components

### Buttons
Quiet, confident pills; the ink one is always the answer.
- **Shape:** full pill (999px), 44px tall (36px small), 600 weight.
- **Primary:** Drafting Ink fill, white text, 0 20px padding, ink button shadow.
- **Hover / Focus / Active:** hover lifts to #1E2738; focus is a 2px Keystone Blue outline at 3px offset; active scales to 0.97. Disabled drops to 45% opacity.
- **Glass (secondary):** 55% white with clear blur and the light rim, ink text; hover to 75% white.
- **Icon button:** 40px circle, transparent, 60% white on hover; the glassy variant is 36px at 62% white with the rim.
- **Link button:** ink text, 600, underlined at 3px offset.

### Chips and Tags
- **Chip:** 60% white pill with the rim, 12.5px 500 Onest. Brief chips in the live panel are Data Mono (they carry the brief) and fill ink when pressed.
- **Tag:** small pill on a 7% ink wash; the live variant prefixes a 7px Live Green dot, the passkey variant is solid ink, "soon" is a Keystone Blue wash.

### Cards / Containers
- **Corner Style:** 24px default, 26 to 30px for section-scale panels.
- **Background:** one of the three glass levels over the scene.
- **Shadow Strategy:** glass rest; nested glass carries the rim only.
- **Border:** 1px light rim (58% white).
- **Internal Padding:** 10px around peeks and sheets, 22 to 28px for text panels.
- **Pointer light:** on hover-capable devices a 260px radial highlight follows the pointer across the glass.

### Inputs / Fields
- **Style:** 80% white, 1px 16% ink border, 14px radius, 44px tall; textareas start at 84px.
- **Focus:** border turns Keystone Blue with a 3px 12% blue halo.
- **Error:** border Error Red with a 3px 12% red halo, message below in 12.5px red.
- **Passkey field:** Data Mono with 0.04em tracking.

### Navigation
A floating glass pill (frost), sticky 12px from the top (16px on desktop), holding the arch mark (it builds itself once per visit: stones set pair by pair, the brass keystone drops in, one glint; on hover the keystone lifts and settles) and the "Keystone AI" wordmark (800 / 400 weights), pill links (14px 500) with a 55% white hover and an 8% ink wash for the current page, and a passkey control that turns Live Green when unlocked. Once scrolled the bar firms to 72% white. Below 960px a 44px menu button opens a full-screen glass sheet with 22px 600 links on hairline rules.

### Dialogs
Frost glass, 30px radius, 26px padding, max 460px, over a 28% ink scrim; they settle in from a slight blur and scale. A pill segmented control switches modes (selected segment solid ink).

### Hero House Panel (signature)
A clear glass panel with the homepage brief (Data Mono), Replay, and one stage that shows one view at a time. First the white drawing sheet: the plan (both levels) draws stroke by stroke in about 3.5 seconds with a pulsing Keystone Blue beat. Then the plan steps back behind a small frost card, "Building the photoreal 3D model…", with the keystone mark's working loop, for at least 1.4 seconds. Then the photoreal model of the same plan crossfades in: baked with the roof, ceilings and site off, its upper floor easing up off the ground floor. It turns (one turn in 16 s); drag turns and tilts it down to a view from directly above, pinch or Ctrl + wheel or the round buttons zoom (a plain wheel still scrolls the page). After one full turn, or at the first touch, a pill switch (Floor plan / 3D) appears at the top of the stage. The model (about 2 MB) loads only after the drawing, and waits for a tap on data-saver connections.

### Studio Overlay
A 28px frost pane (58% paper, blur 18px) over a 12% ink scrim, 1600 by 960px at most, full-bleed on phones. Its canvas is a pale table (#DFE5EB with a soft white centre) holding a 4px-radius white sheet; tools float in a 72% white pill toolbar at the bottom. The same ink-primary, pill and glass rules apply inside.

### Plan Editor (direct manipulation)

A transparent layer drawn in the same coordinates as the engine's own plan, so a hand
can take hold of what the eye already sees. A quiet segmented control (Walls and rooms
/ Furniture) switches what that hand grips; unlike the view switch above it, its
selected segment is white on a 6% ink track, not an ink fill, so it reads as a
secondary, in-context choice rather than a primary navigation switch.

- **Selectable room / piece:** an 8% Keystone Blue fill with a 2px solid Keystone Blue
  outline marks the current selection; a dashed version of the same outline (6% fill)
  marks a room or piece that can be chosen as a target (a swap, an "Open to…", a
  merge). The same shape in Error Red (7% fill, solid outline) marks a piece being
  dragged somewhere it cannot go.
- **Wall grip:** a short ink bar at 22% opacity sits on every wall a hand can move; it
  thickens and turns Keystone Blue on hover, keyboard focus, or while dragging. A wall
  that cannot move keeps its line dashed and takes no grip, though it can still be
  pressed for its options.
- **Opening line:** where a wall has been taken out, a dashed Keystone Blue line at 75%
  opacity marks the gap in its place.
- **Finding flag:** a 6px Error Red dot with a white ring pins to the corner of any room
  with an open finding.
- **Drafting dimension:** while dragging, a Keystone Blue line with tick-mark ends and a
  Data Mono label (white-stroked so it reads over any fill) states the new size live.
- **Dense Card:** a fourth glass tint, 92% white, blurred, 20px radius, for the floating
  room, wall and piece panels, the findings popup, and the plan-check list — denser
  than Deep so long-form text and form controls stay legible over a busy line drawing.
  A finding kept live under it shows a plain sentence with Undo and Keep it; a system
  notice (the same tint) adds a 1px Error Red inset ring in place of the light rim.

### Named Rules
**The Editor Never Repaints the Plan Rule.** The direct-edit layer only marks what can
be touched and what is selected; it never recolors or restyles the engine's own drawing
underneath.

## Do's and Don'ts

### Do:
- **Do** put every drawing on white paper (#FFFFFF) inside the glass; the studio's Rendered view on Rendered Slate (#535F64) is the only exception.
- **Do** choose the glass level by the text it must carry: clear for ink only, frost when Cool Slate is needed, deep for white text.
- **Do** give every clickable element hover, focus-visible (2px Keystone Blue, 3px offset) and active states.
- **Do** open each section with its heading inside a glass head panel, followed by one lead line.
- **Do** state figures in sentences and captions with tabular numerals.
- **Do** size drawings to their own proportion and let the draw sequence replay.
- **Do** resolve all motion instantly under reduced motion and all glass to near-opaque under reduced transparency.
- **Do** mark a blocked or impossible direct edit in Error Red, never Keystone Blue; blue always means "can be chosen," never "cannot."

### Don't:
- **Don't** place a drawing on glass, a tinted panel or a dark ground.
- **Don't** put a kicker, eyebrow or small caption above a heading.
- **Don't** use JetBrains Mono as a label style; it is for measurements, briefs and code-like data only.
- **Don't** turn numbers into big-number stat tiles.
- **Don't** let anything but the house photograph sit under the studio overlay.
- **Don't** lighten glass below its tint floor (clear 50% white, frost 62%, deep 64% ink) or put Cool Slate text on clear or anything but white on deep.
- **Don't** use Keystone Blue as a button fill or large surface, or Live Green as anything bigger than a dot or a line of text.
- **Don't** stack more than three glass layers or give nested glass its own drop shadow.
- **Don't** let the Dense Card tint drop below 92% white; it floats over a working line drawing, not a photograph, and needs to win every legibility test.
