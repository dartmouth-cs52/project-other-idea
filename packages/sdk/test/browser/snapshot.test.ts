import { serializeSnapshot } from "@haptic/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createHost } from "../../src/host.ts";
import { takeSnapshot } from "../../src/snapshot/index.ts";

const ignore = document.createElement("div");

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const labels = () => takeSnapshot(ignore).snapshot.elements.map((e) => e.label || `[${e.icon ?? e.role}]`);

describe("snapshot labels", () => {
  it("names elements the way a person would", () => {
    mount(`
      <header>
        <a href="/settings" title="Settings"><svg class="lucide lucide-settings"></svg></a>
        <button><svg class="lucide lucide-share-2"></svg></button>
        <button aria-label="Close dialog">×</button>
        <button>T</button>
      </header>
      <main>
        <h2>API keys</h2>
        <label>Email <input type="email" value="alex@acme.dev"></label>
        <input placeholder="Search projects">
        <input type="submit" value="Save changes">
        <select aria-label="Region"><option>US East</option><option>EU West</option></select>
      </main>`);
    const { snapshot } = takeSnapshot(ignore);
    const text = serializeSnapshot(snapshot);
    expect(text).toContain('link "Settings" icon:settings [header] → /settings');
    expect(text).toContain("button icon:share-2 [header]");
    expect(text).toContain('button "Close dialog"');
    expect(text).toContain('button "T" short-text');
    expect(text).toContain('textbox "Email" [main › API keys]');
    expect(text).toContain('textbox "Search projects"');
    expect(text).toContain('button "Save changes"');
    expect(text).toContain("options:US East/EU West");
    // Typed values never leave the page.
    expect(text).not.toContain("alex@acme.dev");
  });

  it("skips hidden, ignored and aria-hidden content", () => {
    mount(`
      <button>Visible</button>
      <button style="display:none">Display none</button>
      <button style="visibility:hidden">Visibility hidden</button>
      <div hidden><button>In hidden</button></div>
      <div data-haptic-ignore><button>Ignored</button></div>
      <div aria-hidden="true"><button>Aria hidden</button></div>
      <details><summary>More</summary><button>Inside closed details</button></details>`);
    expect(labels()).toEqual(["Visible", "More"]);
  });

  it("finds clickable divs only where the pointer cursor starts", () => {
    mount(`
      <div style="cursor:pointer"><span>Open project</span><span>3 members</span></div>
      <div style="cursor:pointer"><button>Real button</button></div>`);
    expect(labels()).toEqual(["Open project 3 members", "Real button"]);
  });

  it("walks into open shadow roots and same-origin iframes", async () => {
    const root = mount(`<div id="host"></div><iframe srcdoc="<button>In frame</button>"></iframe>`);
    const host = root.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = "<button>In shadow</button>";
    const frame = root.querySelector("iframe")!;
    await new Promise((resolve) => (frame.contentDocument?.readyState === "complete" && frame.contentDocument.body.childElementCount ? resolve(null) : frame.addEventListener("load", resolve, { once: true })));
    expect(labels()).toEqual(["In shadow", "In frame"]);
  });

  it("only lists the open modal dialog", () => {
    const root = mount(`<button>Behind</button><dialog aria-label="Create API key"><button>Create</button></dialog>`);
    root.querySelector("dialog")!.showModal();
    const { snapshot } = takeSnapshot(ignore);
    expect(snapshot.dialog).toBe("Create API key");
    expect(snapshot.elements.map((e) => e.label)).toEqual(["Create"]);
  });

  it("marks elements outside the viewport", () => {
    mount(`<button>Top</button><div style="height:3000px"></div><button>Bottom</button>`);
    const { snapshot } = takeSnapshot(ignore);
    expect(snapshot.elements.map((e) => `${e.label}:${e.position}`)).toEqual(["Top:visible", "Bottom:below"]);
  });

  it("resolves ids back to the live element", () => {
    const root = mount(`<button>One</button><button>Two</button>`);
    const { registry } = takeSnapshot(ignore);
    expect(registry.resolve("e2")).toBe(root.querySelectorAll("button")[1]);
  });

  it("stays fast on a large page", () => {
    const rows = Array.from({ length: 300 }, (_, i) => `<tr><td>Row ${i}</td><td><button>Edit</button><a href="/r/${i}">Open</a></td></tr>`);
    mount(`<table>${rows.join("")}</table>`);
    const { ms, snapshot } = takeSnapshot(ignore);
    expect(snapshot.elements.length).toBe(400);
    expect(snapshot.truncated).toBe(true);
    expect(ms).toBeLessThan(150);
  });
});

