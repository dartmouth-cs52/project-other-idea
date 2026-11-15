import { DurableObject } from "cloudflare:workers";
import { admit, emptyMeter, settle, turnOver, type Admission, type Ceiling, type Limits, type MeterState, type Report } from "../src/server/budget.ts";

// Where the online server keeps what each site has spent on the model: one
// Durable Object per site, named by the site's id. A Worker runs as many
// copies at once, none of which can count on its own, so the sums live in the
// one place every copy can reach. The arithmetic is in src/server/budget.ts.

export class BudgetMeter extends DurableObject {
  private state?: MeterState;
  private salt?: { day: string; value: string };

  /** Asks whether a step may go ahead, and sets aside what it could cost if so. `caller` is empty unless the site limits each visitor. */
  async admit(limits: Limits, caller: string, ceiling: Ceiling): Promise<Admission> {
    const who = await this.scramble(caller);
    return this.change((state) => admit(state, limits, who, ceiling));
  }

  /** Adds what a step cost and gives back what was set aside for it. */
  async settle(limits: Limits, caller: string, hold: number | undefined, usd: number, steps: number): Promise<Report> {
    const who = await this.scramble(caller);
    return this.change((state) => settle(state, limits, who, hold, usd, steps));
  }

  /**
   * A visitor's address as it is kept for a per-visitor limit: hashed with a
   * random value made for this site each day and thrown away the next. So the
   * same visitor is a different value on every site and every day, and a
   * value cannot be turned back into an address by hashing every address
   * there is, unless the day's random value is read from the same storage.
   */
  private async scramble(caller: string): Promise<string> {
    if (!caller) return "";
    const day = new Date().toISOString().slice(0, 10);
    this.salt ??= await this.ctx.storage.get<{ day: string; value: string }>("salt");
    if (this.salt?.day !== day) {
      const value = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      this.salt = { day, value };
      await this.ctx.storage.put("salt", this.salt);
    }
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${this.salt.value} ${caller}`));
    return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Runs at the start of the next day (UTC) after a caller was counted. The
   * count of steps by caller is only wanted for the day it was taken, and a
   * site nobody visits the next day would otherwise keep it.
   */
  async alarm(): Promise<void> {
    await this.change((state) => turnOver(state));
  }

  private async change<T>(work: (state: MeterState) => T): Promise<T> {
    this.state ??= (await this.ctx.storage.get<MeterState>("meter")) ?? emptyMeter();
    const before = JSON.stringify(this.state);
    const result = work(this.state);
    if (JSON.stringify(this.state) !== before) await this.ctx.storage.put("meter", this.state);
    if (Object.keys(this.state.callers).length > 0 && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.parse(`${this.state.day}T00:00:00Z`) + 24 * 60 * 60_000 + 1000);
    }
    return result;
  }
}
