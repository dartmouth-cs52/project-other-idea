import { jsonResponse, preflight } from "@/lib/cors";
import { env } from "@/lib/env";
import { allow } from "@/lib/rateLimit";
import { verifySession } from "@/lib/sessionToken";

export function OPTIONS(request: Request) {
  return preflight(request);
}

type Kind = "stt" | "tts";
const TOKEN_TYPE: Record<Kind, string> = { stt: "realtime_scribe", tts: "tts_websocket" };

// Single-use ElevenLabs tokens, so the browser can stream audio straight to
// ElevenLabs without our API key ever reaching the page. Each token works for
// one connection and expires after 15 minutes.
export async function POST(request: Request) {
  const claims = await verifySession(request);
  if (!claims) return jsonResponse(request, { error: "Session expired" }, 401);
  if (!env.voiceFeature || !claims.voice || !env.elevenLabsApiKey) return jsonResponse(request, { error: "Voice isn't enabled for this site" }, 403);
  if (!allow(`voice:${claims.sessionId}`, 60, 10 * 60_000)) return jsonResponse(request, { error: "Too many requests" }, 429);

  const body = (await request.json().catch(() => ({}))) as { kinds?: unknown };
  const kinds = (Array.isArray(body.kinds) ? body.kinds : ["stt", "tts"]).filter((kind): kind is Kind => kind === "stt" || kind === "tts");

  try {
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        const res = await fetch(`https://api.elevenlabs.io/v1/single-use-token/${TOKEN_TYPE[kind]}`, {
          method: "POST",
          headers: { "xi-api-key": env.elevenLabsApiKey },
        });
        if (!res.ok) throw new Error(`ElevenLabs ${kind} token failed with ${res.status}: ${await res.text()}`);
        return [kind, ((await res.json()) as { token: string }).token] as const;
      }),
    );
    return jsonResponse(request, { ...Object.fromEntries(entries), voiceId: env.elevenLabsVoiceId });
  } catch (error) {
    console.error("[haptic] voice token failed:", error);
    return jsonResponse(request, { error: "Voice is unavailable right now" }, 502);
  }
}
