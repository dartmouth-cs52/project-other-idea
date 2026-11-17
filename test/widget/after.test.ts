import assert from "node:assert/strict";
import { after, test } from "node:test";
import { routeKey } from "../../src/shared/types.ts";
import { closeBrowser, idOf, point, start, words, type Asked } from "./harness.ts";

after(closeBrowser);

// The control the visitor just used goes with the next question as `after`,
// which is part of a verified route's key (src/server/routes.ts): on the same
// page, and on the page a click loads. Never after a wrong click, and never
// on a guide's first question.

/** The route key of the control a question's list has under this label. */
const keyOf = (request: Asked, label: string) => routeKey(request.snapshot.elements.find((element) => element.id === idOf(request, label))!);

test("the control the visitor used goes with the next question, on the same page", async () => {
  const page = `<h1>Orders</h1><button id="export" type="button">Export</button><p id="out"></p>
    <script>document.getElementById('export').addEventListener('click', () => (document.getElementById('out').textContent = 'Exported.'));</script>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Your orders are exported.")));
  try {
    await session.ask("export my orders");
    await session.untilState("pointing");
    await session.page.locator("#export").click();
    const [first, second] = [session.requests[0]!, await session.untilAsked(2)];
    assert.equal(first.after, undefined, "a first question has nothing before it");
    assert.equal(second.after, keyOf(first, "Export"));
    assert.equal(second.offTrack, undefined);
  } finally {
    await session.close();
  }
});

test("the control the visitor used is kept across the page load it caused", async () => {
  const pages = { "/": `<h1>Home</h1><nav><a id="billing" href="/billing">Billing</a></nav>`, "/billing": `<h1>Billing</h1><button type="button">Change card</button>` };
  const session = await start(pages, (request, index) => (index === 0 ? point(request, "Billing", "Click Billing.") : words("That's your billing page.")));
  try {
    await session.ask("change my billing card");
    await session.untilState("pointing");
    await session.page.locator("#billing").click();
    const second = await session.untilAsked(2);
    assert.equal(second.snapshot.path, "/billing");
    assert.equal(second.step, 1);
    assert.equal(second.after, keyOf(session.requests[0]!, "Billing"));
  } finally {
    await session.close();
  }
});

test("nothing goes with the question after a wrong click", async () => {
  const page = `<h1>Orders</h1><button id="export" type="button">Export</button><button id="print" type="button" style="margin-left:200px">Print</button>`;
  const session = await start(page, (request, index) => (index === 0 ? point(request, "Export", "Click Export.") : words("Use Export for that.")));
  try {
    await session.ask("export my orders");
    await session.untilState("pointing");
    await session.page.locator("#print").click();
    const second = await session.untilAsked(2);
    assert.equal(second.offTrack, true);
    assert.equal(second.after, undefined);
  } finally {
    await session.close();
  }
});
