import { useMemo } from "react";
import { useIndex } from "@/data/store";
import type { Card, Category, Department, Employee, Entity } from "@/data/types";
import type { Ctx } from "./engine";

/** The lookups the report engine needs to turn ids into names. */
export function useReportCtx(): Ctx {
  const departments = useIndex("departments") as Map<string, Department>;
  const employees = useIndex("employees") as Map<string, Employee>;
  const categories = useIndex("categories") as Map<string, Category>;
  const entities = useIndex("entities") as Map<string, Entity>;
  const cards = useIndex("cards") as Map<string, Card>;
  return useMemo(() => ({ departments, employees, categories, entities, cards }), [departments, employees, categories, entities, cards]);
}
