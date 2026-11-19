import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { router } from "@/app/router";
import { applyLabParams, lab, trustedWidgetSrc, useLab } from "@/lab/lab";
import { LabPanel } from "@/lab/LabPanel";
import { TooltipProvider } from "@/ui/button";
import "./styles.css";

applyLabParams(location.search);

function useTheme() {
  const theme = useLab((s) => s.theme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function App() {
  useTheme();
  const theme = useLab((s) => s.theme);
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-center" theme={theme} richColors closeButton />
      <LabPanel />
    </TooltipProvider>
  );
}

// Haptic goes in the way a customer would add it: one script tag, and only from an address lab.ts trusts.
const { widget, widgetSrc, widgetSite } = lab();
if (widget && widgetSrc && widgetSite && trustedWidgetSrc(widgetSrc)) {
  const tag = document.createElement("script");
  tag.src = widgetSrc;
  tag.async = true;
  tag.dataset.site = widgetSite;
  document.body.appendChild(tag);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
