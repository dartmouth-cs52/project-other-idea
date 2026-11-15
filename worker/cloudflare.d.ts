// The few parts of Cloudflare's Durable Objects this project uses, declared by
// hand so the project does not need Cloudflare's whole set of types.
declare module "cloudflare:workers" {
  export interface DurableObjectState {
    storage: {
      get<T>(key: string): Promise<T | undefined>;
      put(key: string, value: unknown): Promise<void>;
      /** When the object's alarm is set for, in milliseconds, or null when none is. */
      getAlarm(): Promise<number | null>;
      setAlarm(time: number | Date): Promise<void>;
    };
  }
  export abstract class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected ctx: DurableObjectState;
    protected env: Env;
    /** Called by Cloudflare at the time given to setAlarm. */
    alarm?(): void | Promise<void>;
  }
}
