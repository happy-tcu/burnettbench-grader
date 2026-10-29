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
            For each of ~120 items, you'll see a question, a model's answer, and the ground-truth fact. Your job
            is to decide whether the model's answer is <strong>correct (A)</strong>,{" "}
            <strong>confidently wrong (B)</strong>, or <strong>not addressed (C)</strong>.
          </p>
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
