// The public API is called from customer sites, so every response carries
// CORS headers for the requesting origin. Origins are checked separately:
// these headers alone grant nothing.

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-haptic-model",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export function jsonResponse(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...corsHeaders(request.headers.get("origin")), ...extra } });
}
