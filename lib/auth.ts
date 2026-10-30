import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.DASHBOARD_SECRET ?? "fallback-dev-secret-change-me";

/**
 * Returns an HMAC-signed session token.
 * Shape: base64url(expiryTimestampMs).base64url(hmac)
 */
export function signSession(ttlMs: number = 24 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(String(exp)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  try {
    const exp = parseInt(Buffer.from(payload, "base64url").toString(), 10);
    return Date.now() < exp;
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison. Prevents timing attacks on password check.
 */
export function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still do a dummy compare to equalize timing
    const dummy = Buffer.alloc(Math.max(a.length, b.length));
    try {
      timingSafeEqual(dummy, dummy);
    } catch {}
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
