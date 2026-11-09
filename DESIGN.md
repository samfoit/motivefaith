---
name: MotiveFaith
description: A calm, warm habit tracker whose colors and sky follow the hour, with one gold lamp as its light.
colors:
  lampflame-amber: "#E9B44C"
  lampflame-amber-deep: "#D9A23A"
  lamp-ink: "#875C0C"
  wick-black: "#1A1405"
  amber-wash: "#FBF1DC"
  flame-bronze: "#A87410"
  clear-sky: "#ECF2F7"
  clear-sky-tile: "#EAF1F7"
  clear-sky-header: "#D3E5F3"
  page-white: "#FFFFFF"
  mist-track: "#D8E2EB"
  mist-hairline: "#D9E3EC"
  day-ink: "#1C2030"
  slate-sub: "#4D5A69"
  slate-quiet: "#5E6A7A"
  nav-slate: "#56677B"
  starry-night: "#12151F"
  night-card: "#1B1F2D"
  night-tile: "#232838"
  candle-ink: "#EDE6D6"
  candle-sub: "#A9A190"
  night-quiet: "#8A8FA4"
  night-amber-wash: "#2A2416"
  missed-red: "#ef4444"
  missed-red-ink: "#B91C1C"
  missed-red-hover: "#F25F5F"
  missed-red-ink-night: "#FF8A80"
  rain-blue: "#3b82f6"
  rain-blue-night: "#60a5fa"
  encourage-violet: "#8b5cf6"
  checkin-quick: "#A87410"
  checkin-note: "#2C7F44"
  checkin-photo: "#007D7E"
  checkin-rain: "#226BC0"
  checkin-voice: "#8258C9"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw + 1rem, 3.75rem)"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.25
  title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(1.125rem, 3vw + 0.5rem, 1.5rem)"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Figtree, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-strong:
    fontFamily: "Figtree, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "Figtree, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.43
  caption:
    fontFamily: "Figtree, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  data:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "3rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "16": "64px"
components:
  button-primary:
    backgroundColor: "{colors.lampflame-amber}"
    textColor: "{colors.wick-black}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.lampflame-amber-deep}"
    textColor: "{colors.wick-black}"
  button-primary-lg:
    backgroundColor: "{colors.lampflame-amber}"
    textColor: "{colors.wick-black}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "12px 20px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.lamp-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.lamp-ink}"
  button-danger:
    backgroundColor: "{colors.missed-red}"
    textColor: "{colors.wick-black}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.missed-red-hover}"
    textColor: "{colors.wick-black}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.lamp-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost-hover:
    backgroundColor: "{colors.mist-track}"
  input:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.day-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.day-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  habit-card:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.day-ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "12px 16px 12px 8px"
  done-mark:
    backgroundColor: "{colors.lampflame-amber}"
    textColor: "{colors.wick-black}"
    rounded: "{rounded.full}"
    size: "40px"
  checkin-option:
    backgroundColor: "{colors.checkin-quick}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.full}"
  capture-button:
    backgroundColor: "{colors.lampflame-amber}"
    textColor: "{colors.wick-black}"
    rounded: "{rounded.full}"
    size: "48px"
  top-bar:
    backgroundColor: "{colors.clear-sky-header}"
    textColor: "{colors.day-ink}"
    typography: "{typography.title}"
    height: "56px"
    padding: "0 16px"
  bottom-nav:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.nav-slate}"
    height: "64px"
  bottom-nav-active:
    textColor: "{colors.lamp-ink}"
  pill-status:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.lamp-ink}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  sheet:
    backgroundColor: "{colors.page-white}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: MotiveFaith

## Overview

**Creative North Star: "The Book of Hours"**

MotiveFaith is drawn like a book of hours: every hour of the day has its own light, and the whole interface turns to it. The Lamplight palette moves through five hours (before dawn, sunrise, a clear midday, the blue hour at dusk, and a lamplit night), blending surfaces, text and a drawn sky so the app always looks like the time the user is in. Within the light family and within the dark family, color drifts continuously; the two meet only at sunrise and nightfall, where the screen crossfades once.

