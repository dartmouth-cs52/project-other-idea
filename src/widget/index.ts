import { actingAllowedAt, DEFAULT_APPEARANCE, localDate, STREAM_TYPE, TURN_VERSION, type PublicSiteConfig, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { Guide } from "./guide.ts";
import { currentPath } from "./snapshot.ts";
import { Ui } from "./ui.ts";

// Entry point of the script customers paste into their site:
//   <script src="https://<haptic-host>/widget.js" data-site="site_..." async></script>
// It runs on someone else's page, so nothing here may throw into it.
//
// A site with "do it with me" on shows a Do it button beside the ask box. A
// page can switch that off for itself, never on, with data-acting="off" on
// the script tag: a company may want it for some of its pages only.

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

  // The reply comes as lines of JSON. The first names the control to point at,
  // as soon as the model has decided. The last is the whole reply. `request`
  // carries `mode: "act"` when the visitor pressed Do it; the version says
  // this widget understands an act reply. Stop aborts the request in flight.
  const sendTurn = async (request: Omit<TurnRequest, "site">, onTarget?: (id: string) => void, signal?: AbortSignal): Promise<TurnReply> => {
    const response = await fetch(`${api}/v1/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: STREAM_TYPE },
      body: JSON.stringify({ ...request, site, version: TURN_VERSION, today: localDate() }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Turn failed with ${response.status}: ${await response.text()}`);
    if (!response.body || !(response.headers.get("Content-Type") ?? "").includes(STREAM_TYPE)) return response.json();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    let reply: TurnReply | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffered.split("\n");
      buffered = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as Partial<TurnReply> & { error?: string; code?: number };
        if (message.error) throw new Error(`Turn failed with ${message.code}: ${message.error}`);
        if (typeof message.say === "string") reply = message as TurnReply;
        else if (typeof message.target === "string") onTarget?.(message.target);
      }
      if (done) break;
    }
    if (!reply) throw new Error("The reply ended before it was complete.");
    return reply;
  };

  // Acting is on only where the site turned it on, and the page did not turn it off.
  const pageOff = (script.dataset.acting ?? "").trim().toLowerCase() === "off";
  const acting = config.acting && typeof config.acting === "object" && !pageOff ? config.acting : undefined;
  const ui: Ui = new Ui(
    config.appearance,
    {
      onAsk: (question, act) => guide.start(question, act),
      onStop: () => guide.stop(),
      onCarryOn: () => guide.carryOn(),
    },
    acting ? { site, confirmFirst: acting.confirmFirst !== false, allowedHere: () => actingAllowedAt(acting, currentPath()) } : undefined,
  );
  const guide = new Guide(ui, sendTurn, { ...(acting ? { acting } : {}), ...(pageOff ? { pageOff } : {}) });
  guide.resume();
}

const start = () => boot().catch((error) => console.warn("[Haptic]", error));
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);
