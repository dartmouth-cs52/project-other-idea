import type { StreamEvent } from "./types.ts";

// Every event is one "data:" line of JSON with a "type" field.

export function encodeEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export class EventStreamDecoder {
  private buffer = "";

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: StreamEvent[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          events.push(JSON.parse(data) as StreamEvent);
        } catch {
          // A malformed block is skipped rather than ending the stream.
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}
