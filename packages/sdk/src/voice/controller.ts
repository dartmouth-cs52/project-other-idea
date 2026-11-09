import { SpeechChunker, speakable } from "@haptic/protocol";
import type { ApiClient } from "../net/api.ts";
import { startMic, type Mic } from "./mic.ts";
import { PcmPlayer } from "./player.ts";
import { ScribeSession } from "./stt.ts";
import { TTS_SAMPLE_RATE, TtsStream } from "./tts.ts";

// Push-to-talk and spoken answers. Holding the launcher starts the mic and a
// speech-to-text socket; releasing it returns the transcript. Answers are
// spoken through a streaming TTS socket, one clause at a time.

export interface Speaker {
  push(text: string): void;
  end(): void;
  cancel(): void;
}

interface VoiceTokens {
  stt?: string;
  tts?: string;
  voiceId: string;
}

export class VoiceController {
  private readonly player = new PcmPlayer(TTS_SAMPLE_RATE);
  private mic?: Mic;
  private stt?: ScribeSession;
  private earlyFrames: Int16Array[] = [];
  private spareTts?: Promise<VoiceTokens>;
  private listening = false;
  private tts?: TtsStream;
  /** Why speech-to-text couldn't start, reported when the user lets go. */
  private failure?: Error;

  constructor(private readonly api: ApiClient) {}

  /** Start capturing. Resolves once the mic is live. */
  async startListening(onPartial: (text: string) => void): Promise<void> {
    this.stopAll();
    this.listening = true;
    this.earlyFrames = [];
    // Called during the press, which lets audio play later without a prompt.
    this.player.unlock();

    this.failure = undefined;
    const tokens = this.api.voiceTokens(["stt", "tts"]);
    tokens.catch((error: Error) => {
      this.failure = error;
    });
    // Keep the TTS token for the answer so it's ready when text arrives.
    this.spareTts = tokens;

    const mic = await startMic((frame) => {
      if (this.stt) this.stt.sendAudio(frame);
      else this.earlyFrames.push(frame);
    });
    if (!this.listening) {
      // Released while the permission prompt was up.
      mic.stop();
      throw new MicPermissionGranted();
    }
    this.mic = mic;

    const { stt } = await tokens;
    if (!stt) throw new Error("No speech token");
    this.stt = new ScribeSession(stt, onPartial);
    for (const frame of this.earlyFrames) this.stt.sendAudio(frame);
    this.earlyFrames = [];
  }

  /** Stop capturing and return what was said. */
  async stopListening(): Promise<string> {
    this.listening = false;
    this.mic?.stop();
    this.mic = undefined;
    const stt = this.stt;
    this.stt = undefined;
    if (!stt) {
      if (this.failure) throw this.failure;
      return "";
    }
    return (await stt.finish()).trim();
  }

  level(): number {
    return this.mic?.level() ?? 0;
  }

  /** A sink for one answer's text. Opens a TTS socket for it. */
  speaker(): Speaker {
    this.player.stop();
    const tokens = this.spareTts ?? this.api.voiceTokens(["tts"]);
    this.spareTts = undefined;
    const chunker = new SpeechChunker();
    let stream: TtsStream | undefined;
    let cancelled = false;
    const pending: string[] = [];
    let ended = false;

    void tokens
      .then(({ tts, voiceId }) => {
        if (cancelled || !tts) return;
        stream = new TtsStream(tts, voiceId, (pcm) => {
          if (!cancelled) this.player.play(pcm);
        });
        this.tts = stream;
        for (const piece of pending) stream.speak(piece);
        if (ended) stream.end();
      })
      .catch((error) => console.warn("[Haptic] Voice unavailable:", error));

    const say = (piece: string) => {
      const text = speakable(piece);
      if (!text) return;
      if (stream) stream.speak(text);
      else pending.push(text);
    };

    return {
      push: (text) => chunker.push(text).forEach(say),
      end: () => {
        chunker.flush().forEach(say);
        ended = true;
        stream?.end();
      },
      cancel: () => {
        cancelled = true;
        stream?.close();
        this.player.stop();
      },
    };
  }

  stopAll() {
    this.listening = false;
    this.mic?.stop();
    this.mic = undefined;
    this.stt?.close();
    this.stt = undefined;
    this.tts?.close();
    this.tts = undefined;
    this.player.stop();
  }
}

/** The first hold only got microphone permission. */
export class MicPermissionGranted extends Error {
  constructor() {
    super("Microphone allowed");
  }
}
