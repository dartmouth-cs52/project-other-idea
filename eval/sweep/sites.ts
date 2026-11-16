// The public sites the sweep puts Haptic's tag into. None of them is an app
// the benchmark's guides are tuned on or holds out (eval/guides): those are
// measured there, and the held-out ones must not shape anything.
//
// Each site is here to stand for something customers will bring. `kinds` says
// what, and `why` says why this site in particular.

export const KINDS = {
  "saas-demo": "a public SaaS demo, sandbox or test site",
  admin: "an admin dashboard",
  shop: "e-commerce",
  gov: "a government or public-service site",
  finance: "a bank's or insurer's public pages",
  docs: "a documentation site",
  news: "news and media",
  forms: "a page that is mostly a form",
  react: "a single-page app on React",
  angular: "a single-page app on Angular",
  vue: "a single-page app on Vue",
  svelte: "a single-page app on Svelte",
  "other-framework": "a single-page app on another framework (Ember)",
  "web-components": "built from web components, with shadow roots",
  frames: "with embedded frames",
  canvas: "drawn mostly on a canvas",
  large: "a very large page",
  "cookie-wall": "likely to show a cookie wall to a first-time visitor",
  language: "in a language other than English",
} as const;
export type SiteKind = keyof typeof KINDS;

export interface Site {
  id: string;
  url: string;
  kinds: SiteKind[];
  why: string;
}

