import type { Kit } from "../types.ts";
import aggrid from "./aggrid.ts";
import antd from "./antd.ts";
import carbon from "./carbon.ts";
import fluent from "./fluent.ts";
import mui from "./mui.ts";
import ui5 from "./ui5.ts";

/** Every toolkit, in the order they are run and shown. */
export const KITS: Kit[] = [mui, antd, fluent, carbon, ui5, aggrid];
