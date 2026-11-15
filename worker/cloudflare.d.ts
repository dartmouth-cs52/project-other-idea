// The few parts of Cloudflare's Durable Objects this project uses, declared by
// hand so the project does not need Cloudflare's whole set of types.
declare module "cloudflare:workers" {
  export interface DurableObjectState {
    storage: {
      get<T>(key: string): Promise<T | undefined>;
      put(key: string, value: unknown): Promise<void>;
    };
  }
  export abstract class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected ctx: DurableObjectState;
    protected env: Env;
  }
}
