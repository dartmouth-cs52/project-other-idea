---
version: alpha
name: Haptic
description: Precision engineering for an accessibility-first, in-page guide. An enterprise B2B tool that shows people where to click instead of describing it.

colors:
  ink: "#12161C"            # all primary text, primary buttons, logo, focus rings
  ink-muted: "#4D5562"      # secondary text, descriptions (7.0:1 on paper)
  ink-subtle: "#5F6774"     # tertiary text, placeholders, metadata (5.3:1 on paper), the floor
  paper: "#F5F6F8"          # page background, cool off-white
  surface: "#FFFFFF"        # cards, panels, inputs, callouts
  fill: "#EEF0F3"           # secondary buttons, tiles, selected nav, kbd chips
  fill-strong: "#E2E5EA"    # hover/pressed state of fill, selected rows, skeletons
  hairline: "#DADEE4"       # card borders, dividers, input rings
  night: "#0D1015"          # demo stage, code blocks, the prototype bar
  night-surface: "#181C23"  # controls on night
  night-hairline: "#2B3039" # dividers and hover on night
  on-night: "#F5F6F8"       # text on night
  on-night-muted: "#A1A8B3" # secondary text on night (8.0:1)
  signal: "#FF5A1F"         # THE accent: guidance ring, active step, logo dot. Means "here"
  signal-ink: "#C23E0C"     # signal used as text on light backgrounds (5.3:1 on white)
  signal-wash: "#FFE9DF"    # background of the step that is happening now
  verified: "#1F7A4D"       # success and "Verified source" text and icon (4.6:1 on its wash)
  verified-wash: "#E3F2E9"
  danger: "#B42318"         # destructive actions and errors (6.6:1 on white)

typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.015em
  stat:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.02em
  title-md:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  body-lg:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Atkinson Hyperlegible Next
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
  mono-sm:
    fontFamily: Atkinson Hyperlegible Mono
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.02em
  mono-xs:
    fontFamily: Atkinson Hyperlegible Mono
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4

rounded:
  xs: 4px    # kbd chips, badges, segmented-control thumb, chart bars
  sm: 6px    # buttons, nav items, list rows, small tiles, tags
  md: 8px    # inputs, guidance callouts, launcher, spotlight cut-out
  lg: 12px   # cards, the assistant panel, dialogs, demo frames

spacing:
  "1": 4px
  "2": 8px
  "3": 12px
  "4": 16px
  "6": 24px
  "8": 32px
  "12": 48px
  "16": 64px
  "24": 96px
  "32": 128px
  tight: 4px        # icon ↔ its label, kbd chips in a row
  snug: 8px         # title ↔ its description, items inside one control
  related: 12px     # rows in a list, field label ↔ input, chip groups
  inset: 16px       # padding of small surfaces: inputs, tiles, menu items
  group: 24px       # padding of cards and the assistant panel; items in a group
  block: 32px       # between groups inside one screen or card stack
  region: 48px      # between regions of a page (header ↔ content)
  section-sm: 64px  # outer margins, marketing sub-sections
  section: 96px     # marketing sections on mobile
  section-lg: 128px # marketing sections on desktop

components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 44px
    padding: 0 24px
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    height: 44px
    padding: 0 24px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 0 16px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: 24px
  callout:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 24px
  badge-verified:
    backgroundColor: "{colors.verified-wash}"
    textColor: "{colors.verified}"
    rounded: "{rounded.xs}"
---

# Haptic

Read this before touching any UI. Every value an agent or teammate needs is in the
front matter above. The prose says when to use each one.

## Overview

**Precision, quietly.** Haptic sits inside someone else's product and moves the user, one
step at a time, to the right button. The brand is built around that gesture: an exact,
engineered point of contact.

Haptic is sold to companies, not consumers. The person who buys it is a support lead or
product owner at a B2B software company, and it runs inside *their* product. In testing,
people told us the first version, with big rounded corners, a warm palette and a smiling
orange face for the assistant, read as a consumer toy. So the system is now:

- **Mostly black and white.** Cool near-black ink on cool off-white paper. Greys do almost
  all the work, and colour is spent on one thing only.
- **Sharp, but not hard.** Small radii (4–12px), hairline borders and exact alignment.
  Think a well-made admin console, not a friendly chatbot.
