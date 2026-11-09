import { expect, test, type Page } from "@playwright/test";
import type { StreamEvent, TurnRequest } from "@haptic/protocol";

// A scripted model answers each turn, so these tests check what the SDK sends
// and holds back rather than what a model happens to say.

type Reply = (request: TurnRequest, index: number) => StreamEvent[];

async function scriptModel(page: Page, reply: Reply): Promise<TurnRequest[]> {
  const requests: TurnRequest[] = [];
  await page.route("**/api/v1/turn", async (route) => {
    const cors = {
      "access-control-allow-origin": route.request().headers().origin ?? "*",
      "access-control-allow-headers": "authorization, content-type",
      vary: "Origin",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const request = route.request().postDataJSON() as TurnRequest;
    requests.push(request);
    const events = [...reply(request, requests.length - 1), { type: "end" } as const];
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "text/event-stream" },
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    });
  });
  return requests;
}

function point(request: TurnRequest, label: string, text: string): StreamEvent[] {
  const element = request.snapshot.elements.find((el) => el.label === label);
  if (!element) throw new Error(`No "${label}" on ${request.snapshot.path}`);
  return [{ type: "point", id: element.id }, { type: "text", text }, { type: "wait" }];
}

const phase = (page: Page) => page.evaluate(() => window.Haptic?.debug.phase());
const targetText = (page: Page) => page.evaluate(() => window.Haptic?.debug.target()?.textContent?.trim());

async function start(page: Page, path: string, question: string) {
  await page.goto(path);
  await expect(page.locator("haptic-root")).toBeAttached();
  await page.evaluate((q) => window.Haptic!.ask(q), question);
}

test("a point at the button the user just clicked, with nothing changed, is held back and retried", async ({ page }) => {
  const requests = await scriptModel(page, (request, index) => {
    if (index === 0) return point(request, "Manage plan", "Click Manage plan.");
    if (request.nudge) return [{ type: "text", text: "Your plan is selected." }, { type: "done" }];
    return point(request, "Team", "Pick Team.");
  });
  await start(page, "/billing", "change my plan");

  await expect.poll(() => targetText(page)).toBe("Manage plan");
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  await expect.poll(() => targetText(page)).toBe("Team");
  // The plan buttons do nothing, so the page stays the same.
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  await expect.poll(() => phase(page)).toBe("done");

  expect(requests[1]!.change).toMatchObject({ none: false, dialogOpened: "Choose a plan" });
  expect(requests[2]!.change).toEqual({ none: true });
  expect(requests[2]!.nudge).toBeUndefined();
  expect(requests[3]!.nudge).toEqual({ reason: "unchanged", label: 'button "Team"' });
  expect(requests).toHaveLength(4);
});

test("a model that repeats itself after the nudge gets stopped", async ({ page }) => {
  await scriptModel(page, (request, index) =>
    index === 0 ? point(request, "Manage plan", "Click Manage plan.") : point(request, "Team", "Pick Team."),
  );
  await start(page, "/billing", "change my plan");

  await expect.poll(() => targetText(page)).toBe("Manage plan");
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  await expect.poll(() => targetText(page)).toBe("Team");
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());

  await expect.poll(() => phase(page)).toBe("answered");
  await expect(page.locator("haptic-root").getByText("so I've stopped here")).toBeVisible();
});

test("Next on each page of a form isn't treated as a loop", async ({ page }) => {
  const requests = await scriptModel(page, (request, index) => {
    if (index === 0) return point(request, "New project", "Click New project.");
    if (index === 1) return point(request, "Next", "Click Next.");
    if (index === 2) return point(request, "Next", "Click Next again.");
    if (index === 3) return point(request, "Create project", "Click Create project.");
    return [{ type: "text", text: "Your project is created." }, { type: "done" }];
  });
  await start(page, "/projects", "create a project");

  for (const label of ["New project", "Next", "Next", "Create project"]) {
    await expect.poll(() => targetText(page)).toContain(label);
    await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  }
  await expect.poll(() => phase(page)).toBe("done");
  expect(requests[2]!.change?.text).toContain("Step 2 of 3");
  expect(requests.some((request) => request.nudge)).toBe(false);
});

