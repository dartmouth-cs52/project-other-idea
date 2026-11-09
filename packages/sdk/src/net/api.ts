import { EventStreamDecoder, type PageOutline, type SessionResponse, type StreamEvent, type TurnRequest } from "@haptic/protocol";
import { visitorId } from "./visitor.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Talks to the Haptic API. Holds the short-lived session token. */
export class ApiClient {
  private session?: SessionResponse;
  private pending?: Promise<SessionResponse>;

  constructor(
    private readonly base: string,
    private readonly key: string,
  ) {}

  async ensureSession(): Promise<SessionResponse> {
    if (this.session && this.session.expiresAt - Date.now() > 60_000) return this.session;
    this.pending ??= this.startSession().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async startSession(): Promise<SessionResponse> {
    const res = await fetch(`${this.base}/api/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: this.key, visitor: visitorId() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `Session failed with ${res.status}`, res.status);
    }
    this.session = (await res.json()) as SessionResponse;
    return this.session;
  }

  async *turn(request: TurnRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    let res = await this.postTurn(request, signal);
    if (res.status === 401) {
      // Token expired between ensureSession and the request. Try once more.
      this.session = undefined;
      res = await this.postTurn(request, signal);
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `Request failed with ${res.status}`, res.status);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const decoder = new EventStreamDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of decoder.push(value)) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async postTurn(request: TurnRequest, signal: AbortSignal): Promise<Response> {
    const session = await this.ensureSession();
    return fetch(`${this.base}/api/v1/turn`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify(request),
      signal,
    });
  }

  /** Single-use ElevenLabs tokens for one speech-to-text and/or one TTS connection. */
  async voiceTokens(kinds: ("stt" | "tts")[]): Promise<{ stt?: string; tts?: string; voiceId: string }> {
    const session = await this.ensureSession();
    const res = await fetch(`${this.base}/api/v1/voice-token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ kinds }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(body.error ?? `Voice failed with ${res.status}`, res.status);
    }
    return (await res.json()) as { stt?: string; tts?: string; voiceId: string };
  }

  /** Fire-and-forget outline for the learned site map. */
  async sendOutline(outline: PageOutline): Promise<void> {
    const session = await this.ensureSession();
    await fetch(`${this.base}/api/v1/outline`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: JSON.stringify(outline),
      keepalive: true,
    });
  }
}
