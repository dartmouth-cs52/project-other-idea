// How to add the script tag on each kind of stack. Shown on the dashboard and
// on the install page a company sends to its developer.

export interface InstallOption {
  id: string;
  label: string;
  /** Where the code goes, in one or two sentences. */
  where: string;
  /** The code to copy, if there is any beyond the tag itself. */
  code?: string;
  /** Extra steps or caveats, one per line. */
  notes?: string[];
}

export function scriptTag(scriptUrl: string, siteId: string): string {
  return `<script src="${scriptUrl}" data-site="${siteId}" async></script>`;
}

export function installOptions(scriptUrl: string, siteId: string): InstallOption[] {
  const tag = scriptTag(scriptUrl, siteId);
  return [
    {
      id: "html",
      label: "Script tag",
      where: "Paste this just before </body> on every page, usually in the one layout or template every page shares.",
      code: tag,
    },
    {
      id: "next",
      label: "Next.js",
      where: "Add it to the root layout, app/layout.tsx, inside <body>. With the Pages Router, put it in pages/_app.tsx instead.",
      code: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="${scriptUrl}" data-site="${siteId}" strategy="afterInteractive" />
      </body>
    </html>
  );
}`,
    },
    {
      id: "react",
      label: "React",
      where: "For an app built with Vite or Create React App, paste the tag into index.html, just before </body>. It loads once and follows people from page to page.",
      code: tag,
    },
    {
      id: "gtm",
      label: "Google Tag Manager",
      where: "If your site already loads Google Tag Manager, you can add Haptic without touching the code.",
      code: tag,
      notes: [
        "In your container, choose Tags, then New, then Custom HTML.",
        "Paste the tag above into the HTML box.",
        "Set the trigger to All Pages, save, and press Submit to publish.",
      ],
    },
    {
      id: "builders",
      label: "Website builders",
      where: "Every builder below has a place for code that goes at the end of every page. Paste the tag there.",
      code: tag,
      notes: [
        "In Webflow, open Site settings, Custom code, Footer code. Then publish the site.",
        "In WordPress, use a code snippets plugin such as WPCode, set to the site wide footer, or your theme's footer.php just before </body>.",
        "In Squarespace, open Settings, Advanced, Code injection, Footer. Code injection needs a paid plan.",
        "In Wix, open Settings, Custom code, Add custom code, placed at Body end on all pages. This needs a premium plan and a connected domain.",
        "In Shopify, open Online Store, Themes, Edit code, theme.liquid, and paste it just before </body>.",
      ],
    },
  ];
}

/** For a site with a Content Security Policy, the two sources to add. */
export function securityPolicyLines(scriptUrl: string): string[] {
  const origin = new URL(scriptUrl).origin;
  return [`script-src ${origin}`, `connect-src ${origin}`];
}

/** Where the install steps for a coding agent are served, by the site's Worker (worker/playbook.ts). */
export function playbookUrl(siteOrigin: string, siteId: string): string {
  return `${siteOrigin.replace(/\/$/, "")}/install/${siteId}.md`;
}

/**
 * What the "Onboard your agent" pill copies: one short line that points the
 * agent at the full steps, the way Vercel's does. Short enough for every deep
 * link's limit, and the steps can change without changing the button.
 */
export function agentPrompt(siteOrigin: string, siteId: string): string {
  return `Add Haptic to this app. Fetch ${playbookUrl(siteOrigin, siteId)} and follow it.`;
}

/**
 * The steps a coding agent follows to add the tag, served at /install/<site>.md.
 * It names the site's id, which is public anyway because it is in the tag, and
 * nothing else about the site: not its address, its name or its company.
 */
export function installPlaybook(scriptUrl: string, siteId: string): string {
  const tag = scriptTag(scriptUrl, siteId);
  const widget = new URL(scriptUrl).origin;
  return `# Add Haptic to this app

You are adding Haptic, an in-app guide, to the web app in this project. Haptic is one script tag. Do only what this file says, then report back to the person you are working for.

The tag, exactly as it must appear:

\`\`\`html
${tag}
\`\`\`

## 1. Find the framework

Look at package.json, the project's config files and its folders, and pick the first that fits.

- **Next.js, App Router** (app/layout.tsx, .jsx or .js): use next/script in the root layout, inside <body>, after {children}. Use strategy="afterInteractive".

  \`\`\`tsx
  import Script from "next/script";

  // inside <body>, after {children}
  <Script src="${scriptUrl}" data-site="${siteId}" strategy="afterInteractive" />
  \`\`\`

- **Next.js, Pages Router** (pages/_app.tsx or .jsx): add the same <Script> with strategy="afterInteractive" to pages/_app, next to <Component {...pageProps} />.
- **Vite, Create React App or any app with one index.html**: paste the tag into index.html, just before </body>.
- **Remix or React Router**: app/root.tsx, inside <body>, before <Scripts />.
- **Nuxt, SvelteKit, Astro, Angular**: the root layout or app shell every page uses, or app.html, index.html or the framework's head config for third-party scripts.
- **Server-rendered templates** (Rails, Django, Laravel, PHP, Jinja and the like): the base layout every page extends, just before </body>.

## 2. Add the tag

- It must load on every page, including the pages behind the login. Put it in the one shared layout, once. Never add it to single pages, and never twice.
- Keep data-site="${siteId}" exactly as it is, and the src exactly as it is.
- Keep it loading without blocking the page: async on a plain tag, strategy="afterInteractive" with next/script.

## 3. Content Security Policy

If the app sends a Content Security Policy (a Content-Security-Policy header or meta tag, often set in next.config, middleware, helmet, nginx or the server's config), add this origin to two directives and change nothing else in it:

\`\`\`
script-src ${widget}
connect-src ${widget}
\`\`\`

If the app has no policy, skip this step.

## 4. Change nothing else

Do not install a package, add environment variables, change other files, or reformat anything. The tag, and the policy if there is one, are the whole change.

## 5. Check that it works

Run the app (or use the dev server that is already running), open any page in a browser, and check the console and the page:

- Working: an element named haptic-root appears at the end of <body>, and inside its shadow root a round launcher button shows in the bottom corner of the page.
- Working, but hidden on this address: the console says "[Haptic] <address> isn't an allowed origin for this site." The tag is right. Haptic only shows on the addresses its owner allows, and a development or staging address, such as localhost, stays hidden until it is allowed in the Haptic dashboard, where it now shows with an Allow button. Tell the person you are working for.
- Wrong id: the console says "No site with that id". Check data-site against the tag above.
- Nothing at all: the script did not load. Check that the tag is in the page's HTML, and the policy if there is one.

If you cannot open a browser, fetch a page from the running app and check that its HTML contains data-site="${siteId}".

## 6. Report

End with this, filled in:

\`\`\`
Haptic install
- Changed: <file>
- Content Security Policy: <updated in file, or none found>
- Check: <launcher showed, or hidden on <address> until it is allowed, or could not run the app>
\`\`\`
`;
}
