import { create } from "zustand";
import { persist } from "zustand/middleware";

// App state that isn't data: which entity is in view and whether the sidebar
// groups are folded.

interface Session {
  /** "all" or an entity id. */
  entity: string;
  collapsedGroups: string[];
  setEntity: (id: string) => void;
  toggleGroup: (label: string) => void;
}

export const useSession = create<Session>()(
  persist(
    (set) => ({
      entity: "all",
      collapsedGroups: [],
      setEntity: (entity) => set({ entity }),
      toggleGroup: (label) => set((s) => ({ collapsedGroups: s.collapsedGroups.includes(label) ? s.collapsedGroups.filter((g) => g !== label) : [...s.collapsedGroups, label] })),
    }),
    { name: "northpine-session" },
  ),
);

/** Filters rows to the entity picked in the switcher. */
export function useEntityFilter() {
  const entity = useSession((s) => s.entity);
  return <T extends { entityId: string }>(rows: T[]) => (entity === "all" ? rows : rows.filter((r) => r.entityId === entity));
}
