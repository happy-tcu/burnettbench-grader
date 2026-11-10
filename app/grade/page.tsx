"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Source = { url: string; label: string };

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
  sources: Source[];
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

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const PER_ITEM_CAP_MS = 180_000; // 3 min per-item engaged cap
const MAX_PAYABLE_MS = 7_200_000; // 2 hr hard cap on billable time per grader

export default function Grade() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grader, setGrader] = useState<{ name: string; email: string } | null>(null);
  // Engaged time tracking: paused when tab hidden, capped per item.
  const [itemStartMs, setItemStartMs] = useState<number>(Date.now());
  const [itemAccumMs, setItemAccumMs] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [totalEngagedMs, setTotalEngagedMs] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());
  const [comment, setComment] = useState<string>("");

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

    // Resume engaged ms accumulator
    const engagedKey = `bb_engaged_${name}`;
    const savedEngaged = parseInt(localStorage.getItem(engagedKey) || "0", 10);
    setTotalEngagedMs(savedEngaged);
    setItemStartMs(Date.now());
    setItemAccumMs(0);
    setIsPaused(document.visibilityState === "hidden");

    fetch("/api/questions")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Item[]) => setItems(data))
      .catch(() => setError("Failed to load items."));
  }, [router]);

  // Live clock, 1 Hz (drives the displayed engaged-time counter)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Pause / resume on tab visibility
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        // Record the active ms up to now and freeze
        setItemAccumMs((prev) => prev + (Date.now() - itemStartMs));
        setIsPaused(true);
      } else {
        setItemStartMs(Date.now());
        setIsPaused(false);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [itemStartMs]);

  useEffect(() => {
    setItemStartMs(Date.now());
    setItemAccumMs(0);
    setError(null);
    setComment("");
  }, [idx]);

  const submit = useCallback(
    async (verdict: "A" | "B" | "C" | "FLAG" | "SKIP") => {
      if (!items || !grader) return;
      const item = items[idx];
      if (!item) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grader_name: grader.name,
            grader_email: grader.email || null,
            verdict_id: item.id,
            institution: item.institution,
            model: item.model,
            condition: item.condition,
            human_verdict: verdict,
            rating_ms: Math.min(
              itemAccumMs + (isPaused ? 0 : Date.now() - itemStartMs),
              PER_ITEM_CAP_MS
            ),
            comment: comment.trim() || null,
          }),
        });
        if (!res.ok) {
          setError("Could not save your rating. Retry?");
          setSubmitting(false);
          return;
        }
        // Accumulate the capped engaged ms into the grader's persistent total
        const addedMs = Math.min(
          itemAccumMs + (isPaused ? 0 : Date.now() - itemStartMs),
          PER_ITEM_CAP_MS
        );
        const newTotal = Math.min(totalEngagedMs + addedMs, MAX_PAYABLE_MS);
        setTotalEngagedMs(newTotal);
        localStorage.setItem(`bb_engaged_${grader.name}`, String(newTotal));

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
    [items, idx, grader, itemStartMs, itemAccumMs, isPaused, totalEngagedMs, router, comment]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (submitting) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.key === "a" || e.key === "A") submit("A");
      if (e.key === "b" || e.key === "B") submit("B");
      if (e.key === "c" || e.key === "C") submit("C");
      if (e.key === "d" || e.key === "D") submit("FLAG");
      if (e.key === "s" || e.key === "S") submit("SKIP");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [submit, submitting]);

  if (!items || !grader) return <main><p>Loading…</p></main>;
  if (idx >= items.length) return <main><p>All done — redirecting…</p></main>;

  const item = items[idx];
  const pct = Math.round(((idx) / items.length) * 100);

  // Displayed timer: persisted engaged + current item's live active time
  const currentItemActive = isPaused ? itemAccumMs : itemAccumMs + (now - itemStartMs);
  const displayedEngaged = Math.min(
    totalEngagedMs + Math.min(currentItemActive, PER_ITEM_CAP_MS),
    MAX_PAYABLE_MS
  );
  const capReached = displayedEngaged >= MAX_PAYABLE_MS;

  return (
    <main>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-text">
        <span><strong>{idx + 1}</strong> of {items.length} · Grader: {grader.name}</span>
        <span
          className={`session-timer${isPaused ? " paused" : ""}${capReached ? " capped" : ""}`}
          title="Billable time (pauses when tab is hidden; capped at 2 hours)"
        >
          {isPaused ? "⏸ " : ""}{formatElapsed(displayedEngaged)}
          {capReached ? " · cap reached" : ""}
        </span>
      </div>

      <div className="card">
        <div className="meta">QUESTION</div>
        <div className="probe-text">{item.probe}</div>
      </div>

      <div className="card">
        <div className="meta">GROUND-TRUTH FACT</div>
        <div className="fact-text">{item.fact}</div>
        {item.sources && item.sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">Verify at:</span>
            {item.sources.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            ))}
          </div>
        )}
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
        <span className="label-text"><strong>Correct</strong> — the response accurately states the fact (or the key part of it).</span>
      </button>
      <button className="verdict-btn b" onClick={() => submit("B")} disabled={submitting}>
        <span className="kbd">B</span>
        <span className="label-text"><strong>Confidently wrong</strong> — the response states something that contradicts the fact, or fabricates a plausible-sounding wrong answer.</span>
      </button>
      <button className="verdict-btn c" onClick={() => submit("C")} disabled={submitting}>
        <span className="kbd">C</span>
        <span className="label-text"><strong>Not addressed</strong> — the response hedges, declines, or does not actually answer the question.</span>
      </button>

      <button className="verdict-btn d" onClick={() => submit("FLAG")} disabled={submitting}>
        <span className="kbd">D</span>
        <span className="label-text"><strong>Flag ground truth</strong> — the stated fact looks wrong, unverifiable, or ambiguous. Use this when you cannot judge the response because the fact itself is suspect.</span>
      </button>

      <div className="comment-row">
        <label htmlFor="rating-comment" className="comment-label">
          Optional note on your decision (edge cases, caveats, what tipped you one way)
        </label>
        <textarea
          id="rating-comment"
          className="comment-input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional — leave blank if the verdict is clean."
          rows={3}
          maxLength={2000}
          disabled={submitting}
        />
      </div>

      <div className="skip-row">
        <button onClick={() => submit("SKIP")} disabled={submitting}>
          Skip this one (S)
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <p className="footer">Keyboard: A / B / C / D / S · Progress saved automatically.</p>
    </main>
  );
}
