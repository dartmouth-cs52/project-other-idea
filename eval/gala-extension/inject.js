// Written by eval/gala.ts from eval/gala-sites.json. Change the list there, not here.
// Adds the Haptic tag to the page, as a customer's own tag would. These sites have not installed
// Haptic, so rules.json also takes their Content Security Policy off, or the script would be refused.
const HOST = "http://localhost:4000";
const SITES = {
  "github.com": "site_github",
  "en.wikipedia.org": "site_wikipedia",
  "home.dartmouth.edu": "site_dartmouth",
  "www.airbnb.com": "site_airbnb"
};

const site = SITES[location.hostname];
if (site && window.top === window && !document.querySelector("script[data-haptic-live]")) {
  const script = document.createElement("script");
  script.src = HOST + "/widget.js";
  script.dataset.site = site;
  script.dataset.hapticLive = "";
  document.body.appendChild(script);
}
