import type { RouteObject } from "react-router";
import { OnboardingPage, SignInPage } from "./AuthPages";

// Pages outside the app shell, at absolute paths.
export const publicRoutes: RouteObject[] = [
  { path: "/signin", element: <SignInPage /> },
  { path: "/onboarding", element: <OnboardingPage /> },
];
