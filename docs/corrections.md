# Correcting Haptic

What a company sees about where Haptic falls short, and what it can change about how Haptic guides, from the dashboard and without waiting for us. For the project overview, see the [README](../README.md).

## What people can't find, and guide health

The dashboard leads with what people can't find: each group ranked by how many different people asked, with how many got there, where most of the rest stopped, and its guides one click away. Guide health follows: how often each common group's guides finish, week by week. A group whose finish rate this week is at least 20 points below the three weeks before, with at least five guides in each, is flagged, with the step and page where its guides now stop and the control earlier finished guides pointed at there that no guide has this week. That is what a change to the product looks like from here. Once a day the website's Worker emails the company's people about each flagged group that at least five people asked before, at most once a fortnight per group (`web/worker/health.ts`, `health_alerts`). A first answer the visitor read without clicking counts as getting there, since Haptic showed them where it was.

Questions are grouped by meaning with plain text rules, never a model: the question's words without filler like "how do I", with a plural s taken off, in order, so "How do I export invoices?" and "export my invoices" are both "export invoice" (`src/shared/questions.ts`, and the same function in SQL in `db/migrations/0011`, kept as a generated column on `guides`). Each guide keeps a hash of the widget's random id made with the site's id, so the dashboard counts people and not questions.

## Point here instead

When Haptic points at the wrong thing, the company fixes it from the dashboard without waiting for us. On any step of any guide, "Point here instead" picks the control it should have pointed at, from the controls known on that page (the crawl's, and those enough visitors have seen) or by typing its label. Element ids only last for one snapshot, so a correction is kept by page, role and visible label, with the question it was made for (`src/shared/corrections.ts`). Each step's prompt gets the corrections for questions like the one asked and for the page the visitor is on, at most five, after the page and before the question. A site without corrections is asked exactly as before, and corrections never change the cached part of the prompt.

## Controls never to point at

A company lists controls Haptic must never point at, like "Delete workspace" or "Transfer ownership". The list goes in the site's prompt, and it is enforced in code twice: the server replaces any reply that points at one, and never sends one as the early pointer, and the widget checks every pointer against the list again before it moves. Either way the visitor reads "I can't help with that here." and the guide ends as `blocked`. Both lists are kept in the site's context, so the widget server reads them with the site and a change reaches visitors within a minute. `npm run site:publish` keeps both lists when it replaces the rest of a site's context.

The benchmark has cases for both: see [`eval/README.md`](../eval/README.md#corrections-and-controls-never-to-point-at).
