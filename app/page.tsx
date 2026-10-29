"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const start = () => {
    if (!name.trim()) return;
    localStorage.setItem("bb_grader_name", name.trim());
    localStorage.setItem("bb_grader_email", email.trim());
    router.push("/grade");
  };

  return (
    <main>
      <h1>BurnettBench — Human Validation</h1>
      <p className="subtitle">Scope Coverage Effects in llms.txt V2 · Niyorurema & Estella, 2026</p>

      <div className="card">
        <h2>What this is</h2>
        <div className="instructions">
          <p>
            You are helping validate an AI judge used in our empirical study of the <code>llms.txt</code> standard.
            For each of ~120 items, you'll see a <strong>question</strong>, the <strong>ground-truth fact</strong>{" "}
            (the authoritative answer, scraped from Wikipedia or the institution's own website), and the{" "}
            <strong>model's response</strong>. Your job is to compare the response to the fact and decide:
          </p>
          <ul style={{ margin: "6px 0 8px 20px", fontSize: 13 }}>
            <li><strong>A — Correct:</strong> response matches the fact.</li>
            <li><strong>B — Confidently wrong:</strong> response contradicts the fact or fabricates a plausible wrong answer.</li>
            <li><strong>C — Not addressed:</strong> response hedges, declines, or doesn't actually answer.</li>
            <li><strong>D — Flag ground truth:</strong> use if the fact itself looks wrong or unverifiable (you can click the source link to check).</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            Expect this to take about <strong>45–60 minutes</strong>. You can pause and resume — progress is saved
            in your browser. Thank you.
          </p>
          <p style={{ marginTop: 10, fontSize: 12 }}>
            Grader anonymity: we store your name only to compute inter-rater agreement. It is not published.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label>Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Email (optional, so we can thank you)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
          />
        </div>
        <button className="primary" onClick={start} disabled={!name.trim()}>
          Start grading →
        </button>
      </div>

      <p className="footer">
        Contact: h.niyorurema@tcu.edu · <a href="https://github.com/happy-tcu/burnettbench">source</a>
      </p>
    </main>
  );
}
