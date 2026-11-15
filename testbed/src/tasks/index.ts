// Every benchmark task, by area.
import { tasks as shell } from "./shell";
import { tasks as cards } from "./cards";
import { tasks as reimbursements } from "./reimbursements";
import { tasks as expenses } from "./expenses";
import { tasks as approvals } from "./approvals";
import { tasks as policies } from "./policies";
import { tasks as bills } from "./bills";
import { tasks as accounting } from "./accounting";
import { tasks as reports } from "./reports";
import { tasks as budgets } from "./budgets";
import { tasks as people } from "./people";
import { tasks as settings } from "./settings";
import { tasks as help } from "./help";
import type { Task } from "./types";

export const TASKS: Task[] = [...shell, ...cards, ...reimbursements, ...expenses, ...approvals, ...policies, ...bills, ...accounting, ...reports, ...budgets, ...people, ...settings, ...help];
export type { Task } from "./types";
