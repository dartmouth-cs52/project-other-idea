import { pcm16ToFloat } from "./pcm.ts";

// Plays 16-bit PCM chunks back to back as they arrive from the TTS socket.

export class PcmPlayer {
  private context?: AudioContext;
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private readonly sampleRate: number) {}

  /** Call from a user gesture so the browser allows audio to start. */
  unlock() {
    this.context ??= new AudioContext();
    void this.context.resume();
  }

  play(pcm: Int16Array) {
    if (pcm.length === 0) return;
    this.unlock();
    const context = this.context!;
    const buffer = context.createBuffer(1, pcm.length, this.sampleRate);
    buffer.copyToChannel(pcm16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    // A small lead on the first chunk avoids a click at the start.
    const start = Math.max(context.currentTime + 0.03, this.nextStart);
    source.start(start);
    this.nextStart = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.sources.clear();
    this.nextStart = 0;
  }
}
