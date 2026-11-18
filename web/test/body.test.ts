import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedRequest, boundedText, capped, cappedText } from "../worker/body";

// The body is read a piece at a time and given up on once it is bound to be too
// long, so a large request is refused without being held in memory. These check
// that it reads the same text Request.text() would, keeps each caller's limit in
// characters, and stops reading early.

const URL = "https://joinhaptic.com/api/app/sites";

/** A request whose body arrives in the pieces given, counting what is pulled and whether it was cancelled. Nothing is pulled until asked for. */
function streamed(pieces: Uint8Array[], headers: Record<string, string> = {}) {
  const seen = { pulled: 0, bytes: 0, cancelled: false };
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next === pieces.length) return controller.close();
      seen.pulled++;
      seen.bytes += pieces[next].byteLength;
      controller.enqueue(pieces[next++]);
    },
    cancel() {
      seen.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { request: new Request(URL, { method: "POST", body, headers, duplex: "half" } as RequestInit), seen };
}

/** A request whose body never ends: the same piece, over and over. */
function endless(piece: Uint8Array) {
  const seen = { pulled: 0, bytes: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulled++;
      seen.bytes += piece.byteLength;
      controller.enqueue(piece);
    },
    cancel() {
      seen.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { request: new Request(URL, { method: "POST", body, duplex: "half" } as RequestInit), seen };
}

const bytes = (text: string) => new TextEncoder().encode(text);
/** Splits bytes at the given offsets. */
function split(data: Uint8Array, at: number[]): Uint8Array[] {
  const edges = [0, ...at, data.length];
  return edges.slice(1).map((end, i) => data.slice(edges[i], end));
}

test("a body within the limit comes back as the text Request.text() reads", async () => {
  const json = JSON.stringify({ notes: "Invoices are under Billing.\nCafé ☕ 請求書 😀" });
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: json }), 1_000), json);
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "" }), 1_000), "");
  assert.equal(await boundedText(new Request(URL), 1_000), "", "a request with no body reads as empty, as before");
});

test("a character split between two pieces is read whole", async () => {
  const text = "é😀請";
  const data = bytes(text); // 2 + 4 + 3 bytes
  for (let a = 1; a < data.length; a++) {
    for (let b = a + 1; b < data.length; b++) {
      assert.equal(await boundedText(streamed(split(data, [a, b])).request, 10), text, `split at ${a} and ${b}`);
    }
  }
});

test("odd bytes read the same as Request.text() reads them: a byte order mark dropped, broken sequences replaced", async () => {
  const samples = [
    new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{"a":"b"}')]),
    new Uint8Array([...bytes("ok "), 0xc3, ...bytes(" then "), 0xff, 0xfe, ...bytes(" end")]),
    new Uint8Array([...bytes("cut short "), 0xe8, 0xab]),
  ];
  for (const data of samples) {
    const expected = await new Request(URL, { method: "POST", body: data }).text();
    for (let at = 1; at < data.length; at++) {
      assert.equal(await boundedText(streamed(split(data, [at])).request, 1_000), expected, `split at ${at}`);
    }
  }
});

test("the limit is in characters, as each caller counts them", async () => {
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "x".repeat(100) }), 100), "x".repeat(100));
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "x".repeat(101) }), 100), null);
  // Three bytes a character is the most UTF-8 takes, so text of that kind right at the limit still comes back.
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "請".repeat(100) }), 100), "請".repeat(100));
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "請".repeat(101) }), 100), null);
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "😀".repeat(50) }), 100), "😀".repeat(50), "an emoji counts two, as String.length does");
  assert.equal(await boundedText(new Request(URL, { method: "POST", body: "😀".repeat(51) }), 100), null);
});

test("a body that says it is too long is turned away before any of it is read", async () => {
  const { request, seen } = streamed([bytes("x".repeat(10))], { "content-length": "301" });
  assert.equal(await boundedText(request, 100), null);
  assert.equal(seen.pulled, 0);
  const fits = streamed([bytes("x".repeat(10))], { "content-length": "10" });
  assert.equal(await boundedText(fits.request, 100), "x".repeat(10));
});