The mood is **calm, warm, unhurried**. Surfaces are quiet, cool and nearly flat; the one warm note is the lamp: Lampflame Amber on the primary action, the done check, and the capture button. By day that gold sits warm against a clear blue sky. By night it glows. Headings and greetings are set in a book serif with an optical-size axis; the working UI is a friendly, rounded sans. Density is phone-first and comfortable: one column, thumb-sized targets, 12–16px gaps between items.

Brand art (link previews, hero art) stays minimal and flat: flat color fields, strong type, the lamp mark, small gold flames. Gradient "night sky" mood art, a day-to-night melting gradient, and dark inset boxes on light cards have all been tried and rejected.

**Key Characteristics:**
- The palette follows the hour; colors are tokens the theme rewrites, never fixed values.
- One gold lamp. Everything else stays cool and quiet so it reads.
- Light is the depth: hairlines and faint shadows by day, a gold glow by night.
- Serif for the voice (greetings, titles, verses); sans for the work.
- Soft and tactile: rounded shapes, a small springy response to touch.
- A drawn sky (stars, sun arc, hills, still water) lives behind every app screen, never behind text.

## Colors

A cool, sky-tinted neutral world that shifts with the hour, lit by a single warm gold and a small set of meaning-bearing hues.

### Primary
- **Lampflame Amber**: the lamp. A fill only: primary buttons, the done check, the capture button, the unread dot. It is the same at every hour; only its glow changes.
- **Lampflame Amber Deep**: the pressed and hover state of an amber fill.
- **Lamp Ink**: gold made legible. Text links, secondary button text and outlines, the active nav item, focus rings, and "done" text on light grounds. At night it becomes Lampflame Amber itself, which reads on the dark ground.
- **Wick Black**: text and icons on an amber fill.
- **Amber Wash** (night: **Night Amber Wash**): selected backgrounds, status pills, the secondary button's hover, the fact banner.
- **Flame Bronze**: the streak flame and streak numbers by day; amber by night.

### Neutral (light family, shown at the clear-midday pin)
- **Clear Sky**: the page ground at midday. Sunrise warms it to #F3F3F1, and the blue hour cools it to #E5E8F2.
- **Clear Sky Header**: the top bar, a deeper sky blue the gold sits warm against. Sunrise header is #F8EBD3; dusk is #CBD2EC.
- **Page White**: cards, sheets, inputs, the bottom nav.
- **Clear Sky Tile**: secondary sections and tiles.
- **Mist Track**: hover fills, progress tracks, skeletons, input borders.
- **Mist Hairline**: the 1px border on bars, cards and dividers.
- **Day Ink**: primary text. **Slate Sub**: secondary text. **Slate Quiet**: tertiary text, placeholders, quiet icons. **Nav Slate**: inactive nav items.

### Neutral (dark family, shown at the lamplit-night pin)
- **Starry Night**: the night ground, header and nav are one flat field. Before dawn it lifts to a blue #1A2033.
- **Night Card**: cards and sheets. **Night Tile**: tiles, tracks, borders.
- **Candle Ink**: warm off-white primary text. **Candle Sub**: secondary text. **Night Quiet**: tertiary text.

### Meaning hues
- **Missed Red**: a missed habit, destructive actions, hearts, as a fill, icon or border. Used sparingly.
- **Missed Red Ink** (night: **Missed Red Ink Night**): red as text — error messages, danger actions, counters over their limit. Missed Red itself is only 3.6–3.8:1 on light grounds, so text never uses it. A palette key (`missText` → `--color-miss-ink`), held at 4.5:1 on card, ground and tile, and on the 10% red wash of error banners, at every 15 minutes.
- **Rain Blue** (night: **Rain Blue Night**): a rain check. A deliberate skip, never an alarm.
- **Encourage Violet**: encouragements.

### Check-in hues
Five fixed hues, one per check-in action, each identical wherever that action appears: **Quick** (lamp gold, deepened), **Note** (ink green), **Photo/video** (teal), **Rain check** (blue), **Voice** (violet). All share one OKLCH lightness (≈0.53) and one saturation, with hues 45–70° apart. They sit behind white icons at 4:1 or better and do not follow the hour.

### Habit colors
Users tint a habit with one of ten presets (Red, Orange, Amber, Green, Teal, Blue, Indigo, Violet, Pink, Slate) or none. The color is the card's 1px border and a 5% wash of the card (chroma-capped in OKLCH so dark picks don't muddy it). No color is the common case and the baseline.

