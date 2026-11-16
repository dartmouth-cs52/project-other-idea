import { test } from "node:test";
import assert from "node:assert/strict";
import { textUpTo } from "../web/worker/body-text";

/** A request whose body arrives in pieces of `size` bytes, made only as they are read. */
function request(bytes: Uint8Array, size = bytes.length || 1, headers: Record<string, string> = {}) {
  const seen = { pulls: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const at = seen.pulls++ * size;
        if (at >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(at, at + size));
      },
      cancel() {
        seen.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { request: new Request("https://joinhaptic.com/", { method: "POST", headers, body, duplex: "half" } as RequestInit), seen };
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const join = (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
};

test("reads the same text as request.text(), whatever the pieces split", async () => {
  // A byte order mark, then accents, a symbol, an emoji, and bytes that are not UTF-8: a lone continuation byte,
  // a 0xff, a cut-off emoji, and a two-byte start at the very end.
  const bytes = join(new Uint8Array([0xef, 0xbb, 0xbf]), utf8("{\"a\":\"é€😀\"}"), new Uint8Array([0x80, 0xff, 0xf0, 0x9f, 0x98, 0x41, 0xc3]));
  const expected = await new Request("https://joinhaptic.com/", { method: "POST", body: bytes }).text();
  assert.equal(expected.startsWith("{"), true, "the byte order mark is dropped");
  assert.match(expected, /�/);
  for (const size of [1, 2, 3, 4, 5, 7, bytes.length]) {
    assert.equal(await textUpTo(request(bytes, size).request, 1000), expected, `pieces of ${size}`);
  }
});

test("no body reads as empty", async () => {
  assert.equal(await textUpTo(new Request("https://joinhaptic.com/", { method: "POST" }), 10), "");
  assert.equal(await textUpTo(new Request("https://joinhaptic.com/"), 10), "");
});

test("a body of exactly the limit is read, and one byte more is refused, with or without a length given", async () => {
  const bytes = utf8("x".repeat(30));
  assert.equal(await textUpTo(request(bytes, 4).request, 30), "x".repeat(30));
  assert.equal(await textUpTo(request(bytes, 4, { "content-length": "30" }).request, 30), "x".repeat(30));

  const over = request(bytes, 4);
  assert.equal(await textUpTo(over.request, 29), undefined);
  assert.equal(over.seen.pulls, 8, "stops at the piece that goes over");
  assert.equal(over.seen.cancelled, true);

  const told = request(bytes, 4, { "content-length": "30" });
  assert.equal(await textUpTo(told.request, 29), undefined);
  assert.equal(told.seen.pulls, 0, "a declared length over the limit is refused unread");

  // A length that lies low, or is not a number, does not get a body past the count.
  for (const length of ["1", "lots"]) {
    const lied = request(bytes, 4, { "content-length": length });
    assert.equal(await textUpTo(lied.request, 29), undefined, length);
  }
});

test("three bytes a character never refuses JSON the character limit would take", async () => {
  const limit = 1000;
  // JSON keeps anything that is not ASCII inside quotes, so even with a byte order mark this is 3 bytes short of
  // three a character.
  const widest = JSON.stringify("€".repeat(limit - 2));
  assert.equal(widest.length, limit);
  assert.equal(await textUpTo(request(join(new Uint8Array([0xef, 0xbb, 0xbf]), utf8(widest)), 7).request, limit * 3), widest);
  // Outside the BMP a character is four bytes but two code units, two bytes each.
  const emoji = JSON.stringify("😀".repeat((limit - 2) / 2));
  assert.equal(emoji.length, limit);
  assert.equal(await textUpTo(request(utf8(emoji), 5).request, limit * 3), emoji);
  // A cut-off sequence of three bytes decodes to one U+FFFD, so even bytes that are not UTF-8 stay within three each.
  const cut = new Uint8Array(limit * 3);
  for (let i = 0; i < cut.length; i += 3) cut.set([0xf0, 0x9f, 0x98], i);
  assert.equal((await textUpTo(request(cut, 64).request, limit * 3))?.length, limit);
});
