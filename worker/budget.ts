import { DurableObject } from "cloudflare:workers";
import { admit, emptyMeter, settle, type Admission, type Ceiling, type Limits, type MeterState, type Report } from "../src/server/budget.ts";

// Where the online server keeps what each site has spent on the model: one
// Durable Object per site, named by the site's id. A Worker runs as many
// copies at once, none of which can count on its own, so the sums live in the
// one place every copy can reach. The arithmetic is in src/server/budget.ts.

export class BudgetMeter extends DurableObject {
  private state?: MeterState;

  /** Asks whether a step may go ahead, and sets aside what it could cost if so. */
  async admit(limits: Limits, caller: string, ceiling: Ceiling): Promise<Admission> {
    return this.change((state) => admit(state, limits, caller, ceiling));
  }

  /** Adds what a step cost and gives back what was set aside for it. */
  async settle(limits: Limits, caller: string, hold: number | undefined, usd: number, steps: number): Promise<Report> {
    return this.change((state) => settle(state, limits, caller, hold, usd, steps));
  }

  private async change<T>(work: (state: MeterState) => T): Promise<T> {
    this.state ??= (await this.ctx.storage.get<MeterState>("meter")) ?? emptyMeter();
    const before = JSON.stringify(this.state);
    const result = work(this.state);
    if (JSON.stringify(this.state) !== before) await this.ctx.storage.put("meter", this.state);
    return result;
  }
}
