// The parts of Cloudflare's Workers runtime the site's Worker uses beyond the
// web standard, declared here because `next build` type-checks these files
// with the browser's types. See https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/

declare class HTMLRewriter {
  on(selector: string, handlers: HTMLRewriterElementHandlers): HTMLRewriter;
  onDocument(handlers: { text?(text: HTMLRewriterText): void | Promise<void> }): HTMLRewriter;
  transform(response: Response): Response;
}

interface HTMLRewriterElementHandlers {
  element?(element: HTMLRewriterElement): void | Promise<void>;
  text?(text: HTMLRewriterText): void | Promise<void>;
}

interface HTMLRewriterElement {
  getAttribute(name: string): string | null;
  onEndTag(handler: () => void | Promise<void>): void;
}

interface HTMLRewriterText {
  readonly text: string;
  readonly lastInTextNode: boolean;
}
