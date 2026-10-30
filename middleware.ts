import { NextRequest, NextResponse } from "next/server";

// In-memory token-bucket rate limiter. One instance per serverless function;
// imperfect across cold starts and multiple regions, but good enough to stop
// script-kiddie flooding. For production abuse at scale, add Upstash.
const buckets = new Map<string, { count: number; resetAt: number }>();

function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

function clientKey(req: NextRequest, bucket: string): string {
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return `${bucket}:${ip}`;
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  let gate: { limit: number; windowMs: number; bucket: string } | null = null;

  if (path === "/dashboard/login") {
    // Login POST: 10 attempts per 15 minutes per IP
    if (req.method === "POST") gate = { limit: 10, windowMs: 15 * 60 * 1000, bucket: "login" };
  } else if (path === "/api/rate") {
    // Rating submits: 60 per 60s per IP (one every second avg; batch grading of 300 items ~ok)
    if (req.method === "POST") gate = { limit: 60, windowMs: 60 * 1000, bucket: "rate" };
  } else if (path === "/api/questions") {
    // Questions fetch: 10 per 60s (page loads only; graders fetch once per session)
    gate = { limit: 10, windowMs: 60 * 1000, bucket: "qs" };
  }

  const res = NextResponse.next();
  if (gate) {
    const key = clientKey(req, gate.bucket);
    const { ok, retryAfter } = hit(key, gate.limit, gate.windowMs);
    if (!ok) {
      return new NextResponse("Too many requests. Slow down.", {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      });
    }
  }

  // Security headers
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