- **Present, not personified.** The assistant is a plain second cursor on the page. No
  face, no eyes, no personality.
- **Shown, not told.** Every marketing section is anchored by the product guiding a real
  UI, never by a list of claims or stats.

What the inspiration board contributed:

| Reference | What we took |
|---|---|
| Crox engineering site | Precision: visible grid, big grotesque type, one orange accent |
| ElevenLabs dashboard | Lots of information made calm: quiet chrome, clear labels |
| Grok FAQ | Minimalism: one column, hairlines, nothing else |
| Satellite site (dark) | The page is a story; one hero object explains the offer |
| Wispr Flow hero | Show the product working, plus one clear CTA |
| Cube + arrow logo | A solid geometric form with a pointer cut into it |
| Zendesk (disliked) | What *not* to do: walls of claims, testimonial stats, lime gradient |

**Voice:** calm, specific, second person, short sentences. Say what happens next ("Click
Billing, then Invoices"), never what the AI "can do". No exclamation marks, no "magic",
no "supercharge", no emoji.

## Colors

The palette is greys plus one accent. Text, buttons, the logo and the cursor are all ink.

- **Signal (`#FF5A1F`) means "here".** Use it only for the thing the user should look at or
  press next: the guidance ring on the target, the active step label, the logo's touch dot,
  and at most one hero CTA on a marketing page. Never for decoration, backgrounds,
  illustrations, charts or section bands. Keep one signal element per view.
- **Text on signal is always ink** (5.8:1). White text on signal fails at 3.1:1.
- **Signal as text on light backgrounds uses `signal-ink`**, never `signal`.
- **Status colours keep their usual meaning:** `danger` for errors and destructive
  actions, `verified` for success and verified sources. Don't use either for anything else.
- **Never show state with colour alone.** The guidance ring also has a step label and the
  cursor; "Verified" has a check icon and the word; errors say what happened in words.
- **`ink-subtle` is the floor.** No text lighter than it on paper, fill or surface.
- **Night** (`night`, `night-surface`, `night-hairline`) is for the product-demo stage,
  code snippets and storytelling heroes. Product screens are light by default.
- Hover on a primary (ink) button is `#262C35`. Hover on a danger button is a `#FBECEB` wash.
- No gradients, glows or tinted shadows anywhere.

## Typography

Two families, plus a mono from the same family as the body text:

| Role | Font | Why |
|---|---|---|
| Headings and big numbers | **Inter** 600, slight negative tracking | Neutral and engineered; reads as enterprise software |
| UI and reading text | **Atkinson Hyperlegible Next** 400/600 | Designed by the Braille Institute for low-vision readers; accessibility-first is the product |
| System labels | **Atkinson Hyperlegible Mono** 500 | Step counters, keyboard hints, citations ("STEP 1 OF 3 → BILLING") |

Load all three from Google Fonts.

| Token | Use |
|---|---|
| `headline-lg` 28px | Page titles, onboarding question titles |
| `headline-md` 22px | Card, panel and dialog titles; empty-state headlines |
| `stat` 32px | The one number on a stat card |
| `title-md` 18px | Card sub-headings, assistant step titles |
| `body-lg` 18px | Onboarding intros and assistant answers (people read these while stressed, so keep them large) |
| `body-md` 16px | Default UI text, inputs |
| `body-sm` 14px | Metadata and helper text. Never for anything the user must act on |
| `label-md` 15px | Buttons, nav, tabs |
| `mono-sm` / `mono-xs` 13/12px | System annotations. May be uppercase, and they are the only uppercase in the system |

- Headlines are sentence case, never all caps.
- Minimum body size in the assistant panel is 16px, and it must scale with browser zoom.
- Reading line length is 60–72 characters (`max-w-[640px]` on page descriptions).
- Never set Inter below 22px except the wordmark and avatar initials. Never add
  negative tracking to Atkinson.

## Layout

Space is Haptic's main grouping tool. Before adding a border, divider, card or background
band, ask whether a step of space would say the same thing.

The scale is ten steps on a 4px base, with nothing in between. In code use Tailwind's
default numeric classes, which map 1:1 to the step numbers (`gap-3` = 12px, `p-6` = 24px).
Allowed suffixes: `0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32`.

**The proximity rule.** Spacing grows as relationships get looser, and each jump skips at
least one step so the difference is visible without any chrome:

| Relationship | Gap |
|---|---|
| Within an element | 4–8 (`tight`, `snug`) |
| Within a group | 12–16 (`related`, `inset`) |
| Between groups | 24–32 (`group`, `block`) |
| Between regions | 48–64 (`region`, `section-sm`) |
| Between marketing sections | 96–128 (`section`, `section-lg`) |

Padding inside a container is never smaller than the gap between items inside it.

**Off the scale, never write these:** 2px → 0 or 4 · 6px → 4 or 8 · 10px → 8 or 12 ·
20px → 16 or 24 · 28px → 24 or 32 · 40px → 32 or 48. Sizes (heights, widths, icon sizes)
are not spacing and may be any value.

**Screen layouts:**

- **Admin dashboard:** 248px left nav on paper; content on paper with 48px outer padding at
  ≥1024px (24px below); page header → content 48px; card grid gap 24px. Main column plus a
  340px side column.
- **Onboarding:** one question per screen, left column with a demo or helper on the right,
  a mono `SETUP n / 3` counter instead of a stepper. Question → answers 48px.
- **Assistant panel:** 400px wide, docked bottom-right of the host page with 24px inset (a
  bottom sheet under 640px).
- **Marketing:** 12-column grid, 1280px max content, 32px gutters, 64px outer margins,
  hairline column rules visible on hero and story sections.
- **Check every screen at phone (375px) and laptop (1280px) widths.**

## Elevation & Depth

The admin UI is flat: white cards with a hairline border on paper, no shadows.

The one exception is anything Haptic draws over a customer's page (the launcher, guidance
callouts, the assistant panel, the prototype bar). We don't control what's under them, so
they get a hairline border plus one shadow:

