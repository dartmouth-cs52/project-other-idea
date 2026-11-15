// How to add the script tag on each kind of stack. Shown on the dashboard and
// on the install page a company sends to its developer.

export interface InstallOption {
  id: string;
  label: string;
  /** Where the code goes, in one or two sentences. */
  where: string;
  /** The code to copy, if there is any beyond the tag itself. */
  code?: string;
  language?: string;
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
      language: "html",
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
      language: "tsx",
    },
    {
      id: "react",
      label: "React",
      where: "For an app built with Vite or Create React App, paste the tag into index.html, just before </body>. It loads once and follows people from page to page.",
      code: tag,
      language: "html",
    },
    {
      id: "gtm",
      label: "Google Tag Manager",
      where: "If your site already loads Google Tag Manager, you can add Haptic without touching the code.",
      code: tag,
      language: "html",
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
      language: "html",
      notes: [
        "Webflow: Site settings, Custom code, Footer code. Then publish the site.",
        "WordPress: a code snippets plugin such as WPCode, set to the site-wide footer, or your theme's footer.php just before </body>.",
        "Squarespace: Settings, Advanced, Code injection, Footer. Code injection needs a paid plan.",
        "Wix: Settings, Custom code, Add custom code, placed at Body end on all pages. This needs a premium plan and a connected domain.",
        "Shopify: Online Store, Themes, Edit code, theme.liquid, just before </body>.",
      ],
    },
  ];
}

/** For a site with a Content Security Policy, the two sources to add. */
export function securityPolicyLines(scriptUrl: string): string[] {
  const origin = new URL(scriptUrl).origin;
  return [`script-src ${origin}`, `connect-src ${origin}`];
}

/** A prompt for an AI coding agent, which is how many developers will do this now. */
export function agentPrompt(scriptUrl: string, siteId: string): string {
  return `Add the Haptic widget to this app. It is one script tag that must load on every page, including pages behind the login:

${scriptTag(scriptUrl, siteId)}

Put it in the single layout or template every page shares, just before </body>, or the framework's equivalent (for Next.js, next/script with strategy="afterInteractive" in the root layout). Keep the data-site attribute exactly as it is. If the app sends a Content Security Policy, allow ${new URL(scriptUrl).origin} in script-src and connect-src. Do not change anything else.`;
}