export const SITES: Site[] = [
  // Public SaaS demos, sandboxes and test sites ------------------------------
  { id: "nopcommerce", url: "https://demo.nopcommerce.com/", kinds: ["saas-demo", "shop"], why: "nopCommerce's own store demo: an ASP.NET shop of the kind mid-size retailers run, with category menus, filters and a cart." },
  { id: "opencart", url: "https://demo.opencart.com/", kinds: ["saas-demo", "shop"], why: "OpenCart's demo store: PHP with jQuery and Bootstrap dropdowns, the older stack many small shops still run." },
  { id: "prestashop", url: "https://demo.prestashop.com/", kinds: ["saas-demo", "shop", "frames"], why: "PrestaShop's demo shows the whole shop inside an iframe under a demo bar, so it stands for an app the widget sees only the frame of." },
  { id: "vercel-commerce", url: "https://nextjs-commerce.vercel.app/", kinds: ["saas-demo", "shop", "react"], why: "Vercel's Next.js Commerce demo: React Server Components hydrating the whole document, which is where an element added to the page can upset hydration." },
  { id: "swagger-petstore", url: "https://petstore.swagger.io/", kinds: ["saas-demo", "docs", "react", "forms"], why: "Swagger UI, embedded in countless API products: every operation is an accordion that opens into a form." },
  { id: "home-assistant", url: "https://demo.home-assistant.io/", kinds: ["saas-demo", "admin", "web-components"], why: "Home Assistant's public demo: a dashboard built from Lit web components nested many shadow roots deep." },
  { id: "plausible", url: "https://plausible.io/plausible.io", kinds: ["saas-demo", "admin", "react"], why: "Plausible's own analytics shown publicly: a React dashboard with tabs over tables and a chart, the shape of most analytics SaaS." },
  { id: "trello", url: "https://trello.com/b/nC8QJJoZ/trello-development-roadmap", kinds: ["saas-demo", "react"], why: "A public Trello board: a kanban SaaS app a signed-out visitor can open, with cards, lists and menus." },
  { id: "the-internet-shadow", url: "https://the-internet.herokuapp.com/shadowdom", kinds: ["saas-demo", "web-components"], why: "A test site's page built from custom elements with open shadow roots and slotted text, small enough to read by hand." },
  { id: "the-internet-iframe", url: "https://the-internet.herokuapp.com/iframe", kinds: ["saas-demo", "frames", "forms"], why: "A TinyMCE rich-text editor in an iframe, the way many enterprise apps embed an editor." },
  { id: "demoqa-form", url: "https://demoqa.com/automation-practice-form", kinds: ["saas-demo", "forms", "react"], why: "A practice form in React with a date picker, a react-select autocomplete, radio buttons drawn over hidden inputs, and ads in frames." },
  { id: "github-repo", url: "https://github.com/microsoft/vscode", kinds: ["saas-demo", "web-components", "react"], why: "A public GitHub repository page: a large SaaS app mixing server-rendered HTML, web components and React islands." },
  { id: "discourse", url: "https://meta.discourse.org/", kinds: ["saas-demo", "other-framework"], why: "Discourse's own forum: an Ember single-page app, a framework none of the other sites use." },
  { id: "confluence", url: "https://cwiki.apache.org/confluence/display/KAFKA/Index", kinds: ["saas-demo", "docs"], why: "A public Confluence wiki: Atlassian's enterprise wiki, with its page tree and space menus." },

  // Admin dashboards ---------------------------------------------------------
  { id: "adminlte", url: "https://adminlte.io/themes/v3/", kinds: ["admin"], why: "AdminLTE, the most used free admin template: Bootstrap and jQuery, a tree menu in the sidebar, cards that collapse, charts on canvas." },
  { id: "tabler", url: "https://preview.tabler.io/", kinds: ["admin"], why: "Tabler's dashboard preview: Bootstrap 5 dropdown menus, data tables and charts, as in many internal tools." },
  { id: "material-dashboard", url: "https://demos.creative-tim.com/material-dashboard-react/#/dashboard", kinds: ["admin", "react"], why: "Creative Tim's Material Dashboard React: an MUI admin template with hash routing, a common starting point for internal apps." },
  { id: "coreui", url: "https://coreui.io/demos/react/latest/free/#/dashboard", kinds: ["admin", "react"], why: "CoreUI's React admin demo, with a sidebar of collapsible groups and a header of dropdowns." },
  { id: "vuestic", url: "https://admin-demo.vuestic.dev/", kinds: ["admin", "vue"], why: "Vuestic Admin, a Vue 3 dashboard demo, for admin consoles built on Vue." },
  { id: "ngx-admin", url: "https://demo.akveo.com/ngx-admin/", kinds: ["admin", "angular"], why: "ngx-admin, an Angular dashboard on Nebular, for admin consoles built on Angular." },

  // Canvas-heavy apps --------------------------------------------------------
  { id: "excalidraw", url: "https://excalidraw.com/", kinds: ["canvas", "react"], why: "A whiteboard drawn on a canvas, with a React toolbar around it: the widget can read the toolbar and never the drawing." },
  { id: "tldraw", url: "https://www.tldraw.com/", kinds: ["canvas", "react"], why: "Another whiteboard, whose shapes are drawn in the DOM over a canvas, to see whether that difference shows." },
  { id: "photopea", url: "https://www.photopea.com/", kinds: ["canvas"], why: "A Photoshop-like editor drawn largely on canvases, with its own menus in the DOM." },
  { id: "desmos", url: "https://www.desmos.com/calculator", kinds: ["canvas"], why: "A graphing calculator: the graph is a canvas, the expression list is editable math fields." },
  { id: "jspaint", url: "https://jspaint.app/", kinds: ["canvas"], why: "A paint program with a classic menu bar and tool palette around one canvas." },
  { id: "drawio", url: "https://app.diagrams.net/", kinds: ["canvas", "forms"], why: "diagrams.net opens on a dialog that asks where to save, over an SVG editor: a modal on load, then a drawing surface." },
  { id: "openstreetmap", url: "https://www.openstreetmap.org/", kinds: ["canvas"], why: "A map app: the map is tiles and a canvas layer, with a search form and side panels." },

  // Embedded frames ----------------------------------------------------------
  { id: "jsfiddle", url: "https://jsfiddle.net/", kinds: ["frames"], why: "A code playground: editors and a result pane in an iframe, and a sandboxed preview on another origin." },
  { id: "jqueryui-tabs", url: "https://jqueryui.com/tabs/", kinds: ["frames", "docs"], why: "jQuery UI, still under many enterprise apps; its demos sit in iframes on the documentation page." },
  { id: "w3schools-tryit", url: "https://www.w3schools.com/html/tryit.asp?filename=tryhtml_basic", kinds: ["frames"], why: "An editor beside a same-origin result iframe, with ads in frames from other origins." },
  { id: "stripe-checkout", url: "https://checkout.stripe.dev/", kinds: ["frames", "finance", "forms"], why: "Stripe's public checkout preview: card fields live in cross-origin iframes, as on any page that takes payments." },

  // E-commerce ---------------------------------------------------------------
  { id: "ikea", url: "https://www.ikea.com/us/en/", kinds: ["shop", "cookie-wall"], why: "A very large retailer's store front, with mega menus and a consent banner." },
  { id: "zalando", url: "https://www.zalando.de/", kinds: ["shop", "cookie-wall", "language"], why: "A German fashion store that shows a consent wall to every first visit." },
  { id: "amazon", url: "https://www.amazon.com/", kinds: ["shop", "large"], why: "The largest store front there is: a dense, very long page." },
  { id: "ebay", url: "https://www.ebay.com/", kinds: ["shop", "large"], why: "A marketplace home page with a category menu, a search form and long carousels." },
  { id: "etsy", url: "https://www.etsy.com/", kinds: ["shop"], why: "A marketplace built with React islands over server-rendered pages." },
  { id: "allbirds", url: "https://www.allbirds.com/", kinds: ["shop"], why: "A Shopify store, the platform behind most small and mid-size online shops." },
  { id: "apple-store", url: "https://www.apple.com/shop/buy-iphone", kinds: ["shop", "large"], why: "Apple's online store: a large product page with a configurator of tabs and choices." },
  { id: "rakuten", url: "https://www.rakuten.co.jp/", kinds: ["shop", "large", "language"], why: "A Japanese marketplace: a very dense page in Japanese." },
  { id: "mercadolibre", url: "https://www.mercadolibre.com.mx/", kinds: ["shop", "language"], why: "Latin America's largest marketplace, in Spanish." },
  { id: "bol", url: "https://www.bol.com/nl/nl/", kinds: ["shop", "cookie-wall", "language"], why: "A Dutch store that puts a consent wall in front of every first visit." },
  { id: "walmart", url: "https://www.walmart.com/", kinds: ["shop"], why: "A very large US retailer, known to challenge automated browsers." },
  { id: "booking", url: "https://www.booking.com/", kinds: ["shop", "forms", "cookie-wall"], why: "Travel booking: a search form of autocomplete, date range picker and guest counter." },
  { id: "airbnb", url: "https://www.airbnb.com/", kinds: ["shop", "forms", "react"], why: "A React app whose search bar opens panels for place, dates and guests." },

  // Government and public service -------------------------------------------
  { id: "govuk-drive", url: "https://www.gov.uk/learn-to-drive-a-car", kinds: ["gov"], why: "A GOV.UK step-by-step page: the GOV.UK Design System's accordion, plain progressive HTML." },
  { id: "usa-gov", url: "https://www.usa.gov/", kinds: ["gov"], why: "The US federal portal, on the US Web Design System." },
  { id: "irs", url: "https://www.irs.gov/", kinds: ["gov"], why: "The IRS: a Drupal site with mega menus, the stack of many government sites." },
  { id: "ssa", url: "https://www.ssa.gov/", kinds: ["gov"], why: "Social Security's public pages: a public service many people need a guide for." },
  { id: "healthcare-gov", url: "https://www.healthcare.gov/see-plans/", kinds: ["gov", "forms", "react"], why: "The plan finder: a React form with a ZIP code, household questions and income fields." },
  { id: "europa", url: "https://european-union.europa.eu/index_en", kinds: ["gov", "cookie-wall"], why: "The EU portal, on the Europa Component Library, with its cookie banner and language list." },
  { id: "service-public", url: "https://www.service-public.fr/", kinds: ["gov", "language"], why: "France's public-service portal, in French, on the French state's design system (DSFR)." },
  { id: "bund", url: "https://www.bund.de/", kinds: ["gov", "language"], why: "Germany's federal portal, in German." },
  { id: "canada", url: "https://www.canada.ca/en.html", kinds: ["gov"], why: "Canada's site on the Web Experience Toolkit, bilingual, with a menu that opens over the page." },
  { id: "gov-br", url: "https://www.gov.br/pt-br", kinds: ["gov", "language"], why: "Brazil's federal portal, in Portuguese." },
  { id: "nhs-conditions", url: "https://www.nhs.uk/conditions/", kinds: ["gov", "large"], why: "The NHS A to Z of conditions: a very long page of links, on the NHS design system." },
  { id: "usps-zip", url: "https://tools.usps.com/zip-code-lookup.htm", kinds: ["gov", "forms"], why: "A public-service lookup tool: a form behind a choice of three ways to search." },
  { id: "data-gov", url: "https://catalog.data.gov/dataset", kinds: ["gov", "large"], why: "A data catalogue: a long list of results with facets down the side." },

  // Banks' and insurers' public pages ---------------------------------------
  { id: "chase", url: "https://www.chase.com/", kinds: ["finance"], why: "A large US bank's home page, with a sign-in box on the page (never typed into)." },
  { id: "bofa", url: "https://www.bankofamerica.com/", kinds: ["finance"], why: "A large US bank's home page, with its own sign-in form and menus." },
  { id: "wellsfargo", url: "https://www.wellsfargo.com/", kinds: ["finance"], why: "A large US bank's home page, with tabs and a sign-on box." },
  { id: "hsbc-uk", url: "https://www.hsbc.co.uk/", kinds: ["finance", "cookie-wall"], why: "A UK bank's public site, with a cookie notice and mega menus." },
  { id: "ing-nl", url: "https://www.ing.nl/particulier", kinds: ["finance", "language", "web-components"], why: "A Dutch bank whose site is built from its own web components (Lion), in Dutch." },
  { id: "deutsche-bank", url: "https://www.deutsche-bank.de/pk.html", kinds: ["finance", "language", "cookie-wall"], why: "A German bank on Adobe Experience Manager, in German, with a consent dialog." },
  { id: "allianz", url: "https://www.allianz.de/", kinds: ["finance", "language", "cookie-wall"], why: "A German insurer's site, in German, with a consent dialog." },
  { id: "axa", url: "https://www.axa.fr/", kinds: ["finance", "language"], why: "A French insurer's site, in French." },
  { id: "geico", url: "https://www.geico.com/", kinds: ["finance", "forms"], why: "A US insurer whose home page is a quote form with a product picker." },
  { id: "lemonade", url: "https://www.lemonade.com/", kinds: ["finance", "react"], why: "An insurer built as a modern web app." },
  { id: "revolut", url: "https://www.revolut.com/", kinds: ["finance", "react"], why: "A fintech's public site, on Next.js." },
  { id: "stripe", url: "https://stripe.com/", kinds: ["finance"], why: "Stripe's site, whose top menus open on hover, as many marketing sites' do." },

  // Documentation ------------------------------------------------------------
  { id: "mdn", url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements", kinds: ["docs", "large"], why: "MDN's list of HTML elements: a long reference page with a sidebar tree." },
  { id: "python-docs", url: "https://docs.python.org/3/library/stdtypes.html", kinds: ["docs", "large"], why: "A very large Sphinx page, with hundreds of in-page links." },
  { id: "html-spec", url: "https://html.spec.whatwg.org/multipage/forms.html", kinds: ["docs", "large"], why: "One of the largest pages anyone opens: thousands of links and definitions." },
  { id: "ms-learn", url: "https://learn.microsoft.com/en-us/azure/", kinds: ["docs"], why: "Microsoft Learn: documentation for enterprise products, with its own menus and filters." },
  { id: "github-docs", url: "https://docs.github.com/en/get-started", kinds: ["docs", "react"], why: "GitHub's docs, on Next.js and Primer React." },
  { id: "kubernetes", url: "https://kubernetes.io/docs/concepts/overview/", kinds: ["docs"], why: "A Hugo docs site with a long side menu." },
  { id: "stripe-docs", url: "https://docs.stripe.com/payments", kinds: ["docs", "finance"], why: "Stripe's docs, with code tabs and a language switcher." },
  { id: "bootstrap", url: "https://getbootstrap.com/docs/5.3/components/accordion/", kinds: ["docs"], why: "Bootstrap's accordion and collapse, under a great many enterprise apps." },
  { id: "angular-material", url: "https://material.angular.io/components/tabs/overview", kinds: ["docs", "angular"], why: "Angular Material's tabs, the toolkit of many Angular enterprise apps, which the toolkit suite does not cover." },
  { id: "vuetify", url: "https://vuetifyjs.com/en/components/tabs/", kinds: ["docs", "vue"], why: "Vuetify, the most used Vue component toolkit." },
  { id: "element-plus", url: "https://element-plus.org/en-US/component/tabs.html", kinds: ["docs", "vue"], why: "Element Plus, a Vue toolkit that many enterprise apps in China are built on." },
  { id: "primeng", url: "https://primeng.org/tabs", kinds: ["docs", "angular"], why: "PrimeNG, a widely used Angular toolkit for enterprise apps." },
  { id: "shoelace", url: "https://shoelace.style/components/tab-group", kinds: ["docs", "web-components"], why: "Shoelace: web components with open shadow roots and slots, framework-free." },
  { id: "material-web", url: "https://material-web.dev/components/tabs/", kinds: ["docs", "web-components"], why: "Google's Material web components, built with Lit." },
  { id: "spectrum-wc", url: "https://opensource.adobe.com/spectrum-web-components/components/tabs/", kinds: ["docs", "web-components"], why: "Adobe's Spectrum web components, the toolkit behind Adobe's own web apps." },
  { id: "vaadin", url: "https://vaadin.com/docs/latest/components/tabs", kinds: ["docs", "web-components"], why: "Vaadin's web components, which enterprise Java apps are built from." },
  { id: "ionic", url: "https://ionicframework.com/docs/api/segment", kinds: ["docs", "web-components", "frames"], why: "Ionic's docs, whose live demos are in iframes, for Ionic's web components." },
  { id: "react-dev", url: "https://react.dev/learn", kinds: ["docs", "react"], why: "React's own docs, on Next.js." },
  { id: "angular-dev", url: "https://angular.dev/overview", kinds: ["docs", "angular"], why: "Angular's own docs, an Angular app." },
  { id: "vuejs", url: "https://vuejs.org/guide/introduction.html", kinds: ["docs", "vue"], why: "Vue's own docs, on VitePress, with a switch between two APIs." },
  { id: "svelte-docs", url: "https://svelte.dev/docs/svelte/overview", kinds: ["docs", "svelte"], why: "Svelte's own docs, a SvelteKit app." },

  // News and media -----------------------------------------------------------
  { id: "bbc-news", url: "https://www.bbc.com/news", kinds: ["news", "large"], why: "A news front page: long, dense, with a consent banner in some countries." },
  { id: "guardian", url: "https://www.theguardian.com/international", kinds: ["news", "cookie-wall"], why: "A news site whose consent message, where shown, is in a cross-origin iframe." },
  { id: "lemonde", url: "https://www.lemonde.fr/", kinds: ["news", "language", "cookie-wall"], why: "A French newspaper with a consent wall." },
  { id: "spiegel", url: "https://www.spiegel.de/", kinds: ["news", "language", "cookie-wall"], why: "A German news site that shows a consent wall to every first visit." },
  { id: "elpais", url: "https://elpais.com/", kinds: ["news", "language"], why: "A Spanish newspaper." },
  { id: "nhk", url: "https://www3.nhk.or.jp/news/", kinds: ["news", "language"], why: "Japan's public broadcaster's news, in Japanese." },
  { id: "aljazeera", url: "https://www.aljazeera.net/", kinds: ["news", "language"], why: "Arabic news, laid out right to left, which moves where the launcher and captions go." },
  { id: "naver", url: "https://www.naver.com/", kinds: ["news", "language", "large"], why: "Korea's largest portal: a very dense page in Korean." },
  { id: "hacker-news", url: "https://news.ycombinator.com/", kinds: ["news", "large"], why: "A dense table of hundreds of plain links, many with the same words." },
  { id: "youtube", url: "https://www.youtube.com/", kinds: ["news", "web-components"], why: "YouTube, built from Polymer custom elements." },
  { id: "reddit", url: "https://www.reddit.com/r/programming/", kinds: ["news", "web-components"], why: "Reddit's pages are built from its own web components with shadow roots." },
  { id: "apple-music", url: "https://music.apple.com/us/new", kinds: ["news", "svelte"], why: "Apple Music on the web, a Svelte app." },

  // Single-page apps, by framework ------------------------------------------
  { id: "todomvc-react", url: "https://todomvc.com/examples/react/dist/", kinds: ["react", "forms"], why: "The same small app in React, to compare frameworks on equal terms." },
  { id: "todomvc-angular", url: "https://todomvc.com/examples/angular/dist/browser/", kinds: ["angular", "forms"], why: "The same app in Angular." },
  { id: "todomvc-vue", url: "https://todomvc.com/examples/vue/dist/", kinds: ["vue", "forms"], why: "The same app in Vue." },
  { id: "todomvc-svelte", url: "https://todomvc.com/examples/svelte/dist/", kinds: ["svelte", "forms"], why: "The same app in Svelte." },
  { id: "todomvc-wc", url: "https://todomvc.com/examples/web-components/dist/", kinds: ["web-components", "forms"], why: "The same app built from plain web components with shadow roots." },
];

/** The sites a `--sites` argument names: ids, kinds, or both, separated by commas. All of them when it is empty. */
export function pickSites(arg: string | undefined): Site[] {
  if (!arg || arg === "all") return SITES;
  const wanted = arg.split(",").map((part) => part.trim()).filter(Boolean);
  const unknown = wanted.filter((word) => !SITES.some((site) => site.id === word) && !(word in KINDS));
  if (unknown.length) throw new Error(`No site or kind is called ${unknown.join(", ")}. Kinds: ${Object.keys(KINDS).join(", ")}.`);
  return SITES.filter((site) => wanted.includes(site.id) || site.kinds.some((kind) => wanted.includes(kind)));
}
