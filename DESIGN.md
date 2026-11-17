---
version: alpha
name: Haptic
description: >-
  Design system for Haptic, an AI guide embedded in web apps. Covers the
  marketing site at joinhaptic.com (web/), the dashboard behind its sign-in,
  and the embedded widget (src/widget). Built on shadcn/ui and Tailwind's
  default scale.
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
  error: "#DC2626"
  error-dark: "#F87171"
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
  # The dashboard. See Dashboard below.
  dashboard-bar: 56px
  dashboard-sidebar: 224px
  dashboard-content: 1152px
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
    # Ink, or the site's own colour when the company matched it. See Components, Launcher.
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 40px
    padding: 16px
  # The dashboard. Proposed, see Dashboard below.
  dashboard-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xl}"
    padding: 20px
  dashboard-nav-row:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 10px
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
still and grey so the pointer reads instantly. The one exception is the glow
that falls down the page while Haptic thinks. It is gone the moment the reply
arrives, so it and the pointer are never on the page together for long.

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
one marks a finished task. The thinking glow is the pointer's colour with its
two neighbours, and is the only place another hue is seen.
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
- **Pointer blue (#1E6EF4):** The pointer, the mark around its target, the
  keyboard focus ring and the heart of the thinking glow. Nothing else.
- **Thinking glow (#77D0FE, #5294FF, #8460EE):** One soft band over the page
  while Haptic thinks: sky at its trailing edge, a lighter Pointer blue through
  its middle, indigo at its leading edge. The three are the pointer's colour
  and its neighbours 28 degrees to one side and 30 to the other in OKLCH,
  mixed in OKLCH so they melt into each other with no seam. Staying that close
  to the pointer's hue is what keeps it Haptic's and not a general AI rainbow,
  and it means a customer's own accent gets a glow of its own neighbours: an
  orange pointer glows peach to amber, a green one lime to teal. The three hex
  values are what Pointer blue gives, and what a browser without relative
  colours falls back to. Violet and pink were tried first and turned down:
  they are furthest from the pointer, they are what every other AI product
  uses, and violet is the darkest of them over a page. Never used flat, and
  never outside the glow.
- **Done green (#008932):** The small round tick that says a task is finished.
  Blue means in progress and green means done, so on a visitor's page the two
  never share a screen. Not for buttons or bubbles. In the dashboard it also
  says good, as set out under Dashboard.
- **Error red (#DC2626):** Forms. The star on a required field, the outline
  and message on a field that failed its check, and the alert when sending
  fails. It is shadcn's destructive colour. In the dashboard it also says bad,
  as set out under Dashboard.

Dark mode follows the visitor's system setting and swaps the roles. The page
becomes Ink (#1C1917), text becomes #F5F5F4, cards are #292524, borders are
#44403C, the pointer brightens to #0091FF, Done green to #30D158 and Error red
to #F87171. Every
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
that width. The dashboard has a frame of its own, set out under Dashboard.

Spacing is a 4px grid, and most gaps are multiples of 8. The hero stacks with a
fixed rhythm: 48px above the headline, 24px from headline to sub-copy, then
48px to the demo window. Sections are 128px apart on desktop and 80px on phones.

The hero demo window fits the screen it is on. On a desktop its stage is
between 464px and 576px tall, sized so the whole window sits above the fold
with 24px to spare. Haptic's ask box is in the bottom right corner of that
window and the demo starts there, so it must never be cut off. Screens under
834px tall get the 464px minimum, the shortest stage that holds every step of
the demo.

The home page is, in order: a slim navigation bar, the hero with its demo
window, three feature cards, pricing, the FAQ, and a footer with Privacy, Terms
and the contact address. Each feature card makes one claim in a title of a few words,
with the text on the left and a small live demo on the right. The demo's white
window sits straight on the card's Muted fill, with no panel of its own behind
it. Below 1024px the card stacks, text above the demo, so a demo is never
squeezed. The
FAQ is two columns on desktop, with the title on the left and the accordion in
the right half. Each row is 20px padding around a 24px line with a 1px divider.

Pricing opens with its title alone. Under it sit the plans, one card each on
the same Muted surface as a feature card, four across on desktop, two across
from 640px and one below that. A card holds the plan's name, its price at the
24px headline size, what the price includes, and who it is for in a few Muted
words. Those four line up across the cards in a row, so each starts at the
same height in every card. Text in a card is wrapped so a line does not end on
a single word (`text-pretty`, where the browser supports it). The price is the
largest thing in the card and no larger than a feature card's title. No plan
is marked as the popular one, and a card has no button, because the site has
one call to action. Two short sentences of 14px Muted text under the cards say
what is charged for, on one line from 820px up. The plans and those sentences live in `web/lib/site.ts`.

The request access page is two columns. The pitch sits on the left, as a
headline over a card. The form sits on the right in a second card, with its
inputs in Card white. Below 768px everything is one column.

The form is two short steps in the same card. The first asks for a work email
and a company, and its button says Continue. The second asks for a first and
last name, side by side, and has a box for details that may be left empty,
with Back and Request access under it. Nothing is sent until the second step. Once it is
sent, the card holds a two line thank you in the feature card type, a Medium
title over Muted text, and no icon.

There is one call to action on the whole site, "Request access". It sits in
the navigation, top right on every page and every screen size, and leads to
that page. The hero carries no second copy of it, so the demo follows the
sub-copy directly, and the plan cards under Pricing carry no buttons of their
own. There is no "Contact sales", because Haptic is in early access and has no
sales team. The Enterprise plan says Custom and leaves the way in to Request
access.

Surfaces nest the same way on every page. The page is Paper. A card on the
page is Muted with a 1px border. Anything inside a card that needs to stand out
is Card white, or sits on a Border grey panel. A demo window is always Card
white with a 1px border, whether it sits on the page or inside a card.

Inside any mock interface, every control sits on the same grid. Rows are 64px,
buttons are 32px, and text is centred in its control with flex, never with
padding guesses.

## Elevation & Depth

Flat. Hierarchy comes from the step between Paper and Card and from 1px borders,
not from shadows. Four things are allowed a shadow, because they float above
content: the demo window (`shadow-sm`), the widget's launcher and ask box, the
pointer with its caption, and in the dashboard a menu and the card a chart
shows under the mouse (`shadow-sm`). No gradients, no blur, no glass. The
thinking glow is the one gradient, and it is soft colour passing over the page,
never a blur of what is behind it.

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

**The link preview.** When a link to the site is shared in a message, the
picture is the pointer and the name Haptic on Paper, and nothing else. The
pointer there is the live one, Pointer blue with its white border and shadow.

**The lockup.** That same pair, the live pointer beside the name, is the lockup,
and it is what stands for Haptic anywhere there is room for the name. The name
is Geist Medium in Ink, tracked in by 0.04em like other large type. The pointer
is about as tall as a capital letter, centred on it, and half a capital's
height to its left. `assets/logo-light.svg` and `assets/logo-dark.svg` are the
lockup with the name drawn as outlines, for places that cannot load Geist, such
as the README. The dark one is for dark backgrounds. Its name is #F5F5F4 and
its pointer is the dark-mode blue, #0091FF.
The line under the picture is "The AI guide that lives in your product".

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
- **Target mark:** A 2px Pointer blue outline that stands 4 to 5px off the control,
  with a thin white edge on both sides and a soft shadow, the same recipe as
  the pointer. The gap and the white edge are what stop it reading as the
  control's own keyboard focus ring.
- **Caption:** Ink bubble with Paper text, 14px, at most 288px wide. Text only.
  It sits under the target, or above when the space under it is busy, and
  never over the next control.
- **Launcher:** The pill in the bottom right corner that opens the chat. Ink
  with Paper words. A company can give it its own site's colour, so it looks
  like part of the site, the way a support button does. Its words are then
  Paper or Ink, whichever reads better on that colour. The pointer never takes
  the site's colour. The two have opposite jobs: the launcher belongs to the
  site, and the pointer has to be seen against it. A green pointer on a green
  sidebar was tried and could hardly be found.
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
  tick and "Done". The chat itself never glows.
- **Thinking glow:** Soft colour over the page, from its top to its bottom,
  and only while Haptic is thinking. It is not in the chat, and the chat, the
  pointer, the mark and the caption are drawn over it and are never tinted. A
  band the width of the page comes in at the top edge and falls towards the
  bottom, once for each wait. Nobody knows how long a wait will be, so the
  band is paced to it: quick at first and slower the longer the wait goes on,
  halfway down after 1.2 seconds, which is a typical wait, two thirds after 2
  and four fifths after 3, always on its way and never at the bottom before
  the reply. The moment the reply arrives it goes the rest of the way and off
  the page in under half a second, fading, so every wait is one pass from top
  to bottom and the page is clear by the time the pointer lands. A reply that
  failed and a guide that was stopped end it the same way. It is smooth before
  anything else: one band, about a third of the page thick, whose strength is
  a bell with no flat top and no edge, a touch thicker in the middle of the
  page than at its sides, at about six tenths of full strength at its heart.
  It is multiplied into a light page, so the page's words stay dark and sharp
  through it, and screened into a dark one. It takes no clicks.
- **Form:** Labels above 44px inputs and one primary button. A required field
  has an Error red star after its label, and a field with no star may be left
  empty. A step that has a way back puts a secondary Back button to the left of
  the primary one. Each field is checked when its step is submitted. A field
  that fails gets an Error red outline and one 13px line under it saying what
  to type, the first such field takes the focus, and the line goes as soon as
  the person starts typing. A failure that is not one field's fault uses
  shadcn's alert, with an icon, a short title and one line of detail, under the
  form's buttons. Success replaces the form with a thank you. Every form on the
  site and in the dashboard works this way, sign-in included, and so do the
  server's refusals: one that names a field shows under that field. The parts
  are in `web/components/form.tsx`. A page, or part of one, that could not load
  is a card with a title, the reason in Muted text and, where it could help, Try
  again. It has no Error red, because it is not a form.
- **Accordion:** FAQ rows with a plus that turns to a cross. One row open at a
  time.

**Motion.** Restrained. The pointer glide is the one signature movement. It
eases out with `cubic-bezier(.2, .8, .2, 1)`, quick to leave and slow to land,
and takes 400 to 700ms depending on how far it travels. It and the thinking
glow are the two movements allowed to run longer than 300ms: the eye has to
follow the glide, and the glow lasts exactly as long as the wait. Everything
else is a fade, a small scale or a height change of 150 to 250ms that eases
out. Nothing grows from nothing: things arrive from within a few percent of
their final size. A click is acknowledged like a pressed button, with the mark
dipping to 97 percent and back in a quarter of a second, and no ripple, whether
the person clicks or Haptic presses for them. With reduced motion on, the pointer jumps
to its target, there is no glow and no shimmer, and each demo holds one still frame.

Scrolling never changes what a demo shows. A demo waits on its first frame,
starts once about a third of it is on screen, and keeps playing until it has
left the screen completely. Nothing switches while any of it can be seen.

## Dashboard

Signed off: colour says how a guide stands and which way a number moved, and
no page says that it is live. The rest below is proposed. It is built, in
`web/components/app`.

The dashboard is where a company sees what its people asked and how each guide
went. It is read at a glance and many times a day, so it is denser than the
site. The colours, the pills, the icons and the voice are the same. What
changes is the frame, the size of the type and one rule about surfaces.

**Frame.** A 56px bar runs across the top and reads as a path. The pointer mark
and Haptic come first and lead to the list of sites. The site comes next, and
is a menu of the company's sites, with All sites and Add a site under them. Who
is signed in is on the right, in a menu that names their company and holds Sign
out. Inside a site its pages run down a 224px column on the left. Each is a
32px row with a 16px icon. The page you are on is Border grey with Ink text,
and the others are Muted text. The column is fixed to the window, so it and
the line beside it stay where they are however far the page scrolls. Below
1024px the column becomes a row under the bar that scrolls sideways. Content
is up to 1152px wide (`max-w-6xl`).

**Pages.** A site has five, in this order, and no more are added without a
reason a customer gave.

- **Overview.** Is it working. Four numbers, the newest questions as they
  happen, guides each day, how guides ended, and the three questions most
  people could not find. A site nobody has asked anything yet says what will
  show here, with a button to go and ask the first question.
- **Questions.** Every question, newest first, as a table to search and filter.
  A row opens its guide.
- **Gaps.** What the company can fix. What people can't find, guides that
  stopped finishing, where people give up and the steps they click past.
- **Knowledge.** What Haptic reads and what the company has corrected. Notes,
  help docs, corrections, the controls never to point at, and the pages read.
- **Settings.** Three tabs. General holds the site's name, the widget's two
  colours and deleting the site. Install holds the script and where it runs.
  Usage holds the finished guides, month by month, which are what billing
  counts.

A company chooses two colours. The Ask button's is the one to match: a
secondary button, "Match website", reads the site's own colour from its first
page and saves it in one press. A grey, a near white or a near black is never
taken. The pointer's colour is Haptic's blue, and stays so unless the company
changes it. When it is anything else, "Use Haptic blue" puts it back. The
launcher sits bottom right on every site, where support chat usually lives,
and that is not a setting. Deleting a site leads back to the list of sites.

**Sites.** A company with one site lands inside it. With more than one, the
first page is the list, one card a site. Sites whose script is running come
first, the one asked most recently at their head, and those still waiting for
the script come last, so the first card is the one with something happening.
A card says how many questions the last seven days had and how many finished,
the last fortnight as fourteen small bars, and the newest question. A site
still waiting for its script says so in place of the numbers. A running site
carries no badge to say it is running: the numbers say that, and the green
tick is kept for a guide that finished, so a card never has two ticks that
mean different things. The whole card is the way in. Add a site leads to the
setup screens, which have a frame of their own.

A site is shown with its own icon, the one its browser tab has, 20px in a 36px
white tile with a 1px border, on its card and in the menu of sites. The first
letter of its name, on Border grey, stands in while the icon loads and for a
site that has none. This is the one place a customer's own mark appears.

A site goes by its name alone, in the bar, in the menu and on its card. Its
address is added in Muted text only when two of a company's sites share a
name, which is the one time it is needed to tell them apart.

**Type.** One 24px Medium title a page, the headline size, with no line under
it: the bar above already says which site this is. Card titles are
16px Medium. Text, rows and tables are 14px. Notes under a number, table
headings and the foot of a card are 12px Muted. A number in a tile is 36px
Medium. Forms keep their 44px inputs, as everywhere.

**Surfaces.** In the dashboard a card is Card white on Paper, with the 1px
border and 14px corners. This is the one place the nesting differs from the
site, where a card is Muted. A list of records inside a Muted card needed a
white panel of its own, which made three surfaces for one list. Here the rows
run edge to edge inside the card with hairlines between them, and the row
under the mouse is Muted. The pages around sign-in, and the install page a
developer is sent, keep Muted cards.

**Numbers.** The four are guides finished, finish rate, couldn't guide, and
median time to finish. A tile is a 14px Medium label in Muted text, the number
at 36px, and the change. What a number counts is not spelled out on the tile.
It is one hover or press away, on a small mark beside the label, in an Ink
bubble like the pointer's caption. A change against the same number of days before is said in
words, such as "Up 12% on the previous 30 days", with a small arrow. The arrow
and the words that say what moved, "Up 12%", are Done green when the number
went the way it should and Error red when it did not. Which way is good
depends on the number: more guides finished is good, more questions Haptic
couldn't guide is not, and a shorter time to finish is good. The rest of the
line is Muted text, and a number that did not move is Muted throughout. A new
number arrives from 4px below in 200ms, which is how a tile shows it changed.

**Colour.** The dashboard is the one place the three colours say how something
stands, so a list can be read without reading it. Each is a 16px mark before
the words, and the words stay in the text colour.

- **Under way** is the pointer itself, Pointer blue with its white border and
  shadow, because that is what is moving on someone's screen.
- **Finished** is the green tick.
- **A green dot** is a guide that got the person there another way: answered
  from the help docs, or answered and not clicked.
- **A red dot** is a guide Haptic couldn't guide: nothing to point at, a loop,
  out of steps, an error, not in the help docs, or abandoned. These are the
  guides the top row counts as ones Haptic couldn't guide.
- **A grey dot** is one that was never Haptic's to answer: stopped by the
  visitor, left for a person, off topic, or a control the company ruled out.
  It is also a guide under way that has gone quiet, which reads "Paused".

What the person said outweighs how the guide ended, so one they said didn't
help is red and one they said helped is green. Colour is never the only sign:
the words beside every mark say the same, and the arrow beside a number points
the way it moved. Colour stays on marks, arrows and the few words of a change.
It is never a fill, a card, a bar or a button.

**Charts.** The two neutrals, and nothing else. Guides each day is a bar for
each day of the range, in UTC, the same days the numbers above it count. Muted
text grey is guides started, and Ink over it, from the same foot, is guides
finished. Bars are at most 24px wide, rounded at the top and square at the
foot, on hairlines with their numbers. Pointing at a day, or reaching it with
the arrow keys, shows a small white card with that day's two numbers. A share
of a whole is a thin Ink bar on a Border grey track. A site's card has the last
fortnight as fourteen small bars, today's in Ink. Every chart has the same
numbers as a table for a screen reader. There is no chart library.

**Live.** A page that shows questions keeps itself current while it is open,
asking every second and a half, and says nothing about it. There is no Live
label and no dot. A new question is simply there, a step later it reads on,
and the numbers above have moved. A question under way reads "Thinking", then
"Showing step 2", with the shimmer, the same words the widget's status line
uses, beside the blue pointer. A new row fades in from 4px above in 200ms.

The pointer and the shimmer claim that someone is being shown a step right
now, so they last only while that is likely. A guide with no new step for two
minutes reads "Paused at step 2", still, beside a grey dot, because the person
has most likely walked away and nobody can say otherwise. A new step brings
the pointer back. After thirty minutes with no ending it is abandoned, as
before, and only that is counted.

The page speaks up only when it has stopped hearing from the server, with the
word "Reconnecting" in Muted text where the time range is, so nobody takes
what is on screen for the latest.

**A guide.** It opens in a panel on the right, 576px wide, on Paper, with the
page behind under a 20 percent Ink wash. Each step is a white card that says
what was pointed at, and what Haptic said in the Ink caption bubble. The
address holds the guide, so the link opens the same guide for someone else,
and Back closes it.

**Waiting.** While numbers load, Muted blocks hold the place of what is coming,
at its size, so nothing jumps when it arrives. Once a page has numbers it keeps
showing them while newer ones are on their way.

## Interaction

How a guide should feel. Only what the designer has signed off belongs here.
Behaviour that merely exists in the widget code is not a design decision. The
widget in `src/widget` follows what is signed off below, and where it still
differs from the rest, the bullet says so.

Signed off: Haptic sits in the bottom right, in the place of support chat,
because it is meant to replace it. The chat stays open once a question is
asked. Thinking is a shimmer across the word in the chat, and the thinking
glow on the page, from its top to its bottom, smooth, and there only while
Haptic is thinking. A click on the control is answered with a press. A finished
guide ends with the green tick and "Done". The line that says Haptic is an AI
stays. The rest below is proposed.

- **Haptic guides, the person acts.** Haptic points and explains. It does not
  click, type or scroll for anyone.
- **Mark the control, leave the page alone.** One outline on the target. The
  page is never dimmed or blurred, because the person may need to read it, and
  the edge of the window never glows as a frame, because that is how agents
  signal that an AI has taken control. The thinking glow is the one thing that
  crosses the page. It is there only while Haptic thinks, and the page's words
  stay readable under it.
- **Motion arrives, then stops.** The glide leads the eye. The mark draws in
  from slightly larger as the pointer lands, then holds still. Between steps
  the mark and the caption go and the pointer waits where it is, so the next
  glide starts from the control just used. If nothing happens for about four
  seconds the mark pulses once, and no more often than that. In the widget the
  pointer goes with the mark between steps, and the next glide starts from
  where it was. The mark holds still when Haptic hands a step to the person
  too: no breathing, no halo.
- **Say one thing.** A caption names the next action in a short sentence. It
  carries no buttons. In the widget it carries a small × that stops the guide,
  so there is a way out beside the pointer when the chat has been closed.
- **Keep the conversation and the exit in view.** The chat stays open for the
  whole guide, with the question at the top and a stop button in the ask box.
  Once anything is in the chat, a turning arrow on the far side of the ask
  box's row starts over: it calls off a guide that is running and clears the
  chat back to an empty ask box with the keyboard.
- **Never cover the control.** When the chat would sit on the control being
  pointed at, or on its caption, it moves to the other side of the window
  while the pointer is there, and comes back when it has gone.
- **A wrong click is not an error, and Haptic says so.** The ask box shows
  "Finding the way from here" at once. The next caption opens with "Not that
  one." and names the step that gets the person back. It is plain text in the
  usual caption: no Error red, no alert. If the click also leads to the goal,
  Haptic carries on without comment.
- **Finish plainly.** Haptic confirms in a sentence, shows the green tick in
  the chat, and the ask box is ready again. The tick is only for a guide the
  person followed to the end, the same ending that is billed. An answer in
  words, a sentence that says Haptic can't help, and a control that was shown
  and not used all end without it. In the widget the sentence that ends a
  guide stays in a caption just above the chat, where its × puts it away.
- **An answer is read in the chat.** When Haptic answers in words, the chat
  shows the question as an Ink bubble on the right and the answer as a Muted
  bubble on the left. Under the answer, after a hairline, 12px Muted text says
  "From the help docs" and lists each article by its title, in Ink, with the
  day it was last updated. A title with an address is a link, underlined only
  under the mouse or keyboard focus. If the answer is about a control on the
  page, the pointer goes to it with no caption, because the words are in the
  chat. A step's sentence stays in the caption beside the pointer. When Haptic
  can't help, the same Muted bubble holds one fixed sentence. If the answer
  names a control Haptic can't find in the product, one more line of 12px
  Muted text under the articles says so.
- **A person is one button away, when Haptic can't help.** Under a reply that
  says Haptic can't help, after a "No" to "Did this help?", and after three
  questions with no "Yes", the chat shows one secondary button, "Contact
  support". It opens a two-field form in the chat, the company's page, or the
  visitor's mail program, whichever the company set. When the form is sent the
  chat says "Sent to the team. A person will reply by email.", so nobody
  thinks the AI is still the one answering.
- **Say it is an AI.** One line of 12px Muted text sits under the ask box,
  "Haptic is an AI guide and can be wrong." It looks like plain text, with no
  underline. Its last words are a link to the page that says what Haptic reads
  and keeps, and the underline shows only under the mouse or keyboard focus.
  The launcher carries no tag. A customer can change the launcher's word, and
  cannot remove the line.
- **Put the launcher away.** With the mouse over the launcher or focus on it,
  a 20px white circle with an × fades in on its outer bottom corner, the right
  one for a launcher on the right. It takes the launcher down to a 14px dot in
  the same place: the word fades first, then the pill draws in. The dot stays
  that small while the mouse that pressed the × is still over it. Once the
  mouse comes back, or with focus, it opens to 32px and shows the pointer
  mark, growing in place without moving, and a click brings the launcher back
  without opening the panel. Minimized, the area that answers the mouse is a
  still 32px square, so the dot can't flicker between sizes under a pointer
  resting on its edge. Each change is 300ms or
  less and eases out with the glide's curve, with no bounce. With reduced
  motion on, each one happens at once. The visitor's choice holds on the
  site's other pages.

## Do's and Don'ts

- Do keep Pointer blue for the pointer, its target mark and focus.
  Never for text, buttons or links.
- Do give the pointer its white border and shadow everywhere.
- Do use sizes, radii and spacing from the scales above. No one-off values.
- Do check both modes. Every colour has a dark twin.
- Do centre text in controls with flex, and keep every control on the 4px grid.
- Don't replace the visitor's own mouse cursor.
- Don't let the pointer or a caption cover the label it is pointing at.
- Don't use Done green for anything but the finished mark, or Error red
  outside a form, except to say good and bad in the dashboard.
- Don't add another colour, a gradient, an illustration or artwork. Paintings
  behind the demos were tried and turned down. The window dots on the demo
  frame and the thinking glow are the two exceptions.
- Don't put the thinking glow on the chat, leave it on the page once the
  reply has arrived, or play it for anything but Haptic working on a reply.
- Don't give the glow an edge, a stripe or a second band. If it can be seen
  where it starts or stops, it is not smooth enough.
- Don't use Bold, italics for emphasis, or text smaller than 12px.
- Don't show logos, quotes or numbers that are not real.
- Don't use punctuation beyond commas and periods in marketing copy.
