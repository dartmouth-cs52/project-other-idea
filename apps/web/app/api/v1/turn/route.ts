import { buildPrompt, encodeEvent, TagStreamParser, type ParsedEvent, type StreamEvent, type TurnRequest } from "@haptic/protocol";
import { after } from "next/server";
import { corsHeaders, jsonResponse, preflight } from "@/lib/cors";
import { env } from "@/lib/env";
import { getProvider } from "@/lib/llm/provider";
import { allow } from "@/lib/rateLimit";
import { verifySession } from "@/lib/sessionToken";
import { getSiteKnowledge } from "@/lib/sites";
import { validateTurnRequest } from "@/lib/validate";

export const maxDuration = 60;

const FIRST_TOKEN_TIMEOUT_MS = 8000;

export function OPTIONS(request: Request) {
  return preflight(request);
}

// One step of a guide. Streams the model's reply back as typed events:
// text, point, wait, done, then end with timings.
export async function POST(request: Request) {
  const started = performance.now();
  const claims = await verifySession(request);
  if (!claims) return jsonResponse(request, { error: "Session expired" }, 401);
  if (!allow(`turn:${claims.sessionId}`, env.turnLimit, 10 * 60_000)) {
    return jsonResponse(request, { error: "Too many questions. Wait a few minutes." }, 429);
  }

  let turn: TurnRequest;
  try {
    turn = validateTurnRequest(await request.json());
  } catch (error) {
    return jsonResponse(request, { error: error instanceof Error ? error.message : "Bad request" }, 400);
  }

  const knowledge = await getSiteKnowledge(claims.siteId, claims.siteName);
  const prompt = buildPrompt(knowledge, turn);
  // Development only: compare models without restarting the server.
  const modelOverride = env.isProduction ? null : request.headers.get("x-haptic-model");
  const provider = await getProvider(modelOverride ?? undefined);
  const validIds = new Set(turn.snapshot.elements.map((element) => element.id));
  const promptReadyMs = performance.now() - started;

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();
  const record = { model: provider.model, firstTokenMs: 0, firstPointMs: 0, raw: "", inputTokens: 0, outputTokens: 0, outcome: "answered", invalidPoints: 0 };
  let finished!: () => void;
  const streamDone = new Promise<void>((resolve) => (finished = resolve));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));
      const forward = (event: ParsedEvent) => {
        if (event.type === "point") {
          if (!validIds.has(event.id)) {
            record.invalidPoints++;
            return;
          }
          if (!record.firstPointMs) record.firstPointMs = Math.round(performance.now() - started);
          send({ type: "point", id: event.id });
        } else if (event.type === "text") {
          send(event);
        } else {
          record.outcome = event.type === "wait" ? "waiting" : "done";
          send(event);
        }
      };

      const timeout = setTimeout(() => abort.abort(new Error("The model took too long to start")), FIRST_TOKEN_TIMEOUT_MS);
      try {
        const model = provider.stream(prompt, turn, abort.signal);
        const parser = new TagStreamParser();
        for await (const delta of model.text) {
          if (!record.firstTokenMs) {
            clearTimeout(timeout);
            record.firstTokenMs = Math.round(performance.now() - started);
          }
          record.raw += delta;
          for (const event of parser.push(delta)) forward(event);
        }
        for (const event of parser.end()) forward(event);
        const usage = model.usage();
        record.inputTokens = usage.inputTokens ?? 0;
        record.outputTokens = usage.outputTokens ?? 0;
        send({
          type: "end",
          usage: {
            model: provider.model,
            ...usage,
            firstTokenMs: record.firstTokenMs,
            ...(record.firstPointMs ? { firstPointMs: record.firstPointMs } : {}),
          },
        });
      } catch (error) {
        // The SDK cancels a turn when the page changes under it, which isn't a failure.
        record.outcome = request.signal.aborted ? "cancelled" : "error";
        if (!request.signal.aborted) {
          console.error("[haptic] turn failed:", error);
          send({ type: "error", message: "The model request failed" });
        }
      } finally {
        clearTimeout(timeout);
        finished();
        try {
          controller.close();
        } catch {
          // Already closed because the client went away.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  after(async () => {
    await streamDone;
    const line = {
      site: claims.siteId,
      model: provider.model,
      kind: turn.kind,
      step: turn.step ?? 0,
      elements: turn.snapshot.elements.length,
      promptMs: Math.round(promptReadyMs),
      firstTokenMs: record.firstTokenMs,
      firstPointMs: record.firstPointMs,
      outcome: record.outcome,
      invalidPoints: record.invalidPoints,
      tokens: `${record.inputTokens}/${record.outputTokens}`,
    };
    if (claims.siteId === "dev-site") {
      console.log("[haptic] turn", JSON.stringify(line));
      return;
    }
    const { recordTurn } = await import("@/lib/db/usage");
    await recordTurn(claims, turn, record);
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(request.headers.get("origin")),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Server-Timing": `prompt;dur=${promptReadyMs.toFixed(1)}`,
    },
  });
}
