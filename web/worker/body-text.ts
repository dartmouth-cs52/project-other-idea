// Reading a request body without trusting its size.

/**
 * The body as text, or undefined once it is longer than `maxBytes`. `request.text()` would read the whole
 * body into memory first, and a client can send up to Cloudflare's request limit, far more than a Worker has.
 * So a declared length that is too long is refused before reading, and the rest are counted as they arrive,
 * which also covers chunked bodies with no length given. No body reads as "".
 *
 * The text is what `request.text()` would give: a default TextDecoder drops a leading byte order mark and turns
 * bytes that are not UTF-8 into U+FFFD, as the Fetch spec's text() does, also when a chunk ends mid-character.
 *
 * Callers with a limit in characters pass three bytes for each and check the characters again once decoded.
 * A UTF-16 code unit is at most three bytes of UTF-8 (a character outside the BMP is four bytes but two units,
 * and a run of bytes that is not UTF-8 decodes to one U+FFFD for at most three), so no body within the
 * character limit is refused early. A byte order mark adds three bytes that decode to nothing, but JSON text
 * keeps anything that is not ASCII inside quotes, one byte each, so JSON that could be accepted still fits.
 */
export async function textUpTo(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length")) > maxBytes) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      // Not awaited: the refusal doesn't depend on it, and the rest of the body is never read.
      reader.cancel().catch(() => {});
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
}
