# Haptic

Haptic is a guide that software companies add to their web apps with one script tag. When a user asks how to do something, by typing or by voice, a pointer moves to the right button, a short caption explains it, and Haptic walks them through the rest of the task across menus and pages.

## Who buys it, who uses it

Buyers are SaaS companies whose dashboards confuse people: developer platforms, admin consoles, fintech, analytics, B2B tools. The people signing are heads of product, growth and support. They pay to get fewer support tickets, faster activation, and no more hand-built product tours to maintain.

Users are their customers, halfway through a task, who just want to find the button.

## Why it wins

- **Paste one line and it works.** No tours to author and no selectors to maintain. Haptic reads the page the user is looking at and learns the rest of the site from traffic.
- **It shows instead of tells.** A help chat sends a docs link. Haptic points at the button.
- **It's precise.** It points at real page elements, not guessed screen positions.

## Principles

1. **Fast.** The pointer moves within 0.7s of a typed question. Every pipeline change ships with before and after timings.
2. **Point precisely or say you can't.** A confident wrong step costs more than "I don't see that here."
3. **The customer's site comes first.** Haptic never breaks, slows, restyles or blocks their page.
4. **User data stays with the user.** Haptic never reads what people type, skips table data, masks emails and numbers, and only learns labels many users see.
5. **Guide first.** Haptic points and explains. Acting for the user comes later, and only with the user's say-so.

## Voice and tone

- Start with the action: "Click Settings in the left sidebar."
- Name things by their visible label. Describe icon-only buttons: "the share icon at the top right."
- One or two sentences per step.
- No greetings, filler, jokes, praise, apologies or exclamation marks.
- Say plainly when unsure: "I don't see an export option on this page. Try the Reports tab."

| Instead of | Say |
|---|---|
| "Great question! So what you'll want to do is..." | "Click Settings, then Developer." |
| "Oops, I can't seem to find that!" | "I don't see that on this page." |

## Visual language

Black and white by default. The pointer and highlight take whichever of the two stands out against what's under them, and the caption, Ask bar and launcher take the opposite of the page's tone, like a tooltip. Customers can pick an accent color instead. System fonts, thin strokes, small corner radii. Short eased motion with no bounce, and none at all under reduced motion. It should look like part of the customer's product, not a mascot sitting on top of it.

## Not in the MVP

Clicking or typing for the user, docs ingestion, screenshots, team seats, SSO, mobile-first layouts.

## Glossary

- Site: one customer web app, with its own key, allowed origins and knowledge.
- Publishable key: the public `pk_` key in the snippet. Allowed origins are what actually restrict it.
- Snapshot: the element list built from the current page.
- Element ID: a short handle like `e14`, valid for one snapshot.
- Step: one point plus one or two sentences.
- Guide: the steps for one goal, linked by waiting for the user's click.
- Outline / site map: what Haptic has learned about each route from traffic.
- Launcher, Ask bar, caption, pointer, highlight: the UI pieces.
