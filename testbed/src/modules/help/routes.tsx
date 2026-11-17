import type { RouteObject } from "react-router";
import { ArticlePage, ContactPage, HelpHome, WhatsNewPage } from "./HelpPages";

// The sidebar opens /help with a full page load. Static paths rank above :slug.
export const routes: RouteObject[] = [
  { path: "help", element: <HelpHome /> },
  { path: "help/whats-new", element: <WhatsNewPage /> },
  { path: "help/contact", element: <ContactPage /> },
  { path: "help/:slug", element: <ArticlePage /> },
];