```
shadow-float: 0 1px 2px rgba(18,22,28,0.06), 0 8px 24px rgba(18,22,28,0.10)
```

**Guidance spotlight:** the host page is dimmed with ink at 40% opacity, the target is cut
out with a `rounded.md` hole and ringed with a 3px `signal` outline at a 2px offset. Users
can turn the dim off.

## Shapes

Small, consistent radii. Nothing is pill-shaped except a status dot.

| Radius | Use |
|---|---|
| `xs` 4px | kbd chips, the Verified badge, segmented-control thumb, chart bars, skeleton bars |
| `sm` 6px | Every button, nav items, list rows, tags, small tiles, logo avatars |
| `md` 8px | Inputs and textareas, guidance callouts, the launcher, the spotlight cut-out |
| `lg` 12px | Cards, the assistant panel, dialogs, demo and code frames |

Minimum hit target is 44 × 44px for everything interactive (`h-11`). A 36px control is
only allowed inside a toolbar that already gives it a 44px row.

**The logo, "the Press":** an ink square (7/32 corner radius) with a pointer cut out of it
as negative space, its tip resting on a small `signal` dot, the moment of contact.
Wordmark: "Haptic" in Inter 600, -0.03em, ink, 22px. On night the square inverts to
`on-night`.

**The Haptic cursor** (component name: `Touchpoint`): a standard ink arrow pointer with a
2px white edge and a soft drop shadow. It has no tail, which is what separates it from the
person's own tailed OS cursor so the two can sit side by side. It rests with its tip on the
next target. The *framed* variant, a white pointer on an ink disc, is the launcher and
panel avatar.

State is a small ink badge at the pointer's heel, never colour alone:

| State | Badge |
|---|---|
| idle / pointing | none |
| listening | three short bars |
| thinking | three dots lit in turn (0.9s loop; still and fully lit with reduced motion). The cursor doesn't move while thinking |
| stuck | exclamation mark. The target is missing, so the dim and ring are lifted |
| done | check |

When the cursor arrives, a single 3px signal ring expands from the target once, the
visual "haptic tap".

## Components

Fixed sizes, so copy them and don't re-decide:

