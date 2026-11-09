// In-memory sliding window per key. Good enough for one server instance; a
// shared store replaces it when we run more than one.

const windows = new Map<string, number[]>();

export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  if (windows.size > 50_000) {
    // Drop the oldest keys so a flood of sessions can't grow this forever.
    for (const k of Array.from(windows.keys()).slice(0, 10_000)) windows.delete(k);
  }
  return true;
}
