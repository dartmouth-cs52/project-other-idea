import { DEFAULT_APPEARANCE, MODES, STREAM_TYPE, type Mode, type PublicSiteConfig, type TurnReply, type TurnRequest } from "../shared/types.ts";
import { Guide, type HandoffWay, type Reporter, type Watch } from "./guide.ts";
import { Ui } from "./ui.ts";

// Entry point of the script customers paste into their site:
//   <script src="https://<haptic-host>/widget.js" data-site="site_..." async></script>
// It runs on someone else's page, so nothing here may throw into it.

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

  // The reply comes as lines of JSON. The first lines say what kind of reply
  // it is (on a site with Answers on) and name the control to point at, each as
  // soon as the model has decided. The last is the whole reply.
  const sendTurn = async (request: Omit<TurnRequest, "site">, watch: Watch = {}, signal?: AbortSignal): Promise<TurnReply> => {
    // Aborting hangs up on the server, which stops asking the model and records the step as dropped.
    const response = await fetch(`${api}/v1/turn`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Accept: STREAM_TYPE },
      body: JSON.stringify({ ...request, site }),
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
        else if (typeof message.target === "string") watch.onTarget?.(message.target);
        else if (MODES.includes(message.mode as Mode)) watch.onMode?.(message.mode as Mode);
      }
      if (done) break;
    }
    if (!reply) throw new Error("The reply ended before it was complete.");
    return reply;
  };

  // Sent as text/plain, which needs no preflight, and with keepalive, so a
  // report made as the visitor leaves the page still arrives. It never matters
  // to the visitor whether it does.
  const report: Reporter = (guide, body) => {
    void fetch(`${api}/v1/guides/${guide}/report`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...body, site }),
      keepalive: true,
    }).catch(() => {});
  };

  const ui: Ui = new Ui(config.appearance, {
    onAsk: (question) => guide.start(question),
    onStop: () => guide.stop(),
  });
  // The way to a person, when the site has one. The form goes to the server, which passes it on to the company.
  const handoff: HandoffWay | undefined = config.handoff && {
    config: config.handoff,
    send: (form) =>
      fetch(`${api}/v1/handoff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, site }) })
        .then((response) => response.ok)
        .catch(() => false),
  };
  const guide = new Guide(ui, sendTurn, report, handoff);
  guide.resume();
}

const start = () => boot().catch((error) => console.warn("[Haptic]", error));
if (document.body) start();
else document.addEventListener("DOMContentLoaded", start);
