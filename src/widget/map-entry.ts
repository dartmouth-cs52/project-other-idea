import { installGuard } from "./guard.ts";
import { startMapping } from "./map.ts";
import type { MappingParts } from "./map-pass.ts";

// The file the widget loads in a tab that is mapping the app: /map.js.

installGuard();
const parts = (window as unknown as { hapticMapping?: MappingParts }).hapticMapping;
if (parts) startMapping(parts).catch((error) => console.warn("[Haptic]", error));
