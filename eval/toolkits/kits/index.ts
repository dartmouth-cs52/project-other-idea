import type { Kit } from "../types.ts";
import antd from "./antd.ts";
import mui from "./mui.ts";

/** Every toolkit, in the order they are run and shown. */
export const KITS: Kit[] = [mui, antd];