describe("covered elements", () => {
  it("leaves out a button buried under another element", () => {
    // Like Flasht's Restart button sitting under the card stack.
    mount(`
      <div style="position:relative;width:300px;height:200px">
        <button style="position:absolute;left:20px;top:20px">Restart</button>
        <div style="position:absolute;inset:0;background:#fff">Card</div>
        <button style="position:absolute;right:10px;top:10px">Shuffle</button>
      </div>`);
    expect(labels()).toEqual(["Shuffle"]);
  });

  it("keeps a button that is only partly covered", () => {
    mount(`
      <div style="position:relative;width:300px;height:200px">
        <button style="position:absolute;left:0;top:0;width:120px;height:40px">Partly</button>
        <div style="position:absolute;left:0;top:0;width:70px;height:40px;background:#fff"></div>
      </div>`);
    expect(labels()).toEqual(["Partly"]);
  });

  it("leaves out the page behind a full-screen overlay but keeps the overlay's controls", () => {
    mount(`
      <button>Behind</button>
      <div style="position:fixed;inset:0;background:rgba(0,0,0,.2)">
        <div role="dialog"><button>View</button></div>
      </div>`);
    expect(labels()).toEqual(["View"]);
  });

  it("keeps a button hidden by a sticky header, since scrolling reveals it", () => {
    mount(`
      <header style="position:sticky;top:0;height:80px;background:#fff;z-index:1"><a href="/">Home</a></header>
      <div style="height:400px"></div>
      <button>Save</button>
      <div style="height:3000px"></div>`);
    const save = document.querySelector("button")!;
    window.scrollTo(0, save.getBoundingClientRect().top + window.scrollY - 20);
    expect(labels()).toContain("Save");
    window.scrollTo(0, 0);
  });

  it("keeps a button scrolled out of its own scroll container", () => {
    mount(`
      <div style="height:100px;overflow:auto">
        <div style="height:600px"></div>
        <button>Deep</button>
      </div>
      <div style="height:400px">Footer text</div>`);
    expect(labels()).toContain("Deep");
  });

  it("keeps a custom checkbox whose input sits under its styled box", () => {
    mount(`
      <label style="position:relative;display:inline-block">
        <input type="checkbox" style="position:absolute;left:0;top:0;margin:0">
        <span style="position:relative;display:inline-block;width:20px;height:20px;background:#333"></span> Remember me
      </label>`);
    expect(labels()).toContain("Remember me");
  });

  it("ignores Haptic's own UI on top of the page", () => {
    mount(`<button>Under our caption</button>`);
    const ours = document.createElement("div");
    ours.style.cssText = "position:fixed;inset:0";
    document.body.append(ours);
    expect(takeSnapshot(ours).snapshot.elements.map((e) => e.label)).toEqual(["Under our caption"]);
  });
});

describe("host isolation", () => {
  it("keeps the page's CSS out and our CSS in", () => {
    const style = document.createElement("style");
    style.textContent = "* { color: rgb(255, 0, 0) !important; font-size: 40px !important; } div { display: none !important; }";
    document.head.append(style);
    const host = createHost();
    const probe = document.createElement("div");
    probe.className = "probe";
    host.mount.append(probe);
    expect(getComputedStyle(probe).display).toBe("block");
    expect(getComputedStyle(probe).fontSize).not.toBe("40px");
    // Our host doesn't add elements to the snapshot.
    expect(takeSnapshot(host.el).snapshot.elements).toEqual([]);
    host.destroy();
    style.remove();
  });

  it("keeps key presses inside our UI away from the page", () => {
    const host = createHost();
    const input = document.createElement("input");
    host.mount.append(input);
    let pageSaw = 0;
    const listener = () => pageSaw++;
    document.addEventListener("keydown", listener);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    document.removeEventListener("keydown", listener);
    expect(pageSaw).toBe(0);
    host.destroy();
  });
});
