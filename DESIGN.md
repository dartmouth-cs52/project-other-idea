---
version: alpha
name: Haptic
description: >-
  Design system for Haptic, an AI guide embedded in web apps. Covers the
  marketing site at joinhaptic.com and the embedded widget. Built on shadcn/ui
  and Tailwind's default scale. Draft, pending sign-off on font fallback and
  pointer colour.
colors:
  # Light mode. Tailwind "stone", the warm neutral that shadcn ships.
  primary: "#1C1917"
  primary-foreground: "#FAFAF9"
  primary-hover: "#292524"
  background: "#FAFAF9"
  foreground: "#1C1917"
  card: "#FFFFFF"
  card-foreground: "#1C1917"
  muted: "#F5F5F4"
  muted-foreground: "#78716C"
  secondary: "#E7E5E4"
  secondary-foreground: "#1C1917"
  secondary-hover: "#D6D3D1"
  border: "#E7E5E4"
  input: "#E7E5E4"
  ring: "#1E6EF4"
  # The only chromatic colour in the system. Reserved for the pointer.
  pointer: "#1E6EF4"
  pointer-border: "#FFFFFF"
  # Dark mode.
  primary-dark: "#F5F5F4"
  primary-foreground-dark: "#1C1917"
  primary-hover-dark: "#E7E5E4"
  background-dark: "#1C1917"
  foreground-dark: "#F5F5F4"
  card-dark: "#292524"
  card-foreground-dark: "#F5F5F4"
  muted-dark: "#292524"
  muted-foreground-dark: "#A8A29E"
  secondary-dark: "#44403C"
  secondary-foreground-dark: "#F5F5F4"
  secondary-hover-dark: "#57534E"
  border-dark: "#44403C"
  input-dark: "#44403C"
  ring-dark: "#0091FF"
  pointer-dark: "#0091FF"
  pointer-border-dark: "#FFFFFF"
typography:
  display:
    fontFamily: Helvetica Neue
    fontSize: 60px
    fontWeight: 500
    lineHeight: 60px
    letterSpacing: -0.025em
  display-sm:
    fontFamily: Helvetica Neue
    fontSize: 36px
    fontWeight: 500
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Helvetica Neue
    fontSize: 36px
    fontWeight: 500
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Helvetica Neue
    fontSize: 24px
    fontWeight: 500
    lineHeight: 32px
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Helvetica Neue
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
  body-md:
    fontFamily: Helvetica Neue
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Helvetica Neue
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Helvetica Neue
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
  label-md:
    fontFamily: Helvetica Neue
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  label-sm:
    fontFamily: Helvetica Neue
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.01em
rounded:
  none: 0px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  2xl: 18px
  3xl: 22px
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 40px
  3xl: 64px
  4xl: 128px
  gutter: 24px
  container: 1024px
  content: 976px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 16px
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
    textColor: "{colors.secondary-foreground}"
  button-hero:
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 24px
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 12px
  browser-window:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.3xl}"
  accordion-row:
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
    padding: 20px
  pointer:
    backgroundColor: "{colors.pointer}"
    size: 24px
  pointer-caption:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: 12px
  highlight-ring:
    rounded: "{rounded.md}"
  launcher:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 16px
---

# Haptic

## Overview

Haptic is an AI guide that lives inside a company's web app. A person says what
they want to do, and a pointer walks them to the right controls, step by step.
The buyer is a product or support leader at a software company. The first use
case is logged-in web apps.

The look is quiet and exact. Soft black on off-white, set in Helvetica, with no
decoration. The pointer is the product, so it is the only thing on any screen
that has colour and the only thing that moves with intent. Everything else stays
still and grey so the pointer reads instantly.

The system sits on shadcn/ui and Tailwind's default scale. Sizes, radii and
spacing come from those scales, never from one-off values, so anything built
later matches what exists.

**Name.** The product is Haptic, in title case. Never "haptic" or "HAPTIC".

**Voice.** Plain and direct. Marketing copy uses commas and periods only. No
dashes, semicolons, colons, exclamation marks or brackets. A question mark is
allowed only on a question in the FAQ. Headings and buttons are sentence case.
In copy, Haptic's arrow is "the pointer". "Cursor" means the visitor's own
mouse.

## Colors

Two neutrals carry the whole interface, and one colour belongs to the pointer.
Neutrals are Tailwind's stone scale, which has a slight warmth so the page never
looks stark.