| Component | Spec |
|---|---|
| Button | `rounded-sm`, `h-11 px-6`, `label-md`; large `h-14 px-8 text-[16px]`; icon gap 8. Variants: primary (ink), secondary (fill), ghost, danger (danger text), signal (ink text on signal, marketing hero only) |
| Input | `rounded-md`, white, `ring-1 ring-hairline`, focus `ring-2 ring-ink`; `h-12` default, `h-14` in onboarding; padding-x 16; label → input 8 |
| Form | field → field 24; last field → submit 32 |
| Card | `bg-surface border border-hairline rounded-lg`, padding 24 (or 32 for the main card); title → body 8 |
| List row | `rounded-sm`, padding 12 × 16; hover `fill`, selected `fill-strong` |
| Nav item | `h-11 rounded-sm px-3`, `label-md`; selected `bg-fill text-ink`, others `ink-muted` |
| Segmented control | `bg-fill rounded-sm p-1`; thumb `bg-surface rounded-xs h-10` |
| Kbd chip | `h-6 rounded-xs bg-fill px-2 mono-xs ink-muted` |
| Verified badge | `rounded-xs bg-verified-wash text-verified`, check icon + "Verified" |
| Launcher | bottom-right of host page, 24px inset; `h-12 rounded-md`, surface + hairline + `shadow-float`; framed cursor, "Ask Haptic", ⌥ Space kbd chips. **Must open the composer on click.** Speaking is the shortcut, not the only way in |
| Guidance callout | `rounded-md`, surface + hairline + `shadow-float`, padding 24, width 360; mono step label in `signal-ink` ("STEP 1 OF 3 → BILLING"), then a `title-md` verb |
| Assistant panel | 400px, `rounded-lg`, padding 24; step → step 16; answer → source citation 12 |
| Dialog | `rounded-lg`, padding 48, `shadow-float`; title → body 12; body → actions 32 |
| Focus ring | 2px ink outline, 2px offset (on night: `on-night`) |

**States every screen needs:**

- **Empty:** keep the loaded layout's slot, say in one sentence what will land there, and
  give the one action that fills it (e.g. "Waiting for the first question" → "Try it on
  ledgerly.com").
- **Loading:** the real page title, plus `fill-strong` skeleton bars (`rounded-xs`,
  pulsing) that keep the loaded layout's exact footprint so nothing jumps. Buttons waiting
  on the network show an inline spinner and keep their label.
- **Error:** lead with what happened in plain words, list the likely fixes, and show what
  was checked so a developer can act. Use `danger` only for the label, not a red page.

**Motion:** cursor travel 280ms `cubic-bezier(0.23, 1, 0.32, 1)`; contact ring one 240ms
ease-out pulse, never looping; panels and callouts 240ms opacity + 8px rise; button press
120ms scale to 0.98. With `prefers-reduced-motion` the cursor jumps instead of travelling,
and guidance must work fully with motion off.

## Do's and Don'ts

- Do anchor every marketing section with the product doing the thing.
- Do keep one signal element per view: the next action.
- Do cite a verified source under every factual assistant answer.
- Do write steps as verbs on visible labels: "Open Settings", "Choose Export".
- Do show keyboard shortcuts as kbd chips beside the action, and always offer a clickable
  way in too.
- Do group with space first, and add a border or fill only when space can't do it.
- Do pick spacing from the scale by relationship, never by eye.
- Do make every tap in a mockup go somewhere. A dead button reads as a broken product.

- Don't give the Haptic cursor a face, eyes, a mascot or a personality. No jokes, no
  chatter during a task. (We had a smiley orange face; enterprise testers said it looked
  like a toy.)
- Don't use pill buttons or big 24px+ "friendly" radii. The largest radius is 12px.
- Don't use a warm cream or beige background, or any accent colour besides signal.
- Don't use stat strips, testimonial walls or logo carousels as hero content (the
  Zendesk pattern).
- Don't use a chat-bubble widget or a floating round "AI sparkle" button as the launcher.
- Don't use signal for decoration, illustration, charts or backgrounds.
- Don't use gradients, glows, blobs, glassmorphism or abstract 3D shapes.
- Don't put white text on signal, or text lighter than `ink-subtle`.
- Don't use all caps outside mono system labels.
- Don't use off-scale spacing (2, 6, 10, 20, 28, 40px) or arbitrary spacing values.
- Don't nest a card in a card, or put a divider between items already 24px apart.
