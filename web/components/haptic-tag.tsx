import Script from "next/script";
import { hapticSiteId, widgetScriptUrl } from "@/lib/site";

/**
 * Haptic itself, so people can try it on this site. It is the tag our install
 * steps give a Next.js customer. The footer draws it, so it is on every public
 * page and not on the dashboard or the approve page, which have no footer.
 * Once loaded it stays in the page, so those two are always left with a full
 * page load (leaveFor in components/app/parts.tsx), and Back cannot bring it
 * to them.
 */
export function HapticTag() {
  if (!hapticSiteId) return null;
  return <Script src={widgetScriptUrl} data-site={hapticSiteId} strategy="afterInteractive" />;
}
