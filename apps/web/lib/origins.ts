// Allowed-origin matching for publishable keys. Entries are exact origins
// ("https://app.acme.com", "http://localhost:3000") or a wildcard for
// subdomains ("https://*.acme.com").

export function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  const actual = normalizeOrigin(origin);
  if (!actual) return false;
  const actualUrl = new URL(actual);

  return allowed.some((entry) => {
    const trimmed = entry.trim().replace(/\/$/, "");
    if (!trimmed.includes("*")) return normalizeOrigin(trimmed) === actual;
    const match = /^(https?):\/\/\*\.([^/:]+)(?::(\d+))?$/.exec(trimmed);
    if (!match) return false;
    const [, protocol, domain, port] = match;
    if (actualUrl.protocol !== `${protocol}:`) return false;
    if ((actualUrl.port || "") !== (port ?? "")) return false;
    return actualUrl.hostname.endsWith(`.${domain}`);
  });
}
