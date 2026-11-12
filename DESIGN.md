---
version: alpha
name: Haptic
description: >-
  Design system for Haptic, an AI guide embedded in web apps. Covers the
  marketing site at joinhaptic.com (web/) and the embedded widget (src/widget).
  Built on shadcn/ui and Tailwind's default scale.
colors:
  # Light mode. Tailwind "stone", a warm neutral.
  primary: "#1C1917"
  primary-foreground: "#FAFAF9"
  background: "#FAFAF9"
  foreground: "#1C1917"
  card: "#FFFFFF"
  card-foreground: "#1C1917"
  muted: "#F5F5F4"
  muted-foreground: "#78716C"
  secondary: "#E7E5E4"
  secondary-foreground: "#1C1917"
  border: "#E7E5E4"
  input: "#E7E5E4"
  ring: "#1E6EF4"
  # The only chromatic colour in the system. Reserved for the pointer.
  pointer: "#1E6EF4"
  pointer-border: "#FFFFFF"
  # Marks a finished task. Nothing else.
  success: "#008932"
  success-foreground: "#FFFFFF"
  # Dark mode.
  primary-dark: "#F5F5F4"
  primary-foreground-dark: "#1C1917"
  background-dark: "#1C1917"
  foreground-dark: "#F5F5F4"
  card-dark: "#292524"
  card-foreground-dark: "#F5F5F4"
  muted-dark: "#35312E"
  muted-foreground-dark: "#A8A29E"
  secondary-dark: "#44403C"
  secondary-foreground-dark: "#F5F5F4"
  border-dark: "#44403C"
  input-dark: "#44403C"
  ring-dark: "#0091FF"
  pointer-dark: "#0091FF"
  pointer-border-dark: "#FFFFFF"
  success-dark: "#30D158"
  success-foreground-dark: "#1C1917"
typography:
  display:
    fontFamily: Geist
    fontSize: 60px
    fontWeight: 500
    lineHeight: 60px
    letterSpacing: -0.04em
  display-sm:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: 500
    lineHeight: 40px
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: 500
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: 500
    lineHeight: 32px
    letterSpacing: -0.02em
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
  label-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
  label-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 500
    lineHeight: 20px
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
  2xl: 48px
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
    rounded: "{rounded.full}"
    height: 36px
    padding: 16px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 36px
    padding: 16px
  button-hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 24px
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    height: 44px
    padding: 14px
  card:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: 24px
  browser-window:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
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
  target-mark:
    rounded: "{rounded.lg}"
  question-bubble:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: 12px
  reply-bubble:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: 12px
  ask-box:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
  done-mark:
    backgroundColor: "{colors.success}"
    textColor: "{colors.success-foreground}"
    rounded: "{rounded.full}"
    size: 20px
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
case is logged in web apps.

The look is quiet and exact. Soft black on off-white, set in Geist, with no
decoration. The pointer is the product, so it is the only thing on any screen
that has colour and the only thing that moves with intent. Everything else stays
still and grey so the pointer reads instantly.

The system sits on shadcn/ui and Tailwind's default scale. Sizes, radii and
spacing come from those scales, never from one-off values, so anything built
later matches what exists. In code the tokens live in `web/app/globals.css` as
shadcn's CSS variables.

**Name.** The product is Haptic, in title case. Never "haptic" or "HAPTIC".

**Voice.** Plain and direct. Marketing copy uses commas and periods only. No
dashes, semicolons, colons, exclamation marks or brackets. A question mark is
allowed only on a question in the FAQ. Headings and buttons are sentence case.
In copy, Haptic's arrow is "the pointer". "Cursor" means the visitor's own
mouse.

## Colors

Two neutrals carry the whole interface. One colour belongs to the pointer, and
one marks a finished task.
Neutrals are Tailwind's stone scale, which has a slight warmth so the page never
looks stark.

