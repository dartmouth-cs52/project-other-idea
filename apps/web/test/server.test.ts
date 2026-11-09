import type { PageSnapshot, TurnRequest } from "@haptic/protocol";
import { describe, expect, it } from "vitest";
import { respond } from "@/lib/llm/mock";
import { isOriginAllowed } from "@/lib/origins";
import { signSession, verifySession } from "@/lib/sessionToken";
import { outlineToLabels, renderLabels, type OutlineLabel } from "@/lib/siteMap";
import { validateOutline, validateTurnRequest } from "@/lib/validate";

describe("isOriginAllowed", () => {
  const allowed = ["https://app.acme.com", "http://localhost:3000", "https://*.acme.dev"];
  it.each([
    ["https://app.acme.com", true],
    ["https://app.acme.com/", true],
    ["http://app.acme.com", false],
    ["https://evil.com", false],
    ["https://app.acme.com.evil.com", false],
    ["http://localhost:3000", true],
    ["http://localhost:3001", false],
    ["https://eu.acme.dev", true],
    ["https://acme.dev", false],
    ["https://evilacme.dev", false],
    [null, false],
  ])("%s → %s", (origin, expected) => {
    expect(isOriginAllowed(origin, allowed)).toBe(expected);
  });
});

describe("session tokens", () => {
  const claims = { siteId: "s1", orgId: "o1", origin: "https://app.acme.com", sessionId: "x", visitor: "v", siteName: "Acme", learning: true, voice: false };
  const request = (token: string, origin: string) =>
    new Request("https://haptic.test/api/v1/turn", { headers: { authorization: `Bearer ${token}`, origin } });

  it("verifies a token from the origin it was issued to", async () => {
    const { token } = await signSession(claims);
    expect((await verifySession(request(token, "https://app.acme.com")))?.siteId).toBe("s1");
  });

  it("rejects the same token from another origin, or a tampered one", async () => {
    const { token } = await signSession(claims);
    expect(await verifySession(request(token, "https://evil.com"))).toBeUndefined();
    expect(await verifySession(request(`${token}x`, "https://app.acme.com"))).toBeUndefined();
  });
});

const snapshot = (labels: string[]): PageSnapshot => ({
  path: "/",
  title: "Acme",
  viewport: { width: 1000, height: 800, scrollY: 0, scrollHeight: 800 },
  headings: [],
  alerts: [],
  elements: labels.map((label, i) => ({ id: `e${i + 1}`, role: "link", label, position: "visible" })),
  truncated: false,
});

describe("validateTurnRequest", () => {
  it("accepts a normal request and masks text again", () => {
    const request = validateTurnRequest({
      kind: "ask",
      question: "how do I add a key",
      snapshot: { ...snapshot(["Signed in as alex@acme.dev"]) },
      history: [],
    });
    expect(request.snapshot.elements[0]?.label).toBe("Signed in as [email]");
  });

  it("rejects oversized or malformed requests", () => {
    expect(() => validateTurnRequest({ kind: "ask", question: "x", snapshot: { path: "/" }, history: [] })).toThrow();
    expect(() => validateTurnRequest({ kind: "ask", question: "", snapshot: snapshot([]), history: [] })).toThrow();
    const many = snapshot(Array.from({ length: 501 }, () => "x"));
    expect(() => validateTurnRequest({ kind: "ask", question: "q", snapshot: many, history: [] })).toThrow();
  });
});

describe("mock model", () => {
  const ask = (question: string, labels: string[], extra: Partial<TurnRequest> = {}) =>
    respond({ kind: "ask", question, snapshot: snapshot(labels), history: [], ...extra });

  it("points at the furthest step of a known path that's on screen", () => {
    expect(ask("create an API key", ["Home", "Settings"])).toBe('<point id="e2"/>Click Settings.<wait/>');
    expect(ask("create an API key", ["Settings", "Organization"])).toBe('<point id="e2"/>Click Organization.<wait/>');
  });

  it("finishes after the last step is clicked", () => {
    const reply = respond({
      kind: "continue",
      goal: "create an API key",
      event: { type: "clicked", id: "e1", label: "Create key" },
      snapshot: snapshot(["Name"]),
      history: [],
    });
    expect(reply).toContain("<done/>");
  });
});

describe("site map", () => {
  it("drops personal and numeric labels when flattening an outline", () => {
    const rows = outlineToLabels(
      validateOutline({
        path: "/set/8f2c3a9b-1d2e-4f5a-9b8c-7d6e5f4a3b2c",
        title: "Flasht",
        headings: ["Biology 101", "alex@acme.dev"],
        links: [{ label: "Profile", href: "/profile" }, { label: "Docs", href: "external:docs.acme.com" }],
        buttons: ["Share", "1234"],
      }),
    );
    expect(rows.every((row) => row.route === "/set/:id")).toBe(true);
    expect(rows.map((row) => row.label).sort()).toEqual(["Biology 101", "Flasht", "Profile", "Share"]);
  });

  it("only renders labels enough different visitors saw", () => {
    const labels: OutlineLabel[] = [
      { route: "/profile", kind: "button", label: "Manage subscription", seenCount: 9, visitorCount: 5 },
      { route: "/set/:id", kind: "heading", label: "Biology 101", seenCount: 1, visitorCount: 1 },
      // One person opening their own set in many tabs doesn't count as many people.
      { route: "/set/:id", kind: "heading", label: "Spanish verbs", seenCount: 12, visitorCount: 1 },
      { route: "/set/:id", kind: "button", label: "Share", seenCount: 4, visitorCount: 3 },
      { route: "/profile", kind: "button", label: "Delete account", seenCount: 9, visitorCount: 9, hidden: true },
    ];
    expect(renderLabels(labels, 3)).toBe("/profile: buttons: Manage subscription\n/set/:id: buttons: Share");
  });

  it("lists navigation shared by most pages once, leaving room for each page's own labels", () => {
    const labels: OutlineLabel[] = [];
    for (const route of ["/home", "/profile", "/create", "/set/:id"]) {
      labels.push({ route, kind: "link", label: "My cards", href: "/home", seenCount: 5, visitorCount: 5 });
      labels.push({ route, kind: "button", label: "T", seenCount: 5, visitorCount: 5 });
    }
    for (let i = 0; i < 14; i++) labels.push({ route: "/set/:id", kind: "button", label: `Action ${i}`, seenCount: 5, visitorCount: 5 });
    labels.push({ route: "/set/:id", kind: "button", label: "Share", seenCount: 4, visitorCount: 4 });
    const map = renderLabels(labels, 3);
    expect(map.split("\n")[0]).toBe("On most pages: links: My cards (/home); buttons: T");
    expect(map).toContain("Share");
    expect(map).not.toMatch(/\/profile:/);
  });
});
