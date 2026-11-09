import type { Prompt, SnapshotElement, TurnRequest } from "@haptic/protocol";
import type { ModelStream, Provider } from "./provider";

// A stand-in model for tests and offline development. It follows a scripted
// path of labels for known goals and otherwise points at the element whose
// label best matches the question. Set HAPTIC_MODEL=mock to use it.

const SCRIPTS: { match: RegExp; path: string[] }[] = [
  { match: /api key/i, path: ["Settings", "Organization", "Developer", "Create key"] },
  { match: /invite|team/i, path: ["Settings", "Team", "More actions", "Invite member"] },
  { match: /billing|plan|upgrade|invoice/i, path: ["Billing", "Manage plan"] },
  { match: /profile|account/i, path: ["AC", "Profile"] },
];

export class MockProvider implements Provider {
  readonly model = "mock";

  stream(_prompt: Prompt, request: TurnRequest, signal: AbortSignal): ModelStream {
    const reply = respond(request);
    async function* text() {
      // Stream in small pieces so the client exercises its streaming path.
      for (let i = 0; i < reply.length; i += 6) {
        if (signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
        yield reply.slice(i, i + 6);
      }
    }
    return { text: text(), usage: () => ({ inputTokens: 0, outputTokens: 0 }) };
  }
}

export function respond(request: TurnRequest): string {
  const goal = request.goal ?? request.question ?? "";
  const elements = request.snapshot.elements;
  const script = SCRIPTS.find((s) => s.match.test(goal));

  if (script) {
    const last = script.path[script.path.length - 1]!;
    if (request.kind === "continue" && request.event?.type === "clicked" && sameLabel(request.event.label, last)) {
      return "That's it. Fill in the details and confirm to finish. <done/>";
    }
    // Point at the furthest step of the path that's on screen right now.
    for (let i = script.path.length - 1; i >= 0; i--) {
      const label = script.path[i]!;
      const match = elements.find((el) => sameLabel(el.label, label));
      if (match) return `<point id="${match.id}"/>Click ${label}.<wait/>`;
    }
    return "I don't see a way there from this page. Try the main navigation.";
  }

  const best = bestMatch(goal, elements);
  if (!best) return "I don't see that on this page.";
  return `<point id="${best.id}"/>This is ${best.label || "it"}.`;
}

function sameLabel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function bestMatch(goal: string, elements: SnapshotElement[]): SnapshotElement | undefined {
  const words = new Set(goal.toLowerCase().split(/\W+/).filter((word) => word.length > 2));
  let best: SnapshotElement | undefined;
  let bestScore = 0;
  for (const el of elements) {
    const text = `${el.label} ${el.icon ?? ""}`.toLowerCase();
    const score = Array.from(words).filter((word) => text.includes(word)).length;
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}
