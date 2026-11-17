// Reading a request's body without holding more of it than the caller allows.
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
