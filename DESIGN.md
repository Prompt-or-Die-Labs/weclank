---
version: alpha
name: Weclank — D350
description: Mission-control / sage-orange visual identity for an AI co-host for coding livestreams.
colors:
  primary: "#1a1f1a"
  secondary: "#5a6058"
  tertiary: "#dd5e2e"
  neutral: "#c9cebc"
  surface-1: "#becbb8"
  surface-2: "#b3bba8"
  surface-3: "#a8b09c"
  surface-elev: "#d2d6c4"
  border: "#a4ab95"
  border-strong: "#5a6058"
  text-primary: "#1a1f1a"
  text-secondary: "#2f342e"
  text-muted: "#5a6058"
  text-hint: "#888d80"
  panel-dark: "#262a25"
  panel-dark-2: "#1d201c"
  panel-dark-3: "#353a33"
  panel-dark-border: "#3a3f37"
  on-dark-0: "#d6dac8"
  on-dark-1: "#b0b5a3"
  on-dark-2: "#969b8c"
  accent: "#dd5e2e"
  accent-fg: "#1a1a1a"
  danger: "#a83520"
  success: "#3d6b28"
  warning: "#946523"
  canvas-black: "#000000"
typography:
  display:
    fontFamily: Inter
    fontSize: 2.25rem
    fontWeight: 700
    letterSpacing: -0.01em
    lineHeight: 1.05
  h1:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 600
    letterSpacing: -0.005em
  h2:
    fontFamily: Inter
    fontSize: 1.125rem
    fontWeight: 600
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.5
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: 500
    letterSpacing: 0.08em
  mono-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: 500
    fontFeature: '"tnum" 1'
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.625rem
    fontWeight: 500
    fontFeature: '"tnum" 1'
rounded:
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 7px 18px
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
  button-secondary:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 6px 12px
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
  button-ghost-dark:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.on-dark-0}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 6px 10px
  button-ghost-dark-hover:
    backgroundColor: "{colors.panel-dark-3}"
    textColor: "{colors.on-dark-0}"
  panel-light:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
  panel-dark:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.on-dark-0}"
  chip-idle:
    backgroundColor: "{colors.panel-dark-3}"
    textColor: "{colors.on-dark-1}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.pill}"
    padding: 3px 8px
  chip-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.pill}"
    padding: 3px 8px
  card-stat:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xs}"
    padding: 12px 16px
  card-stat-focal:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.xs}"
    padding: 12px 16px
  page-background:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
  body-text:
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  body-text-secondary:
    textColor: "{colors.secondary}"
    typography: "{typography.body-sm}"
  body-text-muted:
    textColor: "{colors.text-muted}"
    typography: "{typography.body-sm}"
  body-text-hint:
    textColor: "{colors.text-hint}"
    typography: "{typography.body-sm}"
  body-text-subtle:
    textColor: "{colors.text-secondary}"
    typography: "{typography.body-sm}"
  surface-input:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xs}"
    padding: 6px 10px
  surface-elev:
    backgroundColor: "{colors.surface-elev}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 12px
  hairline-border:
    backgroundColor: "{colors.border}"
    textColor: "{colors.primary}"
  hairline-border-strong:
    backgroundColor: "{colors.border-strong}"
    textColor: "{colors.primary}"
  on-dark-secondary:
    backgroundColor: "{colors.panel-dark-2}"
    textColor: "{colors.on-dark-1}"
    typography: "{typography.body-sm}"
  on-dark-muted:
    backgroundColor: "{colors.panel-dark}"
    textColor: "{colors.on-dark-1}"
    typography: "{typography.body-sm}"
  chip-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.pill}"
    padding: 3px 8px
  banner-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-dark-0}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 4px 10px
  banner-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-dark-0}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 4px 10px
  banner-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.xs}"
    padding: 4px 10px
  on-dark-hint:
    backgroundColor: "{colors.panel-dark-2}"
    textColor: "{colors.on-dark-2}"
    typography: "{typography.body-sm}"
  panel-dark-bordered:
    backgroundColor: "{colors.panel-dark-border}"
    textColor: "{colors.on-dark-0}"
  program-canvas:
    backgroundColor: "{colors.canvas-black}"
    textColor: "{colors.on-dark-0}"
    rounded: "{rounded.md}"
