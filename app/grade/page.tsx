"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Item = {
  id: string;
  institution: string;
  fact_id: string;
  model: string;
  condition: string;
  category: string | null;
  fact: string;
  probe: string;
  response: string;
  in_v2: boolean;
};

const INST_LABEL: Record<string, string> = {
  bakame: "Bakame AI",
  mayo: "Mayo Clinic",
  rice: "Rice University",
  uscis: "USCIS",
  ve: "Vinson & Elkins",
};

const MODEL_LABEL: Record<string, string> = {
  "qwen3-14b": "Qwen3-14B",
  "gpt-4o-mini": "GPT-4o-mini",
  "llama-3.1-70b": "LLaMA-3.1-70B",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "gemini-flash": "Gemini Flash",
};

export default function Grade() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grader, setGrader] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const name = localStorage.getItem("bb_grader_name");
    if (!name) {
      router.replace("/");
      return;
    }
    const email = localStorage.getItem("bb_grader_email") || "";
    setGrader({ name, email });

    const savedIdx = parseInt(localStorage.getItem(`bb_idx_${name}`) || "0", 10);
    setIdx(savedIdx);

    fetch("/sample.json")
      .then((r) => r.json())
      .then((data: Item[]) => setItems(data))
      .catch(() => setError("Failed to load items."));
  }, [router]);

  useEffect(() => {
    setStartedAt(Date.now());
    setError(null);
  }, [idx]);

  const submit = useCallback(
    async (verdict: "A" | "B" | "C" | "SKIP") => {
      if (!items || !grader) return;
      const item = items[idx];
      if (!item) return;
      setSubmitting(true);
      setError(null);
      try {
        const { error: dbError } = await supabase.from("ratings").insert({
          grader_name: grader.name,
          grader_email: grader.email || null,
          verdict_id: item.id,
          institution: item.institution,
          model: item.model,
          condition: item.condition,
          human_verdict: verdict,
          rating_ms: Date.now() - startedAt,
        });
        if (dbError) {
          setError("Could not save your rating. Retry?");
          setSubmitting(false);
          return;
        }
        const nextIdx = idx + 1;
        localStorage.setItem(`bb_idx_${grader.name}`, String(nextIdx));
        if (nextIdx >= items.length) {
          router.push("/done");
        } else {
          setIdx(nextIdx);
        }
      } catch {
        setError("Network error. Retry?");
      } finally {
        setSubmitting(false);
      }
    },
    [items, idx, grader, startedAt, router]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (submitting) return;
      if (e.key === "a" || e.key === "A") submit("A");
      if (e.key === "b" || e.key === "B") submit("B");
      if (e.key === "c" || e.key === "C") submit("C");
      if (e.key === "s" || e.key === "S") submit("SKIP");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submit, submitting]);

  if (!items || !grader) return <main><p>Loading…</p></main>;
  if (idx >= items.length) return <main><p>All done — redirecting…</p></main>;

  const item = items[idx];
  const pct = Math.round(((idx) / items.length) * 100);

  return (
    <main>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-text">
        <strong>{idx + 1}</strong> of {items.length} · Grader: {grader.name}
      </div>

      <div className="card">
        <div className="meta">QUESTION</div>
        <div className="probe-text">{item.probe}</div>
      </div>

      <div className="card">
        <div className="meta">GROUND-TRUTH FACT</div>
        <div className="fact-text">{item.fact}</div>
      </div>

      <div className="card">
        <div className="meta">
          MODEL RESPONSE · {MODEL_LABEL[item.model] ?? item.model} · {INST_LABEL[item.institution] ?? item.institution}
        </div>
        <div className="response-text">{item.response}</div>
      </div>

      <h2>Your verdict</h2>
      <button className="verdict-btn a" onClick={() => submit("A")} disabled={submitting}>
        <span className="kbd">A</span>
        <strong>Correct</strong> — the response accurately states the fact (or the key part of it).
      </button>
      <button className="verdict-btn b" onClick={() => submit("B")} disabled={submitting}>
        <span className="kbd">B</span>
        <strong>Confidently wrong</strong> — the response states something that contradicts the fact, or fabricates
        a plausible-sounding wrong answer.
      </button>
      <button className="verdict-btn c" onClick={() => submit("C")} disabled={submitting}>
        <span className="kbd">C</span>
        <strong>Not addressed</strong> — the response hedges, declines, or does not actually answer the question.
      </button>

      <div className="skip-row">
        <button onClick={() => submit("SKIP")} disabled={submitting}>
          Skip this one (S)
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <p className="footer">Keyboard: A / B / C / S · Progress saved automatically.</p>
    </main>
  );
}
