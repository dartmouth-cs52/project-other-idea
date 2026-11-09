// Dashboard pages read the signed-in user on every request, so navigating
// between them shows this while the page streams in. It sits below the
// dashboard layout, which keeps the header in place during navigation.
export default function Loading() {
  return <p className="text-ink-muted">Loading…</p>;
}