---

## Overview

Mission-control aesthetic for a coding livestream co-host. The visual reference
is industrial telemetry software — Bloomberg Terminal density, Logic Pro
control surfaces, Apollo-era console design — softened with a single warm
sage backdrop and a focal orange accent.

The product is a control surface, not a marketing page. UI density is
high; section labels are mono uppercase; numerics use tabular figures so
columns line up as values change.

Two themes ship: a **light** mode using the named D350 palette as the
default (sage main surface, dark charcoal accent panels, orange CTA);
a **dark** mode that inverts the main surface to deep charcoal while
keeping the same orange accent and on-dark text colors. Either mode
keeps the program canvas itself pure black (`#000`) so video isn't
tinted by the surround.

### Dark variant tokens

The same component slots flip to these values under `.theme-dark`:

```
bg-0:              #1a1f1a   (was #c9cebc — sage main surface)
bg-1:              #232826   (was #becbb8)
bg-2:              #2d3330   (was #b3bba8)
bg-3:              #383f3b   (was #a8b09c)
bg-elev:           #2a2f2b   (was #d2d6c4)
panel-dark:        #0e120e   (was #262a25)
panel-dark-2:      #060906   (was #1d201c)
panel-dark-3:      #1a1f1a   (was #353a33)
panel-dark-border: #2a2f28   (was #3a3f37)
border:            #2f352f   (was #a4ab95)
border-strong:     #4a4f47   (was #5a6058)
text-primary:      #d6dac8   (was #1a1f1a)
text-secondary:    #b0b5a3   (was #2f342e)
text-muted:        #888d80   (was #5a6058)
text-hint:         #5a6058   (was #888d80)
accent:            #dd5e2e   (unchanged)
```

The accent orange, the on-dark text tokens, and all typography / rounding
/ spacing tokens are identical across both modes.

## Colors

Three semantic zones, layered front-to-back:

- **Main surface (sage / charcoal)** — the page background and most
  content panels (left rail, stage area, bottom bars in dark mode).
  Carries the bulk of the dark-text reading work in light mode.
- **Dark accent panel (`panel-dark*`)** — reserved for high-density
  surfaces where focus concentrates: the app header, the right-side
  tab sidebar (chat / agents / banters / media / music / notes), and
  the audio mixer strip. In light mode this creates the "PATTERN.GRID"
  effect from the source reference — a dark island inside a sage page.
  In dark mode the panel-dark colors fall further toward black so the
  hierarchy still reads.
- **Accent (`#dd5e2e` burnt orange)** — used only for: primary actions
  (Go Live, Access Archive), live indicators (REC dot, LIVE.REC chip),
  the single "focal" stat card, and the active state of the AI co-host
  speaking phase. Orange is loud; it appears in at most two places on
  screen at a time.

### Token roles

| Token | Role |
|---|---|
| `primary` (`#1a1f1a`) | Headings, body text on sage |
| `secondary` (`#5a6058`) | Borders, captions, mid-grey labels |
| `tertiary` (`#dd5e2e`) | Single accent — interactive focus point only |
| `neutral` (`#c9cebc`) | Sage page background in light mode |
| `surface-1..3` | Layered sage variants for hover / active / inputs |
| `panel-dark*` | The dark accent zone (right sidebar, mixer, header) |
| `on-dark-0..2` | Text on the dark accent zone |
| `accent` / `accent-fg` | Orange CTA + the dark text drawn on it |
| `canvas-black` (`#000`) | The program canvas surface — never theme-tinted |

## Typography

`Inter` for prose and headings, `JetBrains Mono` for any technical label,
numeric, or identifier. The labels use uppercase with `0.08em`
letter-spacing — every section header in the UI ("Scenes", "Sources",
"Backstage", stats strip cells) takes this treatment.

Numerics use `font-variant-numeric: tabular-nums` so live counters
(stream timer, dropped frames, bitrate) don't jitter as digits change.

