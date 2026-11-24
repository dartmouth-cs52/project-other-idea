# What Haptic reads, masks and sends

Exactly what leaves a visitor's browser, what is masked first, and the exceptions. For what is stored afterwards, see [operations](operations.md#what-is-recorded-about-visitors). For the project overview, see the [README](../README.md). The public [privacy page](https://joinhaptic.com/privacy) ([source](../web/app/privacy/page.tsx)) says the same thing to visitors, so a change here has to change that page too.

## What is sent

The widget sends the names of controls, never what anyone types into a field or anything inside an area they write in. It looks at what fields hold only inside the browser, to leave it out wherever the page repeats it: a block of page text that repeats it is dropped, and in a heading, the title, a control's name or an option it is replaced by `[typed]` ("Save [typed]").

It does say whether a field is marked invalid, so a guide does not move on from a field that will not be accepted: the page marks it with `aria-invalid`, or the browser's own check of the field's type, pattern, length or range fails, as it does for "charlie" in an email field. An email field (`type="email"`) is also marked invalid when the address in it has no dot in its domain, like "theochain@dad", or its domain ends in a single character or in digits: the browser takes those, following the HTML standard, and nearly every form refuses them. That is a yes or a no and nothing of what was typed. An empty field is not called invalid.

The one exception is words the person also wrote, whole, in their own question, which is sent anyway: asked to "make Roma Johnston a manager", they type Roma in the search box, and the row "Roma Johnston" stays readable so it can be pointed at. That holds only for words the question is sent with. An email address or a number that is masked in the question is left out when typed like anything else, whether or not the question names it, so the page's repeat of someone's typing never un-masks it. Anything else they type is left out as before.

Addresses, the page's own and its links', are sent with ids and numbers masked, so a page that writes a search into an address sends it there.

With each question the widget also sends the user's own date, not their time zone or location, so the model knows what day it is.

## Teach mode

Teach mode is not used by visitors. Someone at the company starts it from the dashboard, which opens their product with a link that works once, for half an hour, and only on that company's site. While they do the task, the widget sends which buttons, links, fields and lists they use, each by its kind, its name and the section of the page it is in, which option they chose in a list, and the page's path within the product, with ids masked. It never sends what they type, and it masks names and addresses as below. Where the page repeats what they typed in a name it sends, that is replaced by `[typed]` as above, including the names teach mode reads for itself: a group of options, a list, and a control the page reading leaves out. A control in a table's row is kept by its name only when other rows have one of the same name, such as Edit, never by the record's own name. Teach mode asks the model nothing. What is kept is listed in [operations](operations.md#what-teach-haptic-keeps).

## What is masked

Before anything leaves the browser, in what it reads, in the page's address and in the question, the widget masks:

- anything that looks like an email address,
- any run of five or more digits, like an account or order number,
- any eight or more digits written in groups with spaces, dashes, dots or brackets, like a phone or card number. Digits that follow straight after a letter belong to the word, like the model number I9100, and are not counted, unless more of a number follows them, as in SSN123-45-6789 or Card4111 1111 1111 1111: then the whole number is masked.

The server masks the same again before it stores anything, with the same function (`cleanText` in `src/shared/types.ts`). What reaches the model is what the widget sent, already masked.

## What is not masked

Neither the widget nor the server masks real dates written in figures, like 2026-03-07 or 07.03.2026, with a month from 1 to 12 and a day from 1 to 31 (12.34.5678 is masked): a question like "my latest invoice" needs them, and they say no more about a person than the names a page already shows. Nor do they mask shorter numbers, like prices and quantities, or names and other words, so text on the page can still hold personal details, a date of birth among them.

One exception, so Haptic can find the order or account someone asked about: an email address, or a number of five or more digits, that the user wrote in their own question is left readable wherever exactly that value stands on its own on the page. In the question itself it is left readable only when the page shows it standing on its own like that, and is masked otherwise (`namedIn`).

## A test account a company gives

Everything above is about visitors. One thing a company can do sends Haptic a password: mapping its signed-in app [with a test account](widget.md#with-a-test-account-from-haptics-own-browser), which is asked for in the dashboard and never happens by itself. The account's name and password go to the site's Worker once, are typed into the company's own sign-in page by a browser on Cloudflare, and are not saved, logged or put in an error. They are never sent to the model. What is read in that browser is what the mapper reads anywhere: the names of buttons, links and fields.
