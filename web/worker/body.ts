// Reading a body without holding more of it than the caller allows: a request's,
// and below, a response from a site a company chose.
//
// Request.text() reads the whole body before its length can be checked. Cloudflare
// lets a request carry up to 100 MB, and a Worker has 128 MB of memory, so a limit
// checked afterwards limits what is parsed and kept, not what is read. Here the body
// is read a piece at a time and given up on as soon as it is bound to be too long,
// as the widget server's readJson does (src/server/app.ts).
//
// Each caller's limit stays in characters, as it always was. A character is at most
// three bytes in UTF-8, so a body of more than three bytes for each character allowed
// is refused unread, and one under that is decoded and its characters counted.

/** The body as text, or null when it is longer than `maxChars` characters. No more than three bytes a character is read. */
export async function boundedText(request: Request, maxChars: number): Promise<string | null> {
  const maxBytes = maxChars * 3;
  // A sender that says how long its body is can be turned away before any of it is read.
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    // A character split across two pieces is held back until the rest of it arrives.
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text.length > maxChars ? null : text;
}

/**
 * The same request, with a body that can't be read past `maxBytes`: reading on fails, and the rest is never
 * read. For code that reads a body whole and can't be changed to use the above, such as Neon's sign-in proxy.
 * Nothing is read here, so a route that turns the caller away first reads none of it, and the bytes it does
 * read are the ones sent, so a signature over them still holds. `cut` says whether reading went past the
 * limit, however the error that came of it was passed on. Null when the request says its body is longer.
 */
export function boundedRequest(request: Request, maxBytes: number): { request: Request; cut: () => boolean } | null {
  if (!request.body || request.method === "GET" || request.method === "HEAD") return { request, cut: () => false };
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  const reader = request.body.getReader();
  let bytes = 0;
  let cut = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      bytes += value.byteLength;
      if (bytes <= maxBytes) return controller.enqueue(value);
      cut = true;
      await reader.cancel().catch(() => {});
      controller.error(new Error("That is too long."));
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { request: new Request(request, { body, duplex: "half" } as RequestInit), cut: () => cut };
}

// What Haptic fetches from a company's own site, its pages, stylesheets, sitemap
// and help docs, is held to a limit in the same way. The site chooses what it
// sends, and one that streams a page for ever, with no length given, would
// otherwise be read until the Worker ran out of memory, which many requests
// share, other companies' among them.

/**
 * The same response with no more than `maxBytes` of its body. A longer body is cut off there and the rest is
 * never read, or, given `tooLong`, reading it fails with that error. For readers that take a Response whole,
 * such as HTMLRewriter. Read the address first, from the response fetched: this one has none.
 */
export function capped(response: Response, maxBytes: number, tooLong?: () => Error): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let bytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      const room = maxBytes - bytes;
      bytes += value.byteLength;
      if (value.byteLength <= room) return controller.enqueue(value);
      await reader.cancel().catch(() => {});
      if (tooLong) return controller.error(tooLong());
      if (room > 0) controller.enqueue(value.subarray(0, room));
      controller.close();
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  // What is read here is already decoded, and may be shorter than the length the site gave.
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** A response's body as text, no more than `maxBytes` of it. A longer one is cut off there, and the rest is never read. */
export function cappedText(response: Response, maxBytes: number): Promise<string> {
  return capped(response, maxBytes).text();
}
