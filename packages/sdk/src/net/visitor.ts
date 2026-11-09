// A random ID kept in this site's localStorage. The server only uses a hash
// of it, to count how many different people saw a label before learning it.
// It isn't tied to the user's account and isn't sent anywhere else.

const KEY = "haptic.v1.visitor";

export function visitorId(): string | undefined {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Storage blocked. The server falls back to counting sessions.
    return undefined;
  }
}
