import assert from "node:assert/strict";
import { test } from "node:test";
import { signedInUrl, siteAt, SITES_HREF } from "../web/lib/dashboard.ts";

// Where sign-in lands, and which site the dashboard's address opens. The
// screens themselves are tested in a browser, in test/browser/dashboard.test.ts.

const SITE = { id: "site_a1b2c3d4e5f6" };
const OTHER = { id: "site_0f9e8d7c6b5a" };
const at = (query: string, sites = [SITE]) => siteAt(sites, new URLSearchParams(query))?.id;

test("sign-in lands on the list of sites, on the site's own address", () => {
  assert.equal(SITES_HREF, "/dashboard/?view=sites");
  assert.equal(signedInUrl("https://joinhaptic.com"), "https://joinhaptic.com/dashboard/?view=sites");
  assert.equal(signedInUrl("http://localhost:3000"), "http://localhost:3000/dashboard/?view=sites");
  assert.equal(at(new URL(signedInUrl("https://joinhaptic.com")).search), undefined, "which opens no site, even a company's only one");
});

test("a company's only site is not opened unless the address names it", () => {
  assert.equal(at(""), undefined, "the address with no site named is the list");
  assert.equal(at("view=sites"), undefined);
  assert.equal(at("view=questions"), undefined, "a page with no site named is the list too");
  assert.equal(at("guide=0b6f2c1e&days=7"), undefined);
  assert.equal(at("site=site_a1b2c3d4e5f6"), SITE.id);
  assert.equal(at("site=site_a1b2c3d4e5f6&view=gaps&guide=0b6f2c1e"), SITE.id);
});

test("with several sites, the address opens the one it names and no other", () => {
  const sites = [SITE, OTHER];
  assert.equal(at("", sites), undefined);
  assert.equal(at("site=site_0f9e8d7c6b5a", sites), OTHER.id);
  assert.equal(at("site=site_a1b2c3d4e5f6&later=1", sites), SITE.id);
  assert.equal(at("site=site_a1b2c3d4e5f6&view=sites", sites), undefined, "the list was asked for");
});

test("a site that isn't the company's opens nothing, and a company with no site has none to open", () => {
  assert.equal(at("site=site_ffffffffffff"), undefined);
  assert.equal(at("site=site_a1b2c3d4e5f6", []), undefined);
  assert.equal(at("", []), undefined);
});
