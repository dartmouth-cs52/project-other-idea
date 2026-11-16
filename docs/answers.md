# Answers and the way to a person

Two features that sit beside the pointer: answering in words from a site's own help docs, and handing a visitor over to a person. Both are per-site settings. For the project overview, see the [README](../README.md).

## Answers

A pointer cannot answer "what does this do" or "why did that happen". A site with Answers switched on gets replies that can also answer in words, from its own help docs. Each reply is one of three kinds, which the model names in the reply's first field so the widget knows what is coming:

| Kind | When | What the visitor gets |
|---|---|---|
| `guide` | They want to do something, and there is a control or a link toward it | The pointer and a sentence, as before |
| `answer` | They ask what something is, what it does or why, and a help article says | One to four sentences, with the title, link and date of each article they rest on. It can point as well |
| `cannot_help` | The docs do not cover it, it is one for a person, or it has nothing to do with the site | A fixed sentence |

What matters most is decided by the server after the model has replied, in `src/server/answers.ts`, and not by the prompt:

- When Haptic cannot help, the visitor reads a fixed sentence. The model only picks which one, and what it wrote is thrown away.
- An answer has to name at least one of the site's own help articles. If it names none, the visitor is told the docs do not cover it.
- Prices, refunds, billing disputes, legal and medical matters, deadlines and anything about the visitor's own account are never answered in words, whatever the docs say. Pointing at the page where the visitor can see their own plan is still allowed.
- An answer is held to the same rules as any sentence: plain text, with no web address, email address or number to call.
- A control an answer names is looked for on the page. Help docs go out of date, and a bot that only reads docs cannot know when an article names a button the product no longer has. Haptic has the page in hand when it answers. The model lists the controls its answer tells the visitor to use, and the server looks for each on the page the visitor is on and on the pages the site map knows. One that is on none of them is said so under the answer ("I can't see "Archive project" on this page or the others I know, so this may no longer be right"), and recorded with the step, which is how a company learns which of its articles no longer match its product. It only speaks when it can know: not while a dialog is open, and not for a product whose pages the crawl could not read, where a control that isn't on this page is most likely just on another.

A how-to question is guided to the end, whether or not an article describes the same thing. Three things in `src/server/model.ts` and `src/server/answers.ts` hold that, each only for a question that asks for a way and never for one of fact or explanation (`wantsTheWay` in `src/server/check.ts`: "how do I add a budget" and "add a budget" ask for a way; "what does freezing a card do", "can I…" and "how do approvals work" do not):

- A reply in guide mode that tells the visitor to use a control on the page and points at nothing is judged as on a site without Answers: the control is pointed at, or the model is asked once more, or it was an aside and stands. This holds for a step and for the sentence that ends a guide.
- An answer in words that names a control on the page without pointing at it is judged the same way, and keeps its words and its articles.
- An answer that points and calls that the end ("done") goes on from the pointer instead: it is the first step, and the widget asks again once the visitor has used it. For a question of fact, "done" with a pointer still only shows where the thing is.

A step's sentence may repeat an amount of money the visitor wrote in their own question ("raise the budget to $75,000": "Click Edit budget, then set $75,000"). Any other amount still costs the step its words, and so does any amount when the question itself is about a price, a refund or the visitor's own account. An answer in words is held to the rule whoever wrote the figure.

In the widget, an answer is read in the panel: the question, the answer, and under it each article's title, link and date. If the answer is about a control on the page, the pointer goes to it as well. A step's sentence stays beside the pointer. Questions answered in words are remembered until the visitor presses Stop, so "and who can remove them?" is read with what came before.

It is on for a site with help docs unless the site switches it off, and off for a site without any (`answersOn` in `src/shared/types.ts`). A site without it is asked exactly as before: the same prompt, and the same three fields in each reply. A test holds the old prompt to a fingerprint, so it cannot change by accident.

```bash
npm run tag -- --id site_ab12cd34ef --answers on --stale-days 365
```

With Answers on, up to about 100,000 tokens of help docs go in the prompt, where a site without it gets about 24,000. A text doc can say where it lives and when it last changed, in a few lines at its top, and those are what the visitor is shown under an answer:

```
---
url: https://help.example.com/articles/inviting-teammates
updated: 2026-10-02
---
```

A doc fetched from a URL is linked to that URL. **Answers has not been tried with a real model yet.** Run the benchmark with `--answers` before switching it on for anyone (see [`eval/README.md`](../eval/README.md)).

### Trying it on the demo app

The demo app has a small help centre of its own, in `demo/help`: twelve articles about a product that does not exist. Add `--answers on` to the demo command in the [README](../README.md#quick-start) to try Answers on it: ask "how long does an invite link last", then "how do I transfer ownership", which the articles leave out on purpose. One article, on roles, tells the reader to press a Remove button the app does not have, so there is something for the check against the live page to find. The plans article has prices and a refund rule in it, which Haptic must never state.

## The way to a person

A support chat is also an inbox someone watches, and Haptic is not one. When it can't help, it hands over to whatever the company already uses. The widget offers one button, "Contact support", in three cases: when Haptic has just said the docs don't cover a question or that it is one for a person, when a visitor answers "No" to "Did this help?", and when three questions in a row have ended without a "Yes". It is not offered after every reply.

A site sets where the button leads, and the first of these that is set is used:

```bash
npm run tag -- --id site_ab12cd34ef \
  --handoff-webhook https://example.com/hooks/haptic --handoff-secret "$SECRET" \
  --handoff-url https://example.com/contact \
  --handoff-email support@example.com
```

- **A webhook.** The widget shows a short form, an email address and a note. The server passes it on as JSON and keeps none of it: `kind` ("handoff"), `site`, `site_name`, `at`, `email`, `note`, `origin`, `page`, `guide`, `transcript` (each line has a `role`, its `text`, and for Haptic's lines the `kind` of reply), and `modes`, the kinds of reply used. With a secret set, the post carries `X-Haptic-Signature: sha256=` followed by the hex HMAC-SHA256 of the body, so the receiver can tell it came from Haptic. The address has to be https and on the public internet.
- **A page**, opened in a new tab.
- **An email address.** The visitor's own mail program opens, with the conversation in the message.

A site with its own chat widget can take over instead. Before the button does anything it sends a `haptic:handoff` event on the document, whose `detail` has the `question`, the `path` and the `transcript`. Cancel it and Haptic does nothing more:

```js
document.addEventListener("haptic:handoff", (event) => {
  event.preventDefault();
  openOurChat({ prefill: event.detail.question });
});
```

Creating the ticket in a helpdesk directly, through Zendesk's or Intercom's API, is not built.