### Named Rules
**The One Lamp Rule.** Lampflame Amber is a fill, never text or an outline on a light ground: it fails contrast there. Gold text, icons and rings use Lamp Ink.

**The Hour Owns the Color Rule.** Surface, text, border and sky colors come from the tokens `palette(hour)` writes (`--color-bg-*`, `--color-text-*`, `--color-header`, `--sky-*`), never from a hardcoded value. A new hour-dependent color is added to `src/lib/lamplight/palette.ts` and walked by its contrast test: text at 4.5:1, controls at 3:1, at every 15-minute step.

**The Red Means Missed Rule.** Red is reserved for missed, danger and hearts. No action, category or decoration may borrow it. That is why the check-in hues leave the red-to-magenta arc empty. Red text is always Missed Red Ink; Missed Red is for fills, icons and borders.

## Typography

**Display Font:** Newsreader (with Georgia, serif), variable, optical-size axis on
**Body Font:** Figtree (with -apple-system, sans-serif)
**Data Font:** JetBrains Mono (with monospace), not preloaded

**Character:** A book serif that speaks (greetings, page and section titles, scripture) over a round, friendly sans that does the work. The optical-size axis gives a 24px greeting and a small label each the cut drawn for its size.

### Hierarchy
- **Display**: landing hero only, set tight with slight negative tracking.
- **Headline**: page and section titles on the landing page and in long-form screens.
- **Title**: the top bar's title ("Good afternoon, Alice"). It scales with the viewport so a 375px phone keeps room for the bar's buttons, and truncates rather than wrapping.
- **Body**: running text, input values (16px, so iOS never zooms on focus).
- **Body Strong**: habit names on cards, at body size and semibold.
- **Label**: buttons, form labels, secondary lines.
- **Caption**: metadata, timestamps, helper and error text. Nav labels and card pills drop to 10–11px medium.
- **Data**: streak numbers and stats, the only place mono appears.

Scripture quotes are Newsreader italic, with the reference set below in sans at caption or label size in a quieter color.

### Named Rules
**The Serif Speaks Rule.** Newsreader carries voice: greetings, titles, verses, empty-state headlines. Controls, labels and lists stay in Figtree. Never set a button or form label in the serif.

**The Mono Counts Rule.** JetBrains Mono is for numbers that are being counted (streaks, stats) and nothing else.

## Layout

Phone-first, single column. App screens sit in a centered column up to 672px wide (`max-w-2xl`) with 16px side padding. The bottom nav's items are capped at 512px. A sticky 56px top bar holds the title and up to a few 40px icon buttons; a fixed 64px bottom nav holds four destinations around a raised capture button. Main content pads its bottom by 80px plus the safe-area inset so the last card clears the nav and the sky band shows beneath it. Full-screen layers (camera, recorder, cropper) pad by the notch and home-indicator insets.

Rhythm is a 4px base with an 8px grid: 12px between list items, 16px inside cards and sheets, 24–32px between sections. The landing page alone opens up to a 1152px container and 64–96px section padding, switching to two columns at 1024px. Breakpoints are Tailwind's defaults; the app UI barely uses them, because it is designed at phone width and simply centered on larger screens.

Bottom sheets are the main secondary surface on the phone: they rise from the bottom edge up to 672px wide, with a drag handle and swipe-to-dismiss.

### Named Rules
**The Solid Ground Rule.** The sky is fixed behind the screen, and content scrolls over it only on solid surfaces. Text never sits directly on the sky drawing. Chat screens keep only the stars, because their composer covers the horizon band.

**The Thumb Rule.** Every tap target reaches 44–48px, by stretching an invisible hit area where the visual element is smaller (40px bar buttons, the 28px card handle).

## Elevation & Depth

Light is the depth. Surfaces are nearly flat: a 1px hairline plus the faintest shadow lifts a card off the sky, and a sheet earns one larger, still-soft shadow. The real sense of lift comes from the lamp: gold elements carry a glow that is almost invisible at midday and grows warm through dusk and night (glow strength 0.06 by day, 0.3 at dusk, 0.55 at night). By day the capture button falls back to a small neutral drop shadow, so it still reads as raised.

