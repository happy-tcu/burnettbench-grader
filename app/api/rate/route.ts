import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Rating submission endpoint.
 *
 * Writes to Supabase when NEXT_PUBLIC_SUPABASE_URL is set, otherwise appends
 * to a local JSONL file (dev-only).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseConfigured =
  SUPABASE_URL &&
  !SUPABASE_URL.includes("placeholder") &&
  SUPABASE_KEY &&
  SUPABASE_KEY !== "placeholder";

const INSTITUTIONS = new Set(["bakame", "mayo", "rice", "uscis", "ve"]);
const MODELS = new Set([
  "qwen3-14b",
  "gpt-4o-mini",
  "llama-3.1-70b",
  "claude-haiku-4-5",
  "gemini-flash",
  "test",
]);
const VERDICTS = new Set(["A", "B", "C", "FLAG", "SKIP"]);
const VERDICT_ID = /^bb-\d{3}$/;

type Payload = {
  grader_name: unknown;
  grader_email?: unknown;
  verdict_id: unknown;
  institution: unknown;
  model: unknown;
  condition: unknown;
  human_verdict: unknown;
  rating_ms?: unknown;
};

function validate(p: Payload): { ok: true; row: Record<string, unknown> } | { ok: false; err: string } {
  if (typeof p.grader_name !== "string" || p.grader_name.length === 0 || p.grader_name.length > 80)
    return { ok: false, err: "grader_name must be 1-80 chars" };
  const email = typeof p.grader_email === "string" ? p.grader_email : null;
  if (email && (email.length > 120 || !email.includes("@"))) return { ok: false, err: "bad email" };
  if (typeof p.verdict_id !== "string" || !VERDICT_ID.test(p.verdict_id))
    return { ok: false, err: "verdict_id must match /^bb-\\d{3}$/" };
  if (typeof p.institution !== "string" || !INSTITUTIONS.has(p.institution))
    return { ok: false, err: "unknown institution" };
  if (typeof p.model !== "string" || !MODELS.has(p.model))
    return { ok: false, err: "unknown model" };
  if (typeof p.condition !== "string" || p.condition.length > 40)
    return { ok: false, err: "bad condition" };
  if (typeof p.human_verdict !== "string" || !VERDICTS.has(p.human_verdict))
    return { ok: false, err: "bad human_verdict" };
  const ms = p.rating_ms;
  if (ms !== undefined && (typeof ms !== "number" || ms < 0 || ms > 600000))
    return { ok: false, err: "rating_ms out of range" };
  return {
    ok: true,
    row: {
      grader_name: p.grader_name.trim(),
      grader_email: email || null,
      verdict_id: p.verdict_id,
      institution: p.institution,
      model: p.model,
      condition: p.condition,
      human_verdict: p.human_verdict,
      rating_ms: typeof ms === "number" ? ms : null,
    },
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "body must be object" }, { status: 400 });
  }

  const v = validate(body as Payload);
  if (!v.ok) return NextResponse.json({ error: v.err }, { status: 400 });

  if (supabaseConfigured) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/ratings`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(v.row),
      });
      if (res.ok) return NextResponse.json({ ok: true, sink: "supabase" });

      const text = await res.text();
      // Duplicate rating -> treat as success (idempotent)
      if (res.status === 409 && text.includes("23505")) {
        return NextResponse.json({ ok: true, sink: "supabase", note: "duplicate ignored" });
      }
      // Everything else: do not leak Supabase internals
      console.error("supabase insert failed", res.status, text);
      return NextResponse.json({ error: "could not save" }, { status: 500 });
    } catch (e) {
      console.error("supabase fetch threw", e);
      return NextResponse.json({ error: "network" }, { status: 500 });
    }
  }

  // Local file fallback
  const dir = join(process.cwd(), "data");
  const path = join(dir, "ratings.jsonl");
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path, JSON.stringify({ ...v.row, created_at: new Date().toISOString() }) + "\n", "utf8");
    return NextResponse.json({ ok: true, sink: "file" });
  } catch {
    return NextResponse.json({ error: "could not save" }, { status: 500 });
  }
}
