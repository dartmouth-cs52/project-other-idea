import { Link } from "react-router";
import { Button } from "@/ui/button";

export function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-[13px] font-medium text-ink-3">404</p>
      <h1 className="text-[22px] font-semibold">This page doesn't exist</h1>
      <p className="max-w-sm text-[13px] text-ink-2">The link may be old, or the page may have moved.</p>
      <Button asChild variant="primary">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
