# Correcting Haptic

What a company can change about how Haptic guides, from the dashboard and without waiting for us. For the project overview, see the [README](../README.md).

## Point here instead

When Haptic points at the wrong thing, the company fixes it from the dashboard without waiting for us. On any step of any guide, "Point here instead" picks the control it should have pointed at, from the controls known on that page (the crawl's, and those enough visitors have seen) or by typing its label. Element ids only last for one snapshot, so a correction is kept by page, role and visible label, with the question it was made for (`src/shared/corrections.ts`). Each step's prompt gets the corrections for questions like the one asked and for the page the visitor is on, at most five, after the page and before the question. A site without corrections is asked exactly as before, and corrections never change the cached part of the prompt.

## Controls never to point at

A company lists controls Haptic must never point at, like "Delete workspace" or "Transfer ownership". The list goes in the site's prompt, and it is enforced in code twice: the server replaces any reply that points at one, and never sends one as the early pointer, and the widget checks every pointer against the list again before it moves. Either way the visitor reads "I can't help with that here." and the guide ends as `blocked`. Both lists are kept in the site's context, so the widget server reads them with the site and a change reaches visitors within a minute. `npm run site:publish` keeps both lists when it replaces the rest of a site's context.

The benchmark has cases for both: see [`eval/README.md`](../eval/README.md#corrections-and-controls-never-to-point-at).
