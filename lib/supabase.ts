import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey);

export type Rating = {
  grader_name: string;
  grader_email: string | null;
  verdict_id: string;
  institution: string;
  model: string;
  condition: string;
  human_verdict: "A" | "B" | "C" | "SKIP";
  rating_ms: number;
};
