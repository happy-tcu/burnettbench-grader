import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Rating submission endpoint.
 *
 * If NEXT_PUBLIC_SUPABASE_URL points to a real Supabase project, inserts into the
 * `ratings` table. Otherwise falls back to writing a local JSONL file at
 * `data/ratings.jsonl` (dev-only — serverless functions can't write to disk).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const supabaseConfigured =
  SUPABASE_URL &&
  !SUPABASE_URL.includes("placeholder") &&
  SUPABASE_KEY &&
  SUPABASE_KEY !== "placeholder";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const row = body as Record<string, unknown>;

  if (supabaseConfigured) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/ratings`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          // deliberately NOT asking for return=representation — anon has no SELECT
        },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json({ error: `supabase ${res.status}: ${text}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, sink: "supabase" });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // Local fallback
  const dir = join(process.cwd(), "data");
  const path = join(dir, "ratings.jsonl");
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path, JSON.stringify({ ...row, created_at: new Date().toISOString() }) + "\n", "utf8");
    return NextResponse.json({ ok: true, sink: "file", path });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 }
    );
  }
}
