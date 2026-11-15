import { createContext, useContext } from "react";

// A native modal <dialog> makes everything outside it inert, portals included.
// Popups opened from inside one render into the dialog instead of <body>.
export const PortalContainer = createContext<HTMLElement | null>(null);
export const usePortalContainer = () => useContext(PortalContainer) ?? undefined;