- **Ink (#1C1917):** Text, primary buttons and the caption bubble in light mode.
  A soft black, 16.7 to 1 on the page.
- **Paper (#FAFAF9):** The page in light mode. Off-white, not pure white.
- **Card (#FFFFFF):** The white that sits inside or on top of other surfaces:
  demo windows, the chat, and form inputs.
- **Muted (#F5F5F4):** The fill of every card, and of the ask box.
- **Muted text (#78716C):** Sub-copy and secondary labels. 4.6 to 1 on Paper.
- **Border (#E7E5E4):** Hairlines and the secondary button.
- **Pointer blue (#1E6EF4):** The pointer, the mark around its target and the
  keyboard focus ring. Nothing else.
- **Done green (#008932):** The small round tick that says a task is finished.
  Blue means in progress and green means done, so the two never share a screen.
  Not for buttons, text or bubbles.

Dark mode follows the visitor's system setting and swaps the roles. The page
becomes Ink (#1C1917), text becomes #F5F5F4, cards are #292524, borders are
#44403C, the pointer brightens to #0091FF and Done green to #30D158. Every
light token has a `-dark` twin in the front matter.

**Why blue.** It holds at least 3.8 to 1 against both pages, so one hue works
in both modes, and it keeps its full colour for people with red-green colour
blindness.

**Pointer border and shadow.** The pointer always carries a 1.5px white border
and a shadow underneath. On a white page the fill does the work, on a dark or
coloured page the border does, and the shadow lifts it off whatever it sits on.
This is what lets one fixed colour work on any customer's site.

## Typography

One family, Geist, in two weights. Regular (400) for reading and Medium (500)
for headings, buttons and labels. Bold is not used. Geist is free, works on
every device, and is hosted with the site.

- **Display (60px, Medium, -0.04em):** The hero headline. One per page. Drops
  to 36px below 640px wide.
- **Headline (36px and 24px, Medium):** Page and section titles.
- **Body (18, 16, 14px, Regular):** 18px for hero sub-copy, 16px for reading and
  FAQ, 14px for interface text inside the demo and the widget.
- **Label (16, 14, 13px, Medium):** Buttons, navigation and small controls.

Large type is tracked in and nothing is set below 12px. Keep running text under
65 characters per line. Sizes are Tailwind's `text-6xl`, `text-4xl`, `text-2xl`,
`text-lg`, `text-base` and `text-sm`.

The widget is the exception. It uses the system interface font, so it never
loads a font on a customer's site.

## Layout

A single centred column. The container is 1024px (`max-w-5xl`) with 24px
gutters, which leaves 976px of content. The hero demo and the FAQ both fill
that width.

Spacing is a 4px grid, and most gaps are multiples of 8. The hero stacks with a
fixed rhythm: 24px from headline to sub-copy, then 64px to the demo window. Sections are 128px apart on desktop and 80px on phones.

The home page is, in order: a slim navigation bar, the hero with its demo
window, three feature cards, the FAQ, and a footer with Privacy, Terms and the
contact address. Each feature card makes one claim in a title of a few words,
with the text on the left and a small live demo on the right in a Border grey
panel. Below 1024px the card stacks, text above the demo, so a demo is never
squeezed. The
FAQ is two columns on desktop, with the title on the left and the accordion in
the right half. Each row is 20px padding around a 24px line with a 1px divider.

The request access page is two columns. The pitch sits on the left, as a
headline over a card. The form sits on the right in a second card, with its
inputs in Card white. Below 768px everything is one column.

There is one call to action on the whole site, "Request access". It sits in
the navigation, top right on every page and every screen size, and leads to
that page. The hero carries no second copy of it, so the demo follows the
sub-copy directly. There is no
"Contact sales", because Haptic is in early access and has no sales team or
price list to point to.

Surfaces nest the same way on every page. The page is Paper. A card on the
page is Muted with a 1px border. Anything inside a card that needs to stand out
is Card white, or sits on a Border grey panel. A demo window is always Card
white with a 1px border, whether it sits on the page or inside a card.

Inside any mock interface, every control sits on the same grid. Rows are 64px,
buttons are 32px, and text is centred in its control with flex, never with
padding guesses.

## Elevation & Depth

Flat. Hierarchy comes from the step between Paper and Card and from 1px borders,
not from shadows. Three things are allowed a shadow, because they float above
content: the demo window (`shadow-sm`), the widget's launcher and ask box, and
the pointer with its caption. No gradients, no blur, no glass.

The pointer's shadow is two layers, a tight one and a soft one:
`drop-shadow(0 1px 1px rgb(0 0 0 / .3)) drop-shadow(0 5px 9px rgb(0 0 0 / .26))`.

## Shapes

Corners follow shadcn's radius scale with `--radius` at 10px, using the same
steps shadcn gives its own components, so nothing needs a one-off value.

- **14px (`rounded-xl`):** every surface. Cards, demo windows, the chat, chat
  bubbles and the caption.
- **10px (`rounded-lg`):** anything inside a surface. Inputs, the ask box,
  alerts, menus, inner panels and rows.
- **8px (`rounded-md`):** small items inside those, such as menu and list rows.
- **Full pill:** buttons, the launcher and avatars.

**The pointer.** A tailless arrowhead with rounded corners and a shallow notch
in its back edge, tilted so the tip points up and to the left. It is drawn on a
24px grid, with the tip at (3.81, 3.14). The source is `assets/pointer.svg`, and
every pointer in the product and on the site is that one path. It is also the
logo mark and the favicon, where it is Ink with a white border.

The pointer's tip sits in the lower right corner of whatever it points at, so
the pointer hangs off the control and never covers its label.

Icons are Lucide at their default stroke, 16px.

## Components

Components are shadcn/ui, restyled only through tokens and variants.

- **Button:** Pills. Primary is Ink with Paper text. Secondary is the Border
  grey. 32px by default, 36px in the navigation, 44px for the hero and forms.
  One primary button per view.
- **Navigation:** 64px tall. Pointer mark and "Haptic" on the left, links and
  one primary button on the right.
- **Demo window:** A browser frame on Card, with the three window dots in their
  usual red, yellow and green so it reads as a real window at a glance. It
  plays one scripted task on a loop. The person types
  a question, Haptic thinks, the pointer walks through each step, and Haptic
  confirms at the end.
- **Pointer:** 24px. Glides to its target, and dips with the mark when the
  person clicks. No face, no mascot.
- **Target mark:** A 2px Pointer blue outline that stands 3px off the control,
  with a thin white edge on both sides and a soft shadow, the same recipe as
  the pointer. The gap and the white edge are what stop it reading as the
  control's own keyboard focus ring.
- **Caption:** Ink bubble with Paper text, 14px, at most 288px wide. Text only.
  It sits under the target, or above when the space under it is busy, and
  never over the next control.
- **Chat:** Haptic's home, in the bottom right corner where support chat
  usually lives. A Card panel holding the conversation and the ask box. It
  stays open from the first question to the last step.
- **Ask box:** shadcn's input group: a Muted field with the text on top and a
  round Ink send button on a row beneath. While Haptic is guiding, send becomes
  a stop button.
- **Bubbles and status:** shadcn's chat parts. The person's question is an Ink
  bubble on the right. Haptic's reply is a Muted bubble on the left. Status
  sits under them as one line. While Haptic thinks it is the word "Thinking"
  with a lighter shade sweeping across it, shadcn's `shimmer`, with no icon.
  While it points it reads "Showing you how". When it finishes it is the green
  tick and "Done".
- **Form:** Labels above 44px inputs and one primary button. Success and error
  use shadcn's alert, with an icon, a short title and one line of detail.
- **Accordion:** FAQ rows with a plus that turns to a cross. One row open at a
  time.

**Motion.** Restrained. The pointer glide is the one signature movement. It
eases out with `cubic-bezier(.2, .8, .2, 1)`, quick to leave and slow to land,
and takes 400 to 700ms depending on how far it travels. It is the one movement
allowed to run longer than 300ms, because the eye has to follow it. Everything
else is a fade, a small scale or a height change of 150 to 250ms that eases
out. Nothing grows from nothing: things arrive from within a few percent of
their final size. A click is acknowledged like a pressed button, with the mark
dipping to 97 percent and back in a quarter of a second, and no ripple. With reduced motion on, the pointer jumps
to its target and each demo holds one still frame.

## Interaction

How a guide should feel. Only what the designer has signed off belongs here.
Behaviour that merely exists in the widget code is not a design decision, and
the widget in `src/widget` does not follow this model yet.

Signed off: Haptic sits in the bottom right, in the place of support chat,
because it is meant to replace it. The chat stays open once a question is
asked. Thinking is a shimmer across the word. The rest below is proposed.

- **Haptic guides, the person acts.** Haptic points and explains. It does not
  click, type or scroll for anyone.
- **Mark the control, leave the page alone.** One outline on the target. The
  page is never dimmed, because the person may need to read it, and the edge of
  the window never glows, because that is how agents signal that an AI has
  taken control.
- **Motion arrives, then stops.** The glide leads the eye. The mark draws in
  from slightly larger as the pointer lands, then holds still. If nothing
  happens for about four seconds the mark pulses once, and no more often than
  that.
- **Say one thing.** A caption names the next action in a short sentence. It
  carries no buttons.
- **Keep the conversation and the exit in view.** The chat stays open for the
  whole guide, with the question at the top and a stop button in the ask box.
- **A wrong click is not an error.** Haptic reads the new page and carries on
  from there without comment.
- **Finish plainly.** Haptic confirms in a sentence, shows the green tick, and
  reopens the ask box.

## Do's and Don'ts

- Do keep Pointer blue for the pointer, its target mark and focus.
  Never for text, buttons or links.
- Do give the pointer its white border and shadow everywhere.
- Do use sizes, radii and spacing from the scales above. No one-off values.
- Do check both modes. Every colour has a dark twin.
- Do centre text in controls with flex, and keep every control on the 4px grid.
- Don't replace the visitor's own mouse cursor.
- Don't let the pointer or a caption cover the label it is pointing at.
- Don't use Done green for anything but the finished mark.
- Don't add another colour, a gradient, an illustration or artwork. Paintings
  behind the demos were tried and turned down. The window dots on the demo
  frame are the one borrowed exception.
- Don't use Bold, italics for emphasis, or text smaller than 12px.
- Don't show logos, quotes or numbers that are not real.
- Don't use punctuation beyond commas and periods in marketing copy.
