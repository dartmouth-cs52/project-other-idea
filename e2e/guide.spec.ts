import { expect, test, type Page } from "@playwright/test";
import type { SiteAppearance } from "@haptic/protocol";

async function useMockModel(page: Page) {
  await page.route("**/api/v1/turn", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-haptic-model": "mock" } }),
  );
}

async function useAppearance(page: Page, appearance: Partial<SiteAppearance>) {
  await page.route("**/api/v1/session", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { config: { appearance: SiteAppearance } };
    await route.fulfill({ response, json: { ...body, config: { ...body.config, appearance: { ...body.config.appearance, ...appearance } } } });
  });
  await page.reload();
  await expect(page.locator("haptic-root")).toBeAttached();
}

/** Click whatever Haptic is pointing at, the way a user would. */
async function followPointer(page: Page) {
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.phase()), { timeout: 10_000 }).toMatch(/waiting|done/);
  if ((await page.evaluate(() => window.Haptic?.debug.phase())) === "done") return false;
  await page.evaluate(() => (window.Haptic!.debug.target() as HTMLElement).click());
  return true;
}

test.beforeEach(async ({ page }) => {
  await useMockModel(page);
  await page.goto("/");
  await expect(page.locator("haptic-root")).toBeAttached();
});

test("walks a user to Create key across three routes and a modal", async ({ page }) => {
  const launcher = page.locator("haptic-root").getByRole("button", { name: "Ask" });
  await launcher.click();
  const input = page.locator("haptic-root").getByRole("textbox", { name: "Ask Haptic" });
  await input.fill("how do I create an API key");
  await input.press("Enter");

  const visited: string[] = [];
  for (let i = 0; i < 6 && (await followPointer(page)); i++) visited.push(new URL(page.url()).pathname);

  expect(visited).toEqual(["/settings", "/settings/organization", "/settings/organization/developer", "/settings/organization/developer"]);
  await expect(page.getByRole("dialog", { name: "Create API key" })).toBeVisible();
  await expect(page.locator("haptic-root").getByText("Done")).toBeVisible();
});

test("keeps going after a full page load", async ({ page }) => {
  await page.evaluate(() => window.Haptic!.ask("how do I create an API key"));
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.phase())).toBe("waiting");
  // A plain navigation instead of a client-side route change.
  await page.goto("/settings");
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.target()?.textContent?.trim())).toBe("Organization");
});

test("typing in the Ask bar doesn't trigger the page's own key handlers", async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { keys: number }).keys = 0;
    document.addEventListener("keydown", () => (window as unknown as { keys: number }).keys++);
  });
  await page.locator("haptic-root").getByRole("button", { name: "Ask" }).click();
  await page.locator("haptic-root").getByRole("textbox", { name: "Ask Haptic" }).pressSequentially("hello");
  expect(await page.evaluate(() => (window as unknown as { keys: number }).keys)).toBe(0);
});

test("the pointer never blocks clicks on the element it points at", async ({ page }) => {
  await page.evaluate(() => window.Haptic!.ask("how do I create an API key"));
  await expect.poll(() => page.evaluate(() => window.Haptic?.debug.phase())).toBe("waiting");
  // A real mouse click at the target's center, where the highlight sits.
  await page.locator('a[title="Settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("a visitor can shrink the launcher to a dot and bring it back", async ({ page }) => {
  const root = page.locator("haptic-root");
  const launcher = root.getByRole("button", { name: "Ask", exact: true });
  await launcher.hover();
  await root.getByRole("button", { name: "Hide Haptic button" }).click();
  await expect(launcher).toHaveCount(0);
  const dot = root.getByRole("button", { name: "Show Haptic" });
  await expect(dot).toBeVisible();

  // Remembered across page loads.
  await page.reload();
  await expect(root.getByRole("button", { name: "Show Haptic" })).toBeVisible();

  // Opening Haptic another way still works while it's a dot.
  await page.evaluate(() => window.Haptic!.open());
  const input = root.getByRole("textbox", { name: "Ask Haptic" });
  await expect(input).toBeVisible();
  await input.press("Escape");
  await expect(root.getByRole("button", { name: "Show Haptic" })).toBeVisible();

  await root.getByRole("button", { name: "Show Haptic" }).click();
  await expect(launcher).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("haptic.v1.launcher"))).toBeNull();
});

test("launcher and Ask bar placement can be configured independently", async ({ page }) => {
  await useAppearance(page, {
    position: "top-left",
    panelPosition: "bottom-center",
    launcherStyle: "icon",
    launcherLabel: "Guide me",
    edgeOffsetX: 36,
    edgeOffsetY: 44,
    panelWidth: 460,
  });

  const root = page.locator("haptic-root");
  const launcher = root.getByRole("button", { name: "Guide me" });
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox?.x).toBeCloseTo(36, 0);
  expect(launcherBox?.y).toBeCloseTo(44, 0);
  expect(launcherBox?.width).toBeCloseTo(40, 0);

  await launcher.click();
  const askBar = root.getByRole("search");
  const askBarBox = await askBar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(askBarBox?.width).toBeCloseTo(460, 0);
  expect((askBarBox?.x ?? 0) + (askBarBox?.width ?? 0) / 2).toBeCloseTo(viewport.width / 2, 0);
  expect((askBarBox?.y ?? 0) + (askBarBox?.height ?? 0)).toBeCloseTo(viewport.height - 44, 0);
});

test("a hidden launcher still supports a bottom-right custom trigger", async ({ page }) => {
  await useAppearance(page, { showLauncher: false, panelPosition: "bottom-right", edgeOffsetX: 32, edgeOffsetY: 72 });

  const root = page.locator("haptic-root");
  await expect(root.locator(".launcher")).toHaveCount(0);
  await page.evaluate(() => window.Haptic!.open());

  const askBarBox = await root.getByRole("search").boundingBox();
  const viewport = page.viewportSize()!;
  expect((askBarBox?.x ?? 0) + (askBarBox?.width ?? 0)).toBeCloseTo(viewport.width - 32, 0);
  expect((askBarBox?.y ?? 0) + (askBarBox?.height ?? 0)).toBeCloseTo(viewport.height - 72, 0);
});
