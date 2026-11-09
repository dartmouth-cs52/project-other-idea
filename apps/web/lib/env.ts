// Server-only configuration. Everything optional has a development default so
// `npm run dev` works before Supabase and Stripe are set up.

const isProduction = process.env.NODE_ENV === "production";

export const env = {
  isProduction,
  sessionSecret: process.env.HAPTIC_SESSION_SECRET ?? (isProduction ? "" : "dev-only-session-secret-change-me-please"),
  model: process.env.HAPTIC_MODEL ?? "gemini-3.5-flash-lite",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  /**
   * Voice (push-to-talk and spoken answers) is switched off until recognition
   * quality is good enough. The code stays; set HAPTIC_VOICE=on to try it.
   */
  voiceFeature: process.env.HAPTIC_VOICE === "on",
  /** A calm, neutral voice. Override per deployment with ELEVENLABS_VOICE_ID. */
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  /** Turns allowed per SDK session per 10 minutes. */
  turnLimit: Number(process.env.HAPTIC_TURN_LIMIT ?? (isProduction ? 30 : 1000)),
  devKey: process.env.HAPTIC_DEV_KEY ?? (isProduction ? "" : "pk_dev_local"),
  devOrigins: (process.env.HAPTIC_DEV_ORIGINS ?? "http://localhost:4100,http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export const hasSupabase = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);
