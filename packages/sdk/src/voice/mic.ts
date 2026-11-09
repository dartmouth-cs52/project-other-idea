import { floatToPcm16, resample } from "./pcm.ts";

// Captures the microphone as 16kHz 16-bit mono frames of about 100ms.

export const MIC_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600;

// Runs on the audio thread and posts raw samples back. Loaded from a blob so
// the customer doesn't have to host anything.
const WORKLET = `
class HapticCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("haptic-capture", HapticCapture);
`;

export interface Mic {
  stop(): void;
  /** Rough input level from 0 to 1, for the listening meter. */
  level(): number;
}

export async function startMic(onFrame: (pcm: Int16Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  let pending = new Float32Array(0);
  let level = 0;

  const handle = (samples: Float32Array) => {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    level = level * 0.7 + peak * 0.3;
    const down = resample(samples, context.sampleRate, MIC_SAMPLE_RATE);
    const merged = new Float32Array(pending.length + down.length);
    merged.set(pending);
    merged.set(down, pending.length);
    let offset = 0;
    while (merged.length - offset >= FRAME_SAMPLES) {
      onFrame(floatToPcm16(merged.subarray(offset, offset + FRAME_SAMPLES)));
      offset += FRAME_SAMPLES;
    }
    pending = merged.slice(offset);
  };

  let node: AudioNode;
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const worklet = new AudioWorkletNode(context, "haptic-capture");
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => handle(event.data);
    node = worklet;
  } catch {
    // A strict CSP can block blob: modules. Fall back to the older processor.
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => handle(event.inputBuffer.getChannelData(0));
    node = processor;
  }
  source.connect(node);
  // Some browsers only pull audio through nodes that reach the destination.
  const mute = context.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(context.destination);

  return {
    stop() {
      if (pending.length) onFrame(floatToPcm16(pending));
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
    level: () => Math.min(1, level * 3),
  };
}