- **Ink (#1C1917):** Text, primary buttons and the caption bubble in light mode.
  A soft black, 16.7 to 1 on the page.
- **Paper (#FAFAF9):** The page in light mode. Off-white, not pure white.
- **Card (#FFFFFF):** Raised surfaces, such as the demo window and inputs, so
  they lift off the page without a shadow.
- **Muted text (#78716C):** Sub-copy and secondary labels. 4.6 to 1 on Paper.
  Do not set it on the Muted surface, where it drops below 4.5.
- **Border (#E7E5E4):** Hairlines and the secondary button fill.
- **Pointer blue (#1E6EF4):** The pointer, its highlight ring and the keyboard
  focus ring. Nothing else.

Dark mode swaps the roles. The page becomes Ink (#1C1917), text becomes
#F5F5F4, cards are #292524, borders are #44403C, and the pointer brightens to
#0091FF. Every light token has a `-dark` twin in the front matter. In code they
map to shadcn's CSS variables under `:root` and `.dark`.

**Why blue.** It holds at least 3.8 to 1 against both pages, so one hue works
in both modes. It keeps its full colour for people with red-green colour
blindness, where green loses about 40 percent. Green also reads as "done" or
"success", which is the wrong signal for "click here".

**Pointer border.** The pointer always carries a 1.5px white border and a soft
shadow. On a white page the fill does the work, and on a dark or coloured page
the border does. This is what lets a fixed colour sit on any customer's site.

## Typography

One family, Helvetica Neue, in two weights. Regular (400) for reading and
Medium (500) for headings, buttons and labels. Bold is not used.

Font stack: `"Helvetica Neue", "Inter", Arial, sans-serif`. Helvetica Neue
ships on Apple devices only. Everyone else gets Inter, self-hosted as a variable
font, which the browser downloads only when Helvetica Neue is missing.

- **Display (60px, Medium, -0.025em):** The hero headline. One per page. Drops
  to 36px below 640px wide.
- **Headline (36px and 24px, Medium):** Section titles.
- **Body (18, 16, 14px, Regular):** 18px for hero sub-copy, 16px for reading and
  FAQ, 14px for interface text inside the demo and the widget.
- **Label (16, 14, 12px, Medium):** Buttons, navigation and small captions.

Helvetica Neue is tight at small sizes. Large type is tracked in, 14px and
below is tracked slightly out, and nothing is set below 12px. Keep running text
under 65 characters per line. Sizes are Tailwind's `text-6xl`, `text-4xl`,
`text-2xl`, `text-lg`, `text-base`, `text-sm` and `text-xs`.

## Layout

A single centred column. The container is 1024px (`max-w-5xl`) with 24px
gutters, which leaves 976px of content. The hero demo and the FAQ both fill
that width.

Spacing is a 4px grid, and most gaps are multiples of 8. The hero stacks with a
fixed rhythm: 24px from headline to sub-copy, 32px to the buttons, 64px to the
demo window. Sections are 128px apart on desktop and 80px on phones.

The page is, in order: a slim navigation bar, the hero with its demo window, the
FAQ, and a footer with links to Privacy and Terms. The FAQ is two columns on
desktop, with the title on the left and the accordion in the right half. Each
row is 20px padding around a 24px line with a 1px divider, 65px in all. Below
768px everything is one column.

## Elevation & Depth

Flat. Hierarchy comes from the step between Paper and Card and from 1px borders,
not from shadows. Two things are allowed a shadow, because they float above
content: the demo window (`shadow-sm`) and the pointer with its caption. No
gradients, no blur, no glass.

## Shapes

Corners follow shadcn's radius scale with `--radius` at 10px. Buttons and inputs
are 8px. Cards are 14px. The demo window is 22px. The pointer caption is 14px.
The widget's launcher is the one full pill, so it reads as separate from the
customer's own interface.

**The pointer.** A tailless arrowhead with rounded corners and a shallow notch
in its back edge, tilted so the tip points up and to the left. It is drawn on a
24px grid, with the tip at (3.8, 3.1). The source is `pointer.svg`, and every
pointer in the product and on the site is that one path. It is also the logo
mark and the favicon, where it is Ink with a white border.

Icons are Lucide at a 1.5px stroke, 16px or 20px.

## Components

Components are shadcn/ui, restyled only through tokens.

- **Button:** Primary is Ink on Paper text. Secondary is the Border grey. Height
  36px, and 44px for the two hero buttons. One primary button per view.
- **Navigation:** 64px tall. Pointer mark and "Haptic" on the left, links and
  one primary button on the right.
- **Demo window:** A browser frame on Card, with three grey window dots, never
  red, yellow and green. It plays one scripted task on a loop.
- **Pointer:** 24px. Glides to its target, pulses once when the visitor should
  click, and shows three dots while thinking. No face, no mascot.
- **Highlight ring:** 2px Pointer blue with a 4px ring of the same blue at 25
  percent, 4px outside the target.
- **Caption:** Ink bubble with Paper text, 14px, at most 320px wide, placed
  beside the target and never over it.
- **Ask box and launcher:** The widget's entry point. A pill launcher that opens
  a single text field on Card.
- **Accordion:** FAQ rows with a plus that turns to a cross. One row open at a
  time.

**Motion.** Restrained. The pointer glide is the one signature movement, 550ms
with `cubic-bezier(.2, .8, .2, 1)`, and it is the same curve on the site as in
the widget. Everything else is a 150 to 200ms fade or height change. With
reduced motion on, the pointer jumps to its target and the demo becomes a
stepper.

## Do's and Don'ts

- Do keep Pointer blue for the pointer, its ring and focus. Never for text,
  buttons or links.
- Do give the pointer its white border and shadow everywhere.
- Do use sizes, radii and spacing from the scales above. No one-off values.
- Do check both modes. Every colour has a dark twin.
- Don't replace the visitor's own mouse cursor.
- Don't add a second accent colour, a gradient or an illustration.
- Don't use Bold, italics for emphasis, or text smaller than 12px.
- Don't show logos, quotes or numbers that are not real.
- Don't use punctuation beyond commas and periods in marketing copy.
