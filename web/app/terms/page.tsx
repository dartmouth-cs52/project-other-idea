import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", alternates: { canonical: "/terms/" } };

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="November 12, 2026">
      <p>
        These terms cover this website and early access to Haptic, which is made by {site.company}. By using either, you
        agree to them.
      </p>

      <h2>Early access</h2>
      <p>
        Haptic is an early product. Features can change or be removed, and the service can be unavailable at times. We
        may end early access, and we will tell you first where we can.
      </p>

      <h2>Using Haptic</h2>
      <p>
        Add Haptic only to products you run or have permission to change. Do not use it to break the law, to harm
        others, or to get around the limits we set on the service.
      </p>

      <h2>Your content</h2>
      <p>
        Your site, your help docs and your notes stay yours. You let us use them only to set up and run Haptic for you.
      </p>

      <h2>No warranty</h2>
      <p>
        Haptic is provided as is, without warranties of any kind. Haptic points and suggests, and the people using your
        product decide what to click. To the extent the law allows, we are not liable for losses that come from using
        it.
      </p>

      <h2>Contact</h2>
      <p>
        Write to <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
