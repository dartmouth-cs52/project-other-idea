import { actingAllowedAt, DEFAULT_APPEARANCE, localDate, STREAM_TYPE, TURN_VERSION, type PublicSiteConfig, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { Guide, type Reporter } from "./guide.ts";
import { currentPath } from "./snapshot.ts";
import { Ui } from "./ui.ts";

// Entry point of the script customers paste into their site:
//   <script src="https://<haptic-host>/widget.js" data-site="site_..." async></script>
// It runs on someone else's page, so nothing here may throw into it.
//
// A site with "do it with me" on shows a Do it button beside the ask box. A
// page can switch that off for itself, never on, with data-acting="off" on
// the script tag: a company may want it for some of its pages only.
//
// A page shown on a projector or a shared screen can ask for presentation
// mode with data-present="1" on the script tag: a larger pointer, caption and
// ring, and the question kept on show. It is never on otherwise.

const script = document.currentScript as HTMLScriptElement | null;

async function boot() {
  const site = script?.dataset.site;
  if (!script || !site) return console.warn("[Haptic] The script tag needs a data-site attribute.");
  if (document.querySelector("haptic-root")) return;
  const api = new URL(script.src).origin;

  // The launcher shows up even if the config can't be fetched. Only the look depends on it.
  let config: PublicSiteConfig = { name: "", appearance: DEFAULT_APPEARANCE };
  try {
    const response = await fetch(`${api}/v1/sites/${encodeURIComponent(site)}`);
    if (response.status === 403 || response.status === 404) return console.warn(`[Haptic] ${(await response.json()).error}`);
    if (response.ok) config = await response.json();
  } catch (error) {
    console.warn("[Haptic] Couldn't load the site's settings.", error);
  }
  // Switched off for this site. Nothing is drawn, and nothing is said about it on the customer's page.
  if (config.off) return;

  // The reply comes as lines of JSON. The first names the control to point at,
  // as soon as the model has decided. The last is the whole reply. `request`
  // carries `mode: "act"` when the visitor pressed Do it; the version says
  // this widget understands an act reply. Stop aborts the request in flight.
  //
  // `fetch` is the page's, and a page's monitoring script may have wrapped it
  // and hand back an object of its own: one that can be read as text, with no
  // stream to read as it arrives, and sometimes no headers. Then the reply is
  // read whole and taken line by line all the same.
  const sendTurn = async (request: Omit<TurnRequest, "site">, onTarget?: (id: string) => void, signal?: AbortSignal): Promise<TurnReply> => {
    const response = await fetch(`${api}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: STREAM_TYPE },
      body: JSON.stringify({ ...request, site, version: TURN_VERSION, today: localDate() }),
      ...(signal ? { signal } : {}),
    });
    const status = typeof response.status === "number" ? response.status : 0;
    const ok = typeof response.ok === "boolean" ? response.ok : status >= 200 && status < 300;
    if (!ok) throw new Error(`Turn failed with ${status}: ${await wholeText(response).catch(() => "")}`);

    let reply: TurnReply | undefined;
    const takeMessage = (message: Partial<TurnReply> & { error?: string; code?: number }) => {
      if (message.error) throw new Error(`Turn failed with ${message.code}: ${message.error}`);
      if (typeof message.say === "string") reply = message as TurnReply;
      else if (typeof message.target === "string") onTarget?.(message.target);
    };
    const take = (line: string) => {
      if (line.trim()) takeMessage(JSON.parse(line));
    };
    const type = typeof response.headers?.get === "function" ? (response.headers.get("Content-Type") ?? "") : "";
    const body = response.body;
    if (body && typeof body.getReader === "function" && type.includes(STREAM_TYPE)) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffered.split("\n");
        buffered = done ? "" : (lines.pop() ?? "");
        for (const line of lines) take(line);
        if (done) break;
      }
    } else {
      // Read whole: one JSON, as a server that does not stream sends it, or the same lines as the stream.
      const text = await wholeText(response);
      let whole: unknown;
      try {
        whole = JSON.parse(text);
      } catch {
        whole = undefined;
      }
      if (whole && typeof whole === "object") takeMessage(whole);
      else for (const line of text.split("\n")) take(line);
    }
    if (!reply) throw new Error("The reply ended before it was complete.");
    return reply;
  };

  // Sent as text/plain, which needs no preflight, and with keepalive, so a
  // report made as the visitor leaves the page still arrives. It never matters
  // to the visitor whether it does, so nothing about it is thrown into the
  // page, even by a `fetch` the page has wrapped.
  const report: Reporter = (guide, body) => {
    try {
      void Promise.resolve(
        fetch(`${api}/v1/guides/${guide}/report`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ ...body, site }),
          keepalive: true,
        }),
      ).catch(() => {});
    } catch {
      // Nothing to tell the visitor.
    }
  };

  // Acting is on only where the site turned it on, and the page did not turn it off.
  const pageOff = (script.dataset.acting ?? "").trim().toLowerCase() === "off";
  const acting = config.acting && typeof config.acting === "object" && !pageOff ? config.acting : undefined;
  const present = /^(?:1|true|on|yes)$/i.test((script.dataset.present ?? "").trim());
  const ui: Ui = new Ui(
    config.appearance,
    {
      onAsk: (question, act) => guide.start(question, act),
      onStop: () => guide.stop(),
      onCarryOn: () => guide.carryOn(),
    },
    acting ? { site, confirmFirst: acting.confirmFirst !== false, allowedHere: () => actingAllowedAt(acting, currentPath()) } : undefined,
    { present },
  );
  const guide = new Guide(ui, sendTurn, { ...(acting ? { acting } : {}), ...(pageOff ? { pageOff } : {}) }, report);
  guide.resume();
}

/** A response read whole as text: by `text()`, or by `json()` when that is all a wrapped `fetch` gives back. */
async function wholeText(response: Response): Promise<string> {
  if (typeof response.text === "function") return response.text();
  if (typeof response.json === "function") return JSON.stringify(await response.json());
  return "";
}

const start = () => boot().catch((error) => console.warn("[Haptic]", error));
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);
