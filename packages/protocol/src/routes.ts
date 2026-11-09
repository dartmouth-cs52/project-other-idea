// Collapse IDs in paths so every user's /set/8f2c… counts as the same page.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePath(input: string): string {
  const withoutOrigin = input.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  const pathOnly = withoutOrigin.split(/[?#]/)[0] ?? "";
  const segments = pathOnly
    .split("/")
    .filter(Boolean)
    .map((segment) => (isIdSegment(safeDecode(segment)) ? ":id" : segment));
  return "/" + segments.join("/");
}

export function isIdSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (UUID.test(segment)) return true;
  if (segment.includes("@")) return true;
  // Hex IDs such as Mongo ObjectIds or short hashes.
  if (/^[0-9a-f]{8,}$/i.test(segment) && /\d/.test(segment)) return true;
  // Mixed tokens like cus_9f8a7sd6f or a1B2c3D4e5. Words with a small version
  // suffix ("v2", "step-3") stay as they are.
  if (segment.length >= 10 && /\d/.test(segment) && /[a-z]/i.test(segment)) {
    const digits = segment.replace(/\D/g, "").length;
    return digits >= 3;
  }
  return false;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