test("a body that never ends is cut off just past three bytes a character, and the rest is never read", async () => {
  const limit = 20_000;
  const piece = new Uint8Array(64 * 1024).fill(0x78);
  const { request, seen } = endless(piece);
  assert.equal(await boundedText(request, limit), null);
  assert.ok(seen.bytes <= limit * 3 + piece.byteLength * 2, `read ${seen.bytes} bytes for a limit of ${limit * 3}`);
  assert.ok(seen.cancelled, "the rest of the body is cancelled, not left waiting");
});

test("a body that lies about its length is still cut off", async () => {
  const piece = new Uint8Array(64 * 1024).fill(0x78);
  const { request, seen } = endless(piece);
  request.headers.set("content-length", "10");
  assert.equal(await boundedText(request, 1_000), null);
  assert.ok(seen.bytes <= 1_000 * 3 + piece.byteLength * 2);
});

// A request handed on to code that reads its body whole, such as Neon's sign-in proxy, is bounded as it is read.

test("a bounded request reads nothing until its body is asked for, then gives the bytes as sent", async () => {
  // Bytes that are not all text, so anything that decoded and wrote them out again would change them.
  const data = new Uint8Array([...bytes('{"a":"é"}'), 0xff, 0xc3, ...bytes(" end")]);
  const { request, seen } = streamed(split(data, [2, 7, 11]), { "content-type": "application/json" });
  const held = boundedRequest(request, 1_000)!;
  assert.equal(seen.pulled, 0, "nothing is read before a route asks");
  assert.equal(held.request.url, URL);
  assert.equal(held.request.method, "POST");
  assert.equal(held.request.headers.get("content-type"), "application/json");
  assert.deepEqual(new Uint8Array(await held.request.arrayBuffer()), data);
  assert.equal(held.cut(), false);
  const get = new Request(URL);
  assert.equal(boundedRequest(get, 1_000)!.request, get, "a request with no body is handed on as it is");
});

test("a bounded request that says its body is too long is turned away unread, and one that runs on fails once past the limit", async () => {
  const told = streamed([bytes("x".repeat(10))], { "content-length": "2001" });
  assert.equal(boundedRequest(told.request, 2_000), null);
  assert.equal(told.seen.pulled, 0);

  const piece = new Uint8Array(64 * 1024).fill(0x78);
  const { request, seen } = endless(piece);
  const held = boundedRequest(request, 100_000)!;
  await assert.rejects(held.request.text());
  assert.equal(held.cut(), true);
  assert.ok(seen.cancelled, "the rest of the body is cancelled");
  assert.ok(seen.bytes <= 100_000 + piece.byteLength * 2, `read ${seen.bytes} bytes for a limit of 100,000`);
});

// A response from a site a company chose is held to a limit the same way, since the site decides what it sends.

const response = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => new Response(body, { headers });

test("a response within the limit comes back as Response.text() reads it, and says nothing of a length it no longer has", async () => {
  const text = "Help: invoices are under Billing. Café ☕ 請求書";
  const { request } = streamed(split(bytes(text), [3, 20, 41]));
  const kept = capped(response(request.body!, { "content-type": "text/html", "content-length": "999" }), 1_000);
  assert.equal(kept.headers.get("content-type"), "text/html");
  assert.equal(kept.headers.get("content-length"), null);
  assert.equal(await kept.text(), text);
  assert.equal(await cappedText(new Response("short"), 1_000), "short");
});

test("a response that never ends is cut off at the limit, and the rest is never read", async () => {
  const piece = new Uint8Array(64 * 1024).fill(0x78);
  const { request, seen } = endless(piece);
  const text = await cappedText(response(request.body!), 200_000);
  assert.equal(text.length, 200_000, "exactly the bytes allowed, the last piece cut where the limit falls");
  assert.ok(seen.bytes <= 200_000 + piece.byteLength * 2, `read ${seen.bytes} bytes for a limit of 200,000`);
  assert.ok(seen.cancelled, "the rest is cancelled, not left waiting");
});

test("a response that runs past the limit can fail instead, with the caller's own error", async () => {
  const piece = new Uint8Array(64 * 1024).fill(0x78);
  const { request, seen } = endless(piece);
  const tooLong = new Error("That page is too large.");
  await assert.rejects(capped(response(request.body!), 100_000, () => tooLong).arrayBuffer(), (error) => error === tooLong);
  assert.ok(seen.cancelled);
  assert.ok(seen.bytes <= 100_000 + piece.byteLength * 2);
});
