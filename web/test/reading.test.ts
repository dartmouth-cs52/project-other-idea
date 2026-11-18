import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { siteBrand } from "../worker/brand";
import { docFromUrl } from "../worker/docs";
import { readMore, startReading } from "../worker/reader";

// What Haptic fetches from a site a company chose, its first page, stylesheets,
// sitemap and help docs, is read a piece at a time and only so far, whether or
// not the site says how long it is. Each site here sends ten megabytes with no
// length given, far past every limit, and the network is stood in for, so
// nothing leaves the machine.

const PIECE = 64 * 1024;
const PIECES = 160;
const encoder = new TextEncoder();

/** A body of `start` and then `filler` piece after piece, made only as it is read. Counts what was read, and whether the rest was cancelled. */
function long(start: string, filler: (n: number) => string) {
  const seen = { bytes: 0, cancelled: false };
  let n = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (n === PIECES) return controller.close();
        const piece = encoder.encode(n === 0 ? start : filler(n));
        n++;
        seen.bytes += piece.byteLength;
        controller.enqueue(piece);
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, seen };
}

/** Text of about one piece. */
const fill = (unit: string) => unit.repeat(Math.ceil(PIECE / unit.length));

/** Runs `work` with the network stood in for by `site`, which answers the addresses it knows, and 404 for the rest. */
async function offline(site: Record<string, () => Response>, work: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const answer = site[input instanceof Request ? input.url : String(input)];
    return answer ? answer() : new Response("Not found", { status: 404 });
  };
  try {
    await work();
  } finally {
    globalThis.fetch = real;
  }
}

/** Read no further than the limit, give or take the pieces in flight, and let go of the rest. */
function readOnlySoFar(seen: { bytes: number; cancelled: boolean }, limit: number, what: string) {
  assert.ok(seen.bytes <= limit + 2 * (PIECE + 1024), `${what}: read ${seen.bytes.toLocaleString()} bytes for a limit of ${limit.toLocaleString()}`);
  assert.ok(seen.cancelled, `${what}: the rest is cancelled, not left waiting`);
}

// Node has no HTMLRewriter, so the pages a real one would parse are read through by this one, which finds nothing
// in them. What is tested is how much of a page reaches the parser.
class ReadThrough {
  on() {
    return this;
  }
  onDocument() {
    return this;
  }
  transform(response: Response) {
    return new Response(response.body);
  }
}
const runtime = globalThis as unknown as { HTMLRewriter?: unknown };
before(() => void (runtime.HTMLRewriter = ReadThrough));
after(() => void delete runtime.HTMLRewriter);

test("a site whose first page and stylesheet never stop is read only so far, and its colour is still found", async () => {
  const page = long(`<html><head><link rel="stylesheet" href="/site.css"></head><body>`, () => fill("<p>Welcome</p>"));
  const css = long(":root{--brand:#17633a}", () => fill(".a{color:#111}"));
  await offline(
    {
      "https://endless.example/": () => new Response(page.body, { headers: { "content-type": "text/html" } }),
      "https://endless.example/site.css": () => new Response(css.body, { headers: { "content-type": "text/css" } }),
    },
    async () => {
      assert.deepEqual(await siteBrand("https://endless.example"), { icon: null, colour: "#17633A", from: "stylesheet" });
    },
  );
  readOnlySoFar(page.seen, 600_000, "the first page");
  readOnlySoFar(css.seen, 800_000, "the stylesheet");
});

test("a help doc that runs past 2 MB with no length given is refused as too large, as one that says so is, and the rest is never read", async () => {
  for (const type of ["text/plain", "text/html"]) {
    const doc = long(type === "text/html" ? "<main><h1>Billing</h1>" : "# Billing\n", () => fill("Invoices are under Billing. "));
    await offline({ "https://help.example/billing": () => new Response(doc.body, { headers: { "content-type": type } }) }, async () => {
      await assert.rejects(docFromUrl(new URL("https://help.example/billing")), { message: "That page is too large to use as a help doc." }, type);
    });
    readOnlySoFar(doc.seen, 2_000_000, type);
  }
});

test("reading a site as plain HTML takes only so much of a page and of its sitemap, and queues no more than can still be read", async () => {
  const page = long("<html><body><nav><a href='/pricing'>Pricing</a></nav>", () => fill("<p>Welcome</p>"));
  // Every address in the sitemap is a page of its own: /docs/a, /docs/b, and on.
  const name = (n: number): string => (n < 26 ? "" : name(Math.floor(n / 26) - 1)) + String.fromCharCode(97 + (n % 26));
  const entries = (piece: number) => Array.from({ length: 1000 }, (_, i) => `<url><loc>https://endless.example/docs/${name(piece * 1000 + i)}</loc></url>`).join("");
  const sitemap = long(`<?xml version="1.0"?><urlset>${entries(0)}`, entries);
  await offline(
    {
      "https://endless.example/": () => new Response(page.body, { headers: { "content-type": "text/html" } }),
      "https://endless.example/sitemap.xml": () => new Response(sitemap.body, { headers: { "content-type": "application/xml" } }),
    },
    async () => {
      const { pages, reading } = await readMore(startReading("https://endless.example/"));
      assert.equal(pages.length, 1);
      assert.equal(reading.seen.length, 1);
      assert.equal(reading.queue.length, reading.max - 1, "one page read, so no more waiting than the rest of max");
      assert.equal(reading.queue[0], "https://endless.example/docs/a", "the sitemap's own order is kept");
    },
  );
  readOnlySoFar(page.seen, 2_000_000, "the page");
  readOnlySoFar(sitemap.seen, 2_000_000, "the sitemap");
});
