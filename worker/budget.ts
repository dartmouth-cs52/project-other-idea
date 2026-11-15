import { DurableObject } from "cloudflare:workers";
import { emptyMeter, meter, type Limits, type MeterState, type Report } from "../src/server/budget.ts";

// Where the online server keeps what each site has spent on the model: one
// Durable Object per site, named by the site's id. A Worker runs as many
// copies at once, none of which can count on its own, so the sums live in the
// one place every copy can reach. The arithmetic is in src/server/budget.ts.

export class BudgetMeter extends DurableObject {
  private state?: MeterState;

  async spend(limits: Limits, caller: string, usd: number, steps: number): Promise<Report> {
    this.state ??= (await this.ctx.storage.get<MeterState>("meter")) ?? emptyMeter();
    const before = JSON.stringify(this.state);
    const report = meter(this.state, limits, caller, usd, steps);
    if (JSON.stringify(this.state) !== before) await this.ctx.storage.put("meter", this.state);
    return report;
  }
}
