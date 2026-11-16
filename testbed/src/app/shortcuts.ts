import { useEffect } from "react";
import { useNavigate } from "react-router";
import { ALL_NAV_ITEMS } from "./nav";

// Single-key shortcuts, like many dashboards have. They ignore key presses in
// inputs on our own page, but a key typed into a widget inside a shadow root
// reaches here with the shadow host as its target. If the widget doesn't stop
// the event at its host, typing "c" in its ask box opens a new expense report.

export const SHORTCUTS = [
  { keys: "⌘ K", label: "Search and commands" },
  { keys: "/", label: "Search" },
  { keys: "?", label: "Show shortcuts" },
  { keys: "c", label: "New expense report" },
  ...ALL_NAV_ITEMS.filter((i) => i.key).map((i) => ({ keys: `g ${i.key}`, label: `Go to ${i.label}` })),
];

function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || !!target.closest("[role=dialog],dialog[open],[role=menu],[cmdk-root]");
}

export function useShortcuts({ openPalette, openHelp }: { openPalette: () => void; openHelp: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        openPalette();
      } else if (e.key === "?") openHelp();
      else if (e.key === "g") pendingG = Date.now();
      else if (pendingG && Date.now() - pendingG < 1200) {
        const item = ALL_NAV_ITEMS.find((i) => i.key === e.key);
        pendingG = 0;
        if (item) navigate(item.to);
      } else if (e.key === "c") navigate("/reimbursements/new");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openPalette, openHelp]);
}
