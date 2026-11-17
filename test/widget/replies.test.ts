import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeBrowser, point, start, words } from "./harness.ts";

after(closeBrowser);

// How the widget reads Haptic's reply on a page that has wrapped `fetch`.
// Monitoring scripts do this to time every request, and some hand back an
// object of their own instead of the browser's response: it can be read as
// text or as JSON, and has no stream to read it as it arrives. Haptic's reply
// is lines of JSON, so read as one JSON it is an error.

/**
 * A page whose monitoring script wraps `fetch` the way healthcare.gov's does:
 * the reply is read whole, and the page gets back an object with `ok`,
 * `status`, `text` and `json`, and no `body`. With `headers` it also passes
 * on the response's headers.
 */
const wrapped = (headers: boolean) => `<h1>Coverage</h1><button id="apply" type="button">Apply now</button><button type="button">Log in</button>
  <script>
    const original = window.fetch;
    window.fetch = function (...args) {
      return original.apply(this, args).then((response) => response.text().then((text) => ({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        ${headers ? "headers: response.headers," : ""}
        text: () => Promise.resolve(text),
        json: () => Promise.resolve().then(() => JSON.parse(text)),
      })));
    };
  </script>`;

for (const headers of [true, false]) {
  test(`a reply through a fetch wrapped to return no stream${headers ? "" : " and no headers"} is read whole, line by line, and the guide points`, async () => {
    const session = await start(wrapped(headers), (request, index) => (index === 0 ? point(request, "Apply now", "Click Apply now to start.") : words("You are on your way.")));
    try {
      await session.ask("how do I apply");
      await session.untilState("pointing", 8000);
      assert.equal(await session.pointed(), "apply");
      assert.equal(await session.caption(), "Click Apply now to start.");
    } finally {
      await session.close();
    }
  });
}

test("an error the server sends as a line is still told as an error through a wrapped fetch", async () => {
  const session = await start(wrapped(true), () => {
    throw new Error("The site is not set up.");
  });
  try {
    await session.ask("how do I apply");
    await session.untilState("finished", 8000);
    assert.match(await session.caption(), /went wrong/i);
  } finally {
    await session.close();
  }
});
