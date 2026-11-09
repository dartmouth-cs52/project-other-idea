import { base64ToBytes } from "./pcm.ts";

// ElevenLabs streaming text-to-speech. Text goes in piece by piece while the
// model is still writing; each piece is flushed so audio starts right away
// instead of waiting for ElevenLabs' default 120-character buffer.

export const TTS_SAMPLE_RATE = 24000;

export class TtsStream {
  private socket: WebSocket;
  private queue: string[] = [];

  constructor(token: string, voiceId: string, onAudio: (pcm: Int16Array) => void) {
    const params = new URLSearchParams({
      model_id: "eleven_flash_v2_5",
      output_format: `pcm_${TTS_SAMPLE_RATE}`,
      single_use_token: token,
      inactivity_timeout: "60",
    });
    this.socket = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?${params}`);
    this.socket.onopen = () => {
      this.socket.send(JSON.stringify({ text: " ", voice_settings: { stability: 0.55, similarity_boost: 0.75, speed: 1.05 } }));
      for (const message of this.queue) this.socket.send(message);
      this.queue = [];
    };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { audio?: string | null };
      if (!message.audio) return;
      const bytes = base64ToBytes(message.audio);
      onAudio(new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)));
    };
  }

  speak(text: string) {
    this.send({ text: `${text} `, flush: true });
  }

  /** No more text is coming. The socket closes once the audio is sent. */
  end() {
    this.send({ text: "" });
  }

  close() {
    if (this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }

  private send(message: object) {
    const json = JSON.stringify(message);
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(json);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.queue.push(json);
  }
}
