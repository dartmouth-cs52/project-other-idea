import { maskSensitive, type PageOutline, type TurnRequest } from "@haptic/protocol";
import { z } from "zod";

// Requests come from customer pages we don't control, so cap every size and
// re-mask text the SDK should already have masked.

const text = (max: number) => z.string().max(max).transform((value) => maskSensitive(value));

const element = z.object({
  id: z.string().regex(/^e\d{1,4}$/),
  role: z.string().max(30),
  label: text(120),
  icon: z.string().max(40).optional(),
  hints: z.array(text(80)).max(8).optional(),
  href: z.string().max(200).optional(),
  context: text(160).optional(),
  state: z.array(z.string().max(20)).max(8).optional(),
  position: z.enum(["visible", "above", "below", "left", "right"]),
});

const snapshot = z.object({
  path: z.string().max(300),
  title: text(200),
  viewport: z.object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    scrollY: z.number(),
    scrollHeight: z.number().nonnegative(),
  }),
  headings: z.array(text(120)).max(20),
  alerts: z.array(text(160)).max(10),
  text: z.array(text(200)).max(60).optional(),
  dialog: text(80).optional(),
  elements: z.array(element).max(500),
  truncated: z.boolean(),
});

const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clicked"), id: z.string().max(10), label: text(80) }),
  z.object({ type: z.literal("filled"), id: z.string().max(10), label: text(80) }),
  z.object({ type: z.literal("navigated"), from: z.string().max(300), to: z.string().max(300) }),
  z.object({ type: z.literal("changed") }),
]);

const change = z.object({
  none: z.boolean(),
  path: z.object({ from: z.string().max(300), to: z.string().max(300) }).optional(),
  dialogOpened: text(80).optional(),
  dialogClosed: text(80).optional(),
  added: z.array(text(160)).max(8).optional(),
  addedMore: z.number().int().min(0).max(1000).optional(),
  removed: z.array(text(160)).max(8).optional(),
  removedMore: z.number().int().min(0).max(1000).optional(),
  states: z.array(text(200)).max(8).optional(),
  text: z.array(text(120)).max(5).optional(),
});

const turnRequest = z.object({
  kind: z.enum(["ask", "continue"]),
  question: z.string().max(500).optional(),
  goal: z.string().max(500).optional(),
  event: event.optional(),
  change: change.optional(),
  nudge: z.object({ reason: z.enum(["unchanged", "repeated"]), label: text(160) }).optional(),
  step: z.number().int().min(0).max(50).optional(),
  visited: z.array(z.string().max(300)).max(20).optional(),
  snapshot,
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) })).max(24),
  context: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((value) => Object.keys(value).length <= 20, "Too many context keys")
    .optional(),
});

export function validateTurnRequest(input: unknown): TurnRequest {
  const parsed = turnRequest.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid turn request: ${parsed.error.issues[0]?.message ?? "bad shape"}`);
  const request = parsed.data as TurnRequest;
  if (request.kind === "ask" && !request.question?.trim()) throw new Error("Missing question");
  return request;
}

const outline = z.object({
  path: z.string().max(300),
  title: text(200),
  headings: z.array(text(120)).max(20),
  links: z.array(z.object({ label: text(80), href: z.string().max(300) })).max(60),
  buttons: z.array(text(80)).max(40),
});

export function validateOutline(input: unknown): PageOutline {
  const parsed = outline.safeParse(input);
  if (!parsed.success) throw new Error("Invalid outline");
  return parsed.data;
}
