import { NextResponse } from "next/server";

/**
 * Returns the full set of grading questions, ordered by id.
 * Reads from the Supabase `questions` table (public, anon-readable).
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || url.includes("placeholder")) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(
      `${url}/rest/v1/questions?select=id,institution,fact_id,model,condition,category,fact,probe,response,in_v2,sources&order=id.asc&limit=1000`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return NextResponse.json({ error: `supabase ${res.status}` }, { status: 502 });
    }
    const rows = await res.json();
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