Display sizes are restrained; this is a control surface, not a hero
page. The largest type in the running app is the audio-mixer VU labels
at ~10px, the stats strip cells at 11px, and dialog headers at 18px.

## Layout & Spacing

The studio shell is a 5-region grid:

```
HEADER  (56px, dark accent)
LEFT-RAIL (260px, sage) | STAGE+BACKSTAGE (1fr, sage)        | RIGHT-SIDEBAR (340px, dark accent)
AUDIO MIXER STRIP (96px, dark accent — full width)
STATS STRIP       (28px, sage — full width)
```

The dark-accent zones form a horseshoe around the sage stage area. The
program canvas sits centered in the sage zone at the stream's aspect
ratio (16:9 for 720p/1080p) with a 1px sage border.

Use the `spacing.xs..2xl` tokens for any gap, padding, or margin. Avoid
hardcoded px values outside this scale.

## Shapes

Radius is **tight**. `2px` for buttons, badges, chips, source rows;
`4px` for cards; `6px` only for the program canvas frame and dialog
shells. No `rounded.full` anywhere except status dots and the avatar
ring on agent cards. The canvas frame and source thumbnails should
read as crisp rectangles, not pill shapes.

Borders are always 1px hairlines. The `border` token is the default;
`border-strong` exists for focused inputs and the dragged-row outline.
No drop shadows except `box-shadow: 0 0 0 1px var(--accent)` on focus
rings.

## Components

The `components` block above defines the load-bearing slots. Notes on
how they compose:

- **`button-primary`** — orange-on-dark; reserved for GO LIVE, "Connect"
  on the chat tab, and "Add overlay…" on the banters tab. Never more
  than one primary button visible at a time.
- **`button-secondary`** — sage-fill with dark text; used for the
  agent-card action buttons (Speak / Voice / Banter) and stage-toolbar
  preset buttons.
- **`button-ghost-dark`** — flat-on-dark; used inside the right sidebar
  (chat pin buttons, sidebar tab buttons in inactive state).
- **`chip-idle` / `chip-active`** — the agent-card phase chip cycles
  between these as the banter session transitions (idle → listening →
  thinking → generating → speaking).
- **`card-stat-focal`** — orange variant of the stat card. Reserved for
  the single "most important right now" stat. In the source reference
  this is the next-launch-window card; in Weclank it's the LIVE
  uptime cell when streaming.

## Do's and Don'ts

**Do**

- Treat orange as the focal accent. One or two places per screen, max.
- Use mono labels in uppercase for any structural section header.
- Keep numerics tabular so live counters don't jitter.
- Default to the sage palette; the dark theme is an option for users
  who prefer it, not the canonical brand.
- Use the dark-accent zone for surfaces with the highest information
  density (chat feed, agent cards, mixer channels).

**Accepted contrast tradeoffs**

The linter flags three component slots below WCAG AA 4.5:1:

- `banner-success` (`#3d6b28` bg) — dark text reads at ~4.2:1. Used for
  toasts only; on-screen for ~3 seconds. Accepted.
- `banner-warning` (`#946523` bg) — dark text reads at ~3.4:1. Same
  rationale; lift to AAA would require either ditching the amber hue or
  letting the warning toast stretch wider so larger type is justified.
- `hairline-border-strong` — synthetic component used only to register
  the strong-border color token in the spec; never renders text.

**Don't**

- Don't introduce a fourth color. Reds for danger states reuse a darker
  orange (`danger: #a83520`); greens for success are deep sage
  (`success: #3d6b28`).
- Don't use orange for "active" hovers or non-focal states. It's the
  signal that a thing is the next action or is currently live.
- Don't add drop shadows. Hairline borders and the `accent-glow` token
  (used sparingly on the live-state GO LIVE button) carry depth.
- Don't tint the program canvas. It stays `#000` in both themes so the
  composited broadcast doesn't pick up a colorcast in the preview.
- Don't theme the broadcast graphics (lower-thirds, title cards) to the
  UI palette. The canvas overlays use their own panel-dark + accent
  conventions so they look the same on whatever destination the stream
  fans out to.
