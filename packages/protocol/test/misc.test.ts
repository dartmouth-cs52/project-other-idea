import { describe, expect, it } from "vitest";
import { buildPrompt, serializeSnapshot } from "../src/prompt.ts";
import { normalizePath } from "../src/routes.ts";
import { cleanText, isLearnableLabel, maskSensitive } from "../src/sanitize.ts";
import { encodeEvent, EventStreamDecoder } from "../src/sse.ts";
import { DEFAULT_APPEARANCE, normalizeAppearance, type PageSnapshot } from "../src/types.ts";

describe("appearance", () => {
  it("keeps the one-line install defaults", () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it("fills older records without overwriting their choices", () => {
    expect(normalizeAppearance({ accent: "#123456", position: "bottom-left", launcherLabel: "Guide me", showLauncher: false })).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: "#123456",
      position: "bottom-left",
      launcherLabel: "Guide me",
      showLauncher: false,
    });
  });

  it("accepts all placement controls and bounds numeric values", () => {
    expect(
      normalizeAppearance({
        position: "top-center",
        panelPosition: "bottom-right",
        launcherStyle: "icon",
        edgeOffsetX: -10,
        edgeOffsetY: 999,
        panelWidth: 421.6,
      }),
    ).toMatchObject({
      position: "top-center",
      panelPosition: "bottom-right",
      launcherStyle: "icon",
      edgeOffsetX: 0,
      edgeOffsetY: 160,
      panelWidth: 422,
    });
  });

  it("rejects malformed stored values", () => {
    expect(normalizeAppearance({ accent: "red", position: "middle", panelPosition: "wherever", panelWidth: "500" })).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("normalizePath", () => {
  it.each([
    ["/set/8f2c3a9b-1d2e-4f5a-9b8c-7d6e5f4a3b2c", "/set/:id"],
    ["/projects/12345/settings", "/projects/:id/settings"],
    ["/projects/prj_8f2c91ab", "/projects/:id"],
    ["/customers/cus_9f8a7sd6f2", "/customers/:id"],
    ["/users/alex@acme.dev", "/users/:id"],
    ["/objects/507f1f77bcf86cd799439011", "/objects/:id"],
    ["/settings/organization/developer", "/settings/organization/developer"],
    ["/api/v2/step-3", "/api/v2/step-3"],
    ["https://app.acme.com/billing?tab=invoices#top", "/billing"],
    ["/", "/"],
    ["", "/"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("sanitize", () => {
  it("masks emails, phone numbers and long digit runs", () => {
    expect(maskSensitive("Signed in as alex@acme.dev")).toBe("Signed in as [email]");
    expect(maskSensitive("Call +1 (555) 123-4567")).toBe("Call [number]");
    expect(maskSensitive("Order 1234567 shipped")).toBe("Order [number] shipped");
    expect(maskSensitive("Plan costs $240")).toBe("Plan costs $240");
  });

  it("collapses whitespace and caps length", () => {
    expect(cleanText("  a\n\n b  ")).toBe("a b");
    expect(cleanText("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });

  it("only learns short, unmasked labels with letters", () => {
    expect(isLearnableLabel("Manage subscription")).toBe(true);
    expect(isLearnableLabel("[email]")).toBe(false);
    expect(isLearnableLabel("2024")).toBe(false);
    expect(isLearnableLabel("y".repeat(61))).toBe(false);
  });
});

describe("event stream", () => {
  it("round-trips events split across chunks", () => {
    const wire = encodeEvent({ type: "text", text: "Hi\n\nthere" }) + encodeEvent({ type: "point", id: "e1" }) + encodeEvent({ type: "done" });
    const decoder = new EventStreamDecoder();
    const events = wire.split("").flatMap((char) => decoder.push(char));
    expect(events).toEqual([{ type: "text", text: "Hi\n\nthere" }, { type: "point", id: "e1" }, { type: "done" }]);
  });
});

const SNAPSHOT: PageSnapshot = {
  path: "/set/:id",
  title: "Flasht",
  viewport: { width: 1440, height: 900, scrollY: 0, scrollHeight: 2400 },
  headings: ["Biology 101"],
  alerts: [],
  elements: [
    { id: "e1", role: "link", label: "", icon: "plus", context: "header", href: "/create", position: "visible" },
    { id: "e2", role: "button", label: "T", hints: ["short-text"], context: "header", position: "visible" },
    { id: "e3", role: "button", label: 'Say "hi"', state: ["disabled"], position: "below" },
  ],
  truncated: false,
};

describe("prompt", () => {
  it("serializes a snapshot compactly", () => {
    expect(serializeSnapshot(SNAPSHOT)).toMatchInlineSnapshot(`
      "Path: /set/:id
      Title: Flasht
      Viewport: 1440x900, scrolled to 0 of 2400
      Headings: Biology 101
      Elements:
      e1 link icon:plus [header] → /create
      e2 button "T" short-text [header]
      e3 button "Say 'hi'" (disabled) below"
    `);
  });

  it("keeps site knowledge in the system part and the turn in the last message", () => {
    const prompt = buildPrompt(
      { siteName: "Flasht", notes: "Flashcards app.", siteMap: "/profile: buttons Manage subscription" },
      {
        kind: "continue",
        goal: "cancel Pro",
        step: 1,
        event: { type: "clicked", id: "e2", label: "T" },
        snapshot: SNAPSHOT,
        history: [
          { role: "assistant", text: "orphaned" },
          { role: "user", text: "cancel Pro" },
          { role: "assistant", text: "[pointed at button \"T\"] Open your account menu." },
        ],
      },
    );
    expect(prompt.system).toContain("built into Flasht");
    expect(prompt.system).toContain("Flashcards app.");
    expect(prompt.system).toContain("Manage subscription");
    expect(prompt.messages[0]).toEqual({ role: "user", text: "cancel Pro" });
    const last = prompt.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.text).toContain('Goal: "cancel Pro"');
    expect(last.text).toContain('Step 2. The user clicked "T"');
    expect(last.text).toContain("e2 button");
  });
});