### Shadow Vocabulary
- **Hairline lift** (`0 1px 2px rgba(0,0,0,0.04)`): cards, habit cards, drawer icons. The default.
- **Soft rise** (`0 2px 8px rgba(0,0,0,0.06)`): a card's hover lift, where hover exists.
- **Sheet** (`0 8px 24px rgba(0,0,0,0.08)`): bottom sheets and dialogs over a 40% black scrim with a 2px blur.
- **Lamp glow** (`--lamp-glow-bar`, `--lamp-glow-done`, `--lamp-glow-fab`, `--lamp-halo`): the gold's hour-dependent glow on progress bars, the done check, the capture button and halo moments. Always via these tokens, never a hand-written gold shadow.

### Named Rules
**The Lamp Is the Lift Rule.** Only gold glows. Nothing else gets a colored shadow, and nothing gets a glow by day that it wouldn't get by night.

## Shapes

Rounded but not bubbly. Corners step 6px → 10px → 14px: 10px for buttons and inputs, 14px for cards, habit cards, sheets' top corners and large buttons. Anything circular is truly round: the done check, check-in icons, avatars, the capture button, bar icon buttons, pills and dots. Borders are always 1px hairlines; the only 2px strokes are an open habit's empty check ring and a rain check's blue ring. The Tailwind `rounded-xl` class is not overridden by the theme and renders at 12px, smaller than `rounded-lg` (14px), so don't use it to mean "rounder than a card".

## Components

### Buttons
Soft and tactile: on hover they lift 2px and grow 5% on a springy ease (`cubic-bezier(.34,1.56,.64,1)`, 200ms); disabled drops to 60% opacity.
- **Shape:** gently rounded (10px); large buttons 14px.
- **Primary:** Lampflame Amber fill, Wick Black label, 8px × 16px (large: 12px × 20px, 16px text). One per view: the action that matters.
- **Secondary:** transparent with Lamp Ink text and a 30% Lamp Ink outline; Amber Wash on hover.
- **Ghost:** Lamp Ink text only; Mist Track on hover.
- **Danger:** for what can't be taken back (delete, remove, leave): Missed Red fill with a Wick Black label (4.9:1), a Missed Red Ink focus ring, and an opaque, lighter Missed Red Hover (5.7:1). Never a translucent red: at night the dark ground shows through and the label drops below 4.5:1. Confirm dialogs and moderation take it via `variant="danger"`, never by overriding a primary button's fill.
- **Focus:** a 2px Lamp Ink ring offset by 2px.
- **Loading:** a spinner inside the label, button stays its size.
- **Top bar action:** a compact 32px-tall amber rectangle (14px radius), icon-only when the title needs the room.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** the card token (Page White by day, Night Card by night).
- **Shadow Strategy:** hairline lift only (see Elevation).
- **Border:** Mist Hairline, or the habit's color on a habit card.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** card-colored field, 1px Mist Track border, 10px radius, 8px × 12px padding, 16px text; label above in label type.
- **Focus:** border turns Lamp Ink with a 2px Lamp Ink ring.
- **Error:** Missed Red border and ring, with the message below in Missed Red Ink caption, announced to screen readers. **Disabled:** 60% opacity.

### Chips / Pills
- **Pill component** (`Pill`, 12–14px medium, fully round) has five tones: **neutral** (Mist Track with Slate Sub text) for plain labels and counts; **brand** (Amber Wash with Lamp Ink) for "needs you" status; and **rain**, **encourage** and **miss**, each a 15% wash of its hue with the hour's ink as text. The hue lives in the wash, ring and status dot, never in the letters, so every tone holds 5:1 or better at every hour. `outline` swaps the wash for a hairline ring.
- **Habit card pills:** Amber Wash with Lamp Ink text, 10px medium, fully round. Rain-check and moved-day pills use their own hue as the text color over a faint wash of it.
- **Streak pill:** a small flame icon and number in Flame Bronze beside the habit name.

### Toasts
- **Style:** a floating card at the bottom center, at most 384px wide, 10px radius, Sheet shadow. Opaque: the variant's hue is mixed 12% into the hour's card color, with a border at 40% of the hue. A translucent tint would let the page show through.
- **Variants:** success is the lamp (gold), error is Missed Red, encourage is Encourage Violet, info is plain (Slate Quiet). Blue stays reserved for rain checks.
- **Text:** title in the hour's ink, description in its secondary color, 5:1 or better on every tint at every hour. Action and Close are small ink buttons with an ink hover wash and a Lamp Ink focus outline.

