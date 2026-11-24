# FullBars design

## Idea of the world

The signal-bar glyph is the unit of the whole system. Everyone reads it a hundred times a day: four bars good, one bar bad. FullBars turns that glyph into a map. Every predicted level on the plan is a bar count, the legend is a row of bar glyphs, the coverage score is "how much of your home gets 3 bars or more", and the logo is bars rising out of the corner of a floor plan.

Raises kept from the directions it beat:
- **Bands with crisp edges, the edge does the dividing** (guide-map direction): the heatmap is quantised into bands with crisp contour edges, not a blurry rainbow gradient. You read zones, not noise. Inside each band a quiet lightness ramp follows the level (deeper near the router, lighter towards the band's edge), so even a home that is 100 % "Strong" still shows the signal falling away.
- **Numbers roll in fixed cells** (split-flap direction): the coverage number is tabular digits that roll to the new value; it never jumps.
- **One alert colour, reserved** (gate-board direction): vermilion appears only where something is wrong: dead zones, and the "before" marker of a bad router spot.
- **Hairline discipline** (ruling-engine direction): walls are drawn as crisp ink strokes at device-pixel precision, their weight encodes material.

## Scene and light

A student in a hostel room or a rented flat, evening, laptop on the desk or phone in hand, trying to work out why the bedroom has no signal. The plan must read like a printed estate-agent sheet: light ground, ink lines. Light theme only (dark is not finished, so it is not shipped).

## Colour roles (tokens in `src/styles/tokens.css`)

| Token | Value | Role |
|---|---|---|
| `--paper` | `#F4F5F2` | app ground (cool off-white, not cream) |
| `--sheet` | `#FFFFFF` | the plan sheet and panels |
| `--ink` | `#121417` | text, walls, router pin |
| `--ink-2` | `#4A5058` | secondary text (7.9:1 on paper) |
| `--ink-3` | `#6B717A` | tertiary labels, gridlines source (4.6:1 on white) |
| `--rule` | `#DCDFE3` | hairlines between regions |
| `--bar-4` | `#0B3BF5` | 4 bars, strong (signal cobalt, the brand colour) |
| `--bar-3` | `#4F74FF` | 3 bars |
| `--bar-2` | `#9DB1FF` | 2 bars |
| `--bar-1` | `#D6DEFF` | 1 bar |
| `--dead` | `#FF4A1C` | 0 bars, dead zone, the one alert colour (shown as hatching on the plan) |
| `--focus` | `#0B3BF5` | focus ring |

The signal scale is one hue stepping in lightness, so it works for colour-blind viewers and in greyscale; the bar glyph repeats the class next to every colour. The `--bar-*` values are for glyphs and UI marks.

### Map fills (heat layer, `src/ui/heatPalette.ts`)

Area fills are calmer than the glyph colours: a full-strength cobalt field drowned the ink walls, labels and router pin (polish pass, 2026-11-24). Each band ramps from its edge colour (at its threshold) to its core colour; band 4 ramps over the 30 dB above −67 dBm.

| Band | Edge | Core | Swatch token (share bar) |
|---|---|---|---|
| 4 Strong | `#87A4F3` | `#3F69E2` | `--heat-4` `#6387EB` |
| 3 Good | `#B9C9F9` | `#A8BCF5` | `--heat-3` `#B0C2F8` |
| 2 Weak | `#D6DFFC` | `#CDD8FB` | `--heat-2` `#D1DBFC` |
| 1 Barely | `#ECF0FE` | `#E5EAFD` | `--heat-1` `#E8EDFD` |
| 0 Dead | `#FFE4DB` hatched `#FF4A1C` | | vermilion hatch |

The GPU shader and the CPU fallback read the same table. Room labels sit on white plates with a 10 % ink hairline; a plate must fit inside its room, drops the size line when it does not, and is skipped if it would overlap a larger room's plate.

## Type

- **Archivo Variable** (self-hosted, `@fontsource-variable/archivo`, OFL). One family with a width axis: wide and heavy for the coverage number and the wordmark (`wdth 125`, weight 800), normal width for UI. Tabular figures (`font-variant-numeric: tabular-nums`) for every number.
- Scale (rem): 0.75 / 0.875 / 1 / 1.25 / 1.75 / 3.5 / 5 (coverage number).
- Line height 1.45 body, 0.95 display. Tracking -0.02em on display, 0.01em on small labels.

## Spacing, radius, depth

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64. Tokens `--s-1`..`--s-8`. Nothing else.
- Radius: 6px controls, 10px panels, 999px for the band toggle capsule. The plan sheet has 2px corners (it is paper).
- Shadow: one level for floating things (`0 8px 24px -12px rgb(18 20 23 / .28), 0 1px 2px rgb(18 20 23 / .08)`). Panels sit flat with a hairline.

## Screens: hero and primary action

1. **Planner (the only screen).** Hero: the plan sheet with the live heatmap, at least 60% of the width on desktop. Primary action: **Find the best spot** (the only filled cobalt button). Secondary: template picker, band toggle, wall tools, model settings; these recede (ghost buttons, small type).
2. **First load.** Not a separate landing page: the app opens on the "Two-bedroom flat" template with the router badly placed in the corner by the door. The wordmark and one sentence sit in the top bar. The heatmap spreads in (signature animation) so the first five seconds show the product working.
3. **Model sheet** (side drawer): the formula, wall-loss table with sources, thresholds with sources, limits. Editable values.

## Motion plan

| What | Duration | Easing | Notes |
|---|---|---|---|
| **Signature: signal spread** | ~1-2 s (by plan) | linear wavefront, 120 ms soft edge | The heatmap is revealed as a wavefront from the router. Each cell's reveal time is its distance plus a delay per wall crossed, so the colour visibly stalls at each wall, then pushes through. Plays on load, on template change and on band change. Runs per pixel in a WebGL2 shader (CPU fallback). |
| Router glide (best spot) | 650-1400 ms (by distance) | `cubic-bezier(0.77, 0, 0.175, 1)` | The pin travels the straight line to the winner; the heatmap recomputes every frame, so the zones flow with it. A vermilion ghost ring stays at the old spot. |
| Coverage digits roll | 640 ms, 40 ms stagger per digit | ease-out | Tabular cells; each digit slides up to its new value. |
| Class bar (stacked % bar) | 420 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | flex-grow per segment (a 10 px bar; cheap). |
| Entrance (first load) | 420 ms, 50 ms stagger | ease-out | Top bar, panel blocks fade + 8px rise. Plan sheet fades in, then the spread plays. |
| Button press | 140 ms | ease-out | scale(0.97). |
| Drawer | 280 ms in / 200 ms out | drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` | translateX. |
| Probe tooltip | 120 ms | ease-out | opacity; follows the cursor, shows the dashed straight path and highlights the walls it crosses. |
| Search sweep | ~0.5 s | per frame | Candidate spots appear as small dots as they are scored; the best so far carries a cobalt ring. |
| Dragging the router | none | - | Direct manipulation, recomputed every frame. Never animated. |

`prefers-reduced-motion: reduce`: the spread becomes a 200 ms crossfade, the glide becomes a jump plus crossfade, digits swap without rolling, entrances and the result card are opacity only, the search finishes in one frame.

## Responsive

- ≥ 1024 px: plan left (flex 1), panel right (360 px).
- < 1024 px: plan on top (full width, aspect kept), panel below in the order score, primary button, legend, templates. The single column is `minmax(0, 1fr)` and the sheet has `width: 100%`, so long plans and the nowrap button label cannot widen the page.
- On the stacked layout, pressing Find or picking a plan scrolls back to the plan first, so the glide and the spread are seen.
- < 560 px: tool labels hide (icons stay), wall material chips take their own wrapping row in the toolbar and the plan is laid out below the toolbar.
- < 360 px: the wordmark text hides (mark and accessible name stay), the band capsule and primary button tighten.
- Touch: a tap on the floor shows the reading and it stays until the next tap; taps do not draw the keyboard focus ring.
- Tested at 1440, 414, 375, 360 and 320.
