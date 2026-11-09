import { MIC_SAMPLE_RATE } from "./mic.ts";
import { bytesToBase64 } from "./pcm.ts";

// ElevenLabs Scribe realtime speech-to-text over a websocket. Audio is sent as
// it's captured; releasing the button commits and waits for the final text.

interface ScribeMessage {
  message_type: string;
  text?: string;
  error?: string;
}

export class ScribeSession {
  private socket: WebSocket;
  private queue: string[] = [];
  private committed = "";
  private finished?: (text: string) => void;
  private failed?: (error: Error) => void;

  constructor(token: string, onPartial: (text: string) => void) {
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: `pcm_${MIC_SAMPLE_RATE}`,
      commit_strategy: "manual",
      token,
    });
    this.socket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`);
    this.socket.onopen = () => {
      for (const message of this.queue) this.socket.send(message);
      this.queue = [];
    };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ScribeMessage;
      if (message.message_type === "partial_transcript") {
        onPartial(`${this.committed} ${message.text ?? ""}`.trim());
      } else if (message.message_type === "committed_transcript") {
        this.committed = `${this.committed} ${message.text ?? ""}`.trim();
        onPartial(this.committed);
        this.finished?.(this.committed);
      } else if (message.error) {
        this.failed?.(new Error(`${message.message_type}: ${message.error}`));
      }
    };
    this.socket.onerror = () => this.failed?.(new Error("Speech connection failed"));
  }

  sendAudio(pcm: Int16Array, commit = false) {
    const message = JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: bytesToBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
      commit,
      sample_rate: MIC_SAMPLE_RATE,
    });
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(message);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.queue.push(message);
  }

  /** Commit what's been said and resolve with the final transcript. */
  finish(timeoutMs = 4000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(this.committed), timeoutMs);
      this.finished = (text) => {
        clearTimeout(timer);
        resolve(text);
      };
      this.failed = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.sendAudio(new Int16Array(0), true);
    }).finally(() => this.close()) as Promise<string>;
  }

  close() {
    if (this.socket.readyState <= WebSocket.OPEN) this.socket.close();
  }
}