### Navigation
- **Top bar:** 56px, Clear Sky Header (Starry Night at night), hairline bottom border; serif title left, 40px round icon buttons right, 8px apart.
- **Bottom nav:** 64px, card-colored with a hairline top border. Icons at 20px over 10px medium labels in Nav Slate; the active item turns Lamp Ink. An amber dot marks unread. The center Capture button is a 48px amber circle raised 16px above the bar, carrying the FAB glow; it scales to 110% on hover and 95% on press.

### Habit Card (signature)
The heart of the app. A 14px-radius surface tinted by the habit's color (1px border in that color, a 5% wash inside), padded 12px/16px, with a 28px chevron handle at the left, the emoji and semibold name, its streak pill, a meta row (time window, status pills), and a 40px round check at the right.
- **Check states:** open is a 2px Slate Quiet ring that warms to Lamp Ink on hover. Done is a solid amber circle with a Wick Black check that pops in on a bounce, carrying the done glow. Rain-checked is a 2px Rain Blue ring around a cloud.
- **Check-in drawer:** swiping the card right (or tapping the handle) slides it off a row of round check-in icons in their fixed hues, white glyphs, revealed one after another 40ms apart. The drawer's floor is a step deeper than the card, tinted with the habit's hue and outlined in it, so the icons never float on the page.
- **Done:** the name steps back to Slate Sub.

### Bottom Sheet
A Page White sheet rising from the bottom edge, 14px top corners, 16px padding, a 48px × 6px drag handle, serif title with an optional sans description, and a close button. It enters on a slightly springy 420ms ease and can be dragged down to dismiss.

### Sky Scene (signature)
A drawing fixed behind every app screen: a star field tiled at native size from the top down to the nav, and a 390 × 220 horizon band (sun or moon arc, far and near hills, still water, clouds) pinned just above the nav. Its colors come from the `--sky-*` tokens for the hour, and it fades in after hydration. On the landing page, the same drawings illustrate the five hours, each card wearing its own hour's palette.

The sun meets the far ridge, not the horizon hidden behind it, at the hours the palette names: half up at the 6:30 sunrise, half down by 7:15 PM, gone by nightfall. Nothing in the sky sits on anything else (the sun and moon pass the clouds, birds, stars and the olive tree by), and stars come out only on the dark sky, where they can be seen. `sky.test.ts` walks the day to hold both.

## Do's and Don'ts

### Do:
- **Do** take every surface, text, border and sky color from the Lamplight tokens, and check new work at a sunrise, midday, dusk, night and pre-dawn hour, not just light and dark.
- **Do** add any new hour-dependent color to `src/lib/lamplight/palette.ts` with a contrast test, not as an inline tint.
- **Do** keep Lampflame Amber to fills and use Lamp Ink for gold text, icons and focus rings.
- **Do** give each check-in action its own fixed hue everywhere it appears, from its `--color-checkin-*` token.
- **Do** make tap targets 44–48px, stretching a hidden hit area when the visual is smaller.
- **Do** honor `prefers-reduced-motion`: drop the bounces, shimmer and slides, keep state changes instant.
- **Do** keep brand art flat: flat color fields, the lamp mark, strong type, small gold flames; a night field is a flat full-bleed Starry Night with a clean edge.

### Don't:
- **Don't** use Lampflame Amber as text or an outline on a light ground.
- **Don't** use red for anything but missed, danger and hearts, don't set text in Missed Red (use Missed Red Ink), and don't style a rain check as an error.
- **Don't** put text directly on the sky drawing; it scrolls over on solid cards.
- **Don't** add colored shadows or glows to anything but gold, or a heavy drop shadow to a card.
- **Don't** set controls or form labels in Newsreader, or use JetBrains Mono for anything but counted numbers.
- **Don't** reach for raw Tailwind palette colors (`gray-*`, `emerald-*`, `indigo-*`, `rose-*`); they don't follow the hour. Card, Pill, Input and TextArea take only Lamplight tokens, and the Pill test fails if one comes back.
- **Don't** make brand visuals out of gradient night skies, a day-to-night melting gradient, or a dark inset box on a light card.
