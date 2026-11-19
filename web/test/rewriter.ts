// A stand-in for the Workers runtime's HTMLRewriter, which Node doesn't have, for
// tests of what the Worker collects from a page. It knows only the pages the tests
// write: start tags with their attributes, text, and end tags, with no "<" inside a
// script or an attribute. It reads a page as it arrives, a piece at a time, and calls
// the handlers as the real one does: `element` at each start tag a selector matches,
// that selector's `text` for the text inside it, a handler given to `onEndTag` at the
// end tag, and the document's `text` for all text. A reading that fails partway fails
// the page it gives, after the handlers have seen everything before.
//
// A selector is a tag name, attributes in brackets, or both, such as a[href] or
// [role='tab'], or a list of those split by commas.

type TextHandler = (chunk: { text: string; lastInTextNode: boolean }) => void;

interface Handlers {
  element?(element: { getAttribute(name: string): string | null; onEndTag(handler: () => void): void }): void;
  text?: TextHandler;
}

/** Elements that never have an end tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function matches(selector: string, name: string, attributes: Map<string, string>): boolean {
  return selector.split(",").some((one) => {
    const simple = /^([a-z0-9-]*)((?:\[[^\]]+\])*)$/i.exec(one.trim());
    if (!simple) throw new Error(`The stand-in for HTMLRewriter can't read the selector ${one}.`);
    if (simple[1] && simple[1].toLowerCase() !== name) return false;
    for (const [, attribute, , value] of simple[2].matchAll(/\[([^\]=\s]+)(?:=(['"]?)([^'"\]]*)\2)?\]/g)) {
      const has = attributes.get(attribute.toLowerCase());
      if (has === undefined || (value !== undefined && has !== value)) return false;
    }
    return true;
  });
}

export class TestRewriter {
  private readonly selectors: { selector: string; handlers: Handlers }[] = [];
  private readonly documentText: TextHandler[] = [];

  on(selector: string, handlers: Handlers): this {
    this.selectors.push({ selector, handlers });
    return this;
  }

  onDocument(handlers: { text?: TextHandler }): this {
    if (handlers.text) this.documentText.push(handlers.text);
    return this;
  }

  transform(response: Response): Response {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    /** The elements open now, outermost first, with what to call for their text and at their end tags. */
    const open: { name: string; texts: TextHandler[]; ends: (() => void)[] }[] = [];
    let pending = "";

    const text = (chunk: string) => {
      if (!chunk) return;
      for (const element of open) for (const handler of element.texts) handler({ text: chunk, lastInTextNode: false });
      for (const handler of this.documentText) handler({ text: chunk, lastInTextNode: false });
    };
    const tag = (inside: string) => {
      if (/^[!?]/.test(inside)) return;
      if (inside.startsWith("/")) {
        const name = inside.slice(1).trim().toLowerCase();
        const at = open.findLastIndex((element) => element.name === name);
        if (at < 0) return;
        const closed = open.splice(at)[0]!;
        for (const end of closed.ends) end();
        return;
      }
      const name = (/^[^\s/>]+/.exec(inside)?.[0] ?? "").toLowerCase();
      const attributes = new Map<string, string>();
      for (const [, attribute, double, single, bare] of inside.slice(name.length).matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
        attributes.set(attribute.toLowerCase(), double ?? single ?? bare ?? "");
      }
      const element = { name, texts: [] as TextHandler[], ends: [] as (() => void)[] };
      const given = { getAttribute: (attribute: string) => attributes.get(attribute.toLowerCase()) ?? null, onEndTag: (end: () => void) => void element.ends.push(end) };
      for (const { selector, handlers } of this.selectors) {
        if (!matches(selector, name, attributes)) continue;
        handlers.element?.(given);
        if (handlers.text) element.texts.push(handlers.text);
      }
      if (!VOID.has(name) && !inside.endsWith("/")) open.push(element);
    };
    const feed = (more: string) => {
      pending += more;
      for (;;) {
        if (pending.startsWith("<")) {
          const end = pending.indexOf(">");
          // The rest of the tag is still to come.
          if (end < 0) return;
          tag(pending.slice(1, end));
          pending = pending.slice(end + 1);
        } else {
          const at = pending.indexOf("<");
          text(at < 0 ? pending : pending.slice(0, at));
          pending = at < 0 ? "" : pending.slice(at);
          if (at < 0) return;
        }
      }
    };

    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          // A reading that fails fails here, and so does the page given.
          const { done, value } = await reader.read();
          if (done) {
            feed(decoder.decode());
            return controller.close();
          }
          feed(decoder.decode(value, { stream: true }));
          controller.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers: response.headers });
  }
}