test("a pointed-at field waits for the user to type, not for the click into it", async ({ page }) => {
  const requests = await scriptModel(page, (request, index) => {
    if (index === 0) return point(request, "Create key", "Click Create key.");
    if (index === 1) return point(request, "Name", "Name the key.");
    return point(request, "Create", "Click Create.");
  });
  await start(page, "/settings/organization/developer", "create an API key");

  await expect.poll(() => targetText(page)).toContain("Create key");
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.target()?.tagName)).toBe("INPUT");

  const field = page.getByRole("textbox", { name: "Name" });
  await field.click();
  await page.waitForTimeout(600);
  expect(await phase(page)).toBe("waiting");
  expect(requests).toHaveLength(2);

  await field.pressSequentially("CI server");
  await expect.poll(() => targetText(page)).toBe("Create");
  expect(requests[2]!.event).toEqual({ type: "filled", id: expect.any(String), label: "Name" });
});

test("going back and forth between two fields the user already filled in is caught", async ({ page }) => {
  const requests = await scriptModel(page, (request, index) => {
    if (request.nudge) return [{ type: "text", text: "Your workspace is set to EU West." }, { type: "done" }];
    if (index % 2 === 0) return point(request, "Region", "Pick EU West.");
    return point(request, "Workspace name", "Then save your settings.");
  });
  await start(page, "/settings", "move my workspace to the EU");

  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.target()?.tagName)).toBe("SELECT");
  await page.getByRole("combobox", { name: "Region" }).selectOption("eu-west");
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.target()?.tagName)).toBe("INPUT");
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Acme EU");

  await expect.poll(() => phase(page)).toBe("done");
  expect(requests.map((request) => request.event?.type ?? request.kind)).toEqual(["ask", "filled", "filled", "filled"]);
  expect(requests[3]!.nudge).toEqual({ reason: "unchanged", label: 'select "Region"' });
});

test("partway through a guide, a point without <wait/> still waits for the click", async ({ page }) => {
  await scriptModel(page, (request, index) => {
    if (index === 0) return point(request, "Manage plan", "Click Manage plan.");
    return point(request, "Team", "Pick Team.").filter((event) => event.type !== "wait");
  });
  await start(page, "/billing", "change my plan");

  await expect.poll(() => targetText(page)).toBe("Manage plan");
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  await expect.poll(() => targetText(page)).toBe("Team");
  expect(await phase(page)).toBe("waiting");
});

test("clicking what a first answer pointed at carries on, so Haptic can confirm where the user ended up", async ({ page }) => {
  const requests = await scriptModel(page, (request, index) => {
    if (index === 0) return point(request, "Overview", "Click Overview to go home.").filter((event) => event.type !== "wait");
    return [{ type: "text", text: "You're on the home page." }, { type: "done" }];
  });
  await start(page, "/billing", "where is home");

  await expect.poll(() => phase(page)).toBe("answered");
  await page.locator('a[title="Overview"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => phase(page)).toBe("done");
  expect(requests[1]!.change?.path).toEqual({ from: "/billing", to: "/" });
});

test("doing something else after a first answer clears the pointer", async ({ page }) => {
  await scriptModel(page, (request) => point(request, "Overview", "Overview is the home page.").filter((event) => event.type !== "wait"));
  await start(page, "/billing", "where is home");

  await expect.poll(() => phase(page)).toBe("answered");
  await page.getByRole("button", { name: "Download" }).click();
  await expect.poll(() => phase(page)).toBe("idle");
  expect(await page.evaluate(() => window.Haptic?.debug.target() ?? null)).toBeNull();
});

test("an answer about a page the user already left is dropped, and the guide starts over from the new page", async ({ page }) => {
  const requests: TurnRequest[] = [];
  await scriptModel(page, (request, index) => {
    requests.push(request);
    if (index === 0) return point(request, "Manage plan", "Click Manage plan.");
    return [{ type: "text", text: "You're in Settings now." }, { type: "done" }];
  });
  // The first answer arrives only after the route has changed, like a slow page load.
  await page.route("**/api/v1/turn", async (route) => {
    if (route.request().method() === "POST" && requests.length === 0) {
      await page.evaluate(() => {
        history.pushState({}, "", "/settings");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.waitForTimeout(200);
    }
    await route.fallback();
  });
  await start(page, "/billing", "change my plan");

  await expect.poll(() => phase(page)).toBe("done");
  expect(requests).toHaveLength(2);
  expect(requests[1]!.event).toEqual({ type: "navigated", from: "/billing", to: "/settings" });
  expect(requests[1]!.snapshot.path).toBe("/settings");
});
