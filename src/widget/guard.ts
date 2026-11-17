// A second line of defence while the widget maps an app by pressing its
// buttons (src/widget/map.ts). The first is not pressing anything that looks
// like it saves, sends, deletes or pays. This is for the button that looked
// harmless and wasn't: while the guard is up, the page cannot send anything
// but a read, cannot submit a form, and its confirm boxes answer no.
//
// It is only ever installed in a tab where someone at the company started
// mapping from the dashboard. A visitor's page is never touched.
//
// It is not a guarantee. Code that kept its own copy of fetch before this
// script ran is not stopped, so the widget still chooses what to press with
// care, and the dashboard suggests a test account.

let installed = false;
let up = false;
let lowerTimer: ReturnType<typeof setTimeout> | undefined;

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const isWrite = (method: string | undefined) => !READS.has((method ?? "GET").toUpperCase());

/** The page's fetch as it was before the guard, for the widget's own calls to Haptic. */
let ownFetch: typeof fetch = (...args) => window.fetch(...args);
export const plainFetch: typeof fetch = (...args) => ownFetch(...args);

/** Raises the guard. Nothing but reads leaves the page until it is lowered. */
export function raise() {
  clearTimeout(lowerTimer);
  up = true;
}

/** Lowers the guard a moment from now, so a request the press set off a beat later is still stopped. */
export function lower(afterMs = 400): Promise<void> {
  return new Promise((resolve) => {
    clearTimeout(lowerTimer);
    lowerTimer = setTimeout(() => {
      up = false;
      resolve();
    }, afterMs);
  });
}

export const guardIsUp = () => up;

/** Puts the guard in place, lowered. Safe to call more than once. Nothing here may throw into the page. */
export function installGuard() {
  if (installed) return;
  installed = true;
  const quietly = (work: () => void) => {
    try {
      work();
    } catch (error) {
      console.warn("[Haptic]", error);
    }
  };

  quietly(() => {
    const real = window.fetch;
    ownFetch = real.bind(window);
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (up && isWrite(method)) return Promise.reject(new TypeError("Haptic is mapping this app, so nothing is being sent."));
      return real.call(window, input, init);
    } as typeof fetch;
  });

  quietly(() => {
    const methods = new WeakMap<XMLHttpRequest, string>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, ...rest: unknown[]) {
      methods.set(this, method);
      return (open as (...args: unknown[]) => void).call(this, method, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (up && isWrite(methods.get(this))) {
        // The page is told the request failed, as it would be if the network had dropped it.
        this.abort();
        this.dispatchEvent(new ProgressEvent("error"));
        this.dispatchEvent(new ProgressEvent("loadend"));
        return;
      }
      return send.call(this, body);
    };
  });

  quietly(() => {
    const beacon = navigator.sendBeacon;
    if (typeof beacon === "function") navigator.sendBeacon = (url, data) => (up ? false : beacon.call(navigator, url, data));
  });

  quietly(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data) {
      if (!up) send.call(this, data);
    };
  });

  quietly(() => {
    // A form's own submission, whatever its method: mapping never fills one in, so nothing it sends is wanted.
    document.addEventListener("submit", (event) => up && event.preventDefault(), true);
    const submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      if (!up) submit.call(this);
    };
    const requestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (typeof requestSubmit === "function") {
      HTMLFormElement.prototype.requestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null) {
        if (!up) requestSubmit.call(this, submitter);
      };
    }
  });

  quietly(() => {
    // "Are you sure?" is answered no. A box nobody is there to dismiss would also stop everything.
    const { confirm, alert, prompt, open, print } = window;
    window.confirm = (message) => (up ? false : confirm.call(window, message));
    window.alert = (message) => void (up || alert.call(window, message));
    window.prompt = (message, value) => (up ? null : prompt.call(window, message, value));
    window.open = ((...args: Parameters<typeof window.open>) => (up ? null : open.apply(window, args))) as typeof window.open;
    window.print = () => void (up || print.call(window));
  });
}
