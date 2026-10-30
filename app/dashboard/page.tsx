import { cohenKappa, majority } from "@/lib/kappa";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Rating = {
  grader_name: string;
  grader_email: string | null;
  verdict_id: string;
  institution: string;
  model: string;
  condition: string;
  human_verdict: "A" | "B" | "C" | "FLAG" | "SKIP";
  rating_ms: number | null;
  created_at: string;
};

type Judge = { question_id: string; judge_verdict: "A" | "B" | "C" };

async function fetchAll(url: string, key: string, table: string): Promise<unknown[]> {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=5000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ pw?: string }>;
}) {
  const { pw } = await searchParams;
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    return (
      <main>
        <h1>Dashboard</h1>
        <p className="subtitle">Not configured</p>
        <div className="card">
          <p>
            Set <code>DASHBOARD_PASSWORD</code> in Vercel env vars, then visit{" "}
            <code>/dashboard?pw=&lt;value&gt;</code>.
          </p>
        </div>
      </main>
    );
  }
  if (pw !== expected) {
    return (
      <main>
        <h1>Dashboard</h1>
        <p className="subtitle">Password required</p>
        <div className="card">
          <form method="GET">
            <div className="field">
              <label>Password</label>
              <input type="password" name="pw" autoFocus />
            </div>
            <button className="primary" type="submit">
              Enter →
            </button>
          </form>
        </div>
      </main>
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let ratings: Rating[] = [];
  let judges: Judge[] = [];
  let fetchError: string | null = null;
  try {
    [ratings, judges] = (await Promise.all([
      fetchAll(url, svc, "ratings"),
      fetchAll(url, svc, "judge_verdicts"),
    ])) as [Rating[], Judge[]];
  } catch (e) {
    fetchError = String(e);
  }

  // --- Overview ---
  const totalRatings = ratings.length;
  const graderNames = Array.from(new Set(ratings.map((r) => r.grader_name))).sort();
  const nGraders = graderNames.length;
  const nFlags = ratings.filter((r) => r.human_verdict === "FLAG").length;
  const nSkips = ratings.filter((r) => r.human_verdict === "SKIP").length;
  const nABC = ratings.filter((r) => ["A", "B", "C"].includes(r.human_verdict)).length;

  // --- Per-grader table ---
  const perGrader = graderNames.map((name) => {
    const rows = ratings.filter((r) => r.grader_name === name);
    const abc = rows.filter((r) => ["A", "B", "C"].includes(r.human_verdict));
    const ms = abc.map((r) => r.rating_ms).filter((x): x is number => typeof x === "number");
    const avgSec = ms.length ? (ms.reduce((a, b) => a + b, 0) / ms.length) / 1000 : 0;
    const flagged = rows.filter((r) => r.human_verdict === "FLAG").length;
    const skipped = rows.filter((r) => r.human_verdict === "SKIP").length;
    const last = rows
      .map((r) => r.created_at)
      .sort()
      .pop();
    return { name, total: rows.length, abc: abc.length, flagged, skipped, avgSec, last };
  });

  // --- Verdict distribution ---
  const dist = { A: 0, B: 0, C: 0, FLAG: 0, SKIP: 0 } as Record<string, number>;
  for (const r of ratings) dist[r.human_verdict] = (dist[r.human_verdict] ?? 0) + 1;

  // --- Judge distribution for comparison ---
  const judgeDist = { A: 0, B: 0, C: 0 } as Record<string, number>;
  for (const j of judges) judgeDist[j.judge_verdict] = (judgeDist[j.judge_verdict] ?? 0) + 1;

  // --- Coverage: how many ratings per verdict_id ---
  const coverage = new Map<string, number>();
  for (const r of ratings) {
    if (r.human_verdict === "SKIP") continue;
    coverage.set(r.verdict_id, (coverage.get(r.verdict_id) ?? 0) + 1);
  }
  const judgeIds = new Set(judges.map((j) => j.question_id));
  const nTotalItems = judgeIds.size;
  const cov0 = nTotalItems - coverage.size;
  const cov1 = Array.from(coverage.values()).filter((n) => n === 1).length;
  const cov2 = Array.from(coverage.values()).filter((n) => n === 2).length;
  const cov3p = Array.from(coverage.values()).filter((n) => n >= 3).length;

  // --- Agreement: judge vs each grader (A/B/C only, non-flagged items) ---
  const judgeMap = new Map(judges.map((j) => [j.question_id, j.judge_verdict]));
  const flaggedIds = new Set(
    ratings.filter((r) => r.human_verdict === "FLAG").map((r) => r.verdict_id)
  );

  const judgeVsGrader = perGrader.map((g) => {
    const myRatings = ratings.filter(
      (r) =>
        r.grader_name === g.name &&
        ["A", "B", "C"].includes(r.human_verdict) &&
        !flaggedIds.has(r.verdict_id)
    );
    const paired = myRatings
      .map((r) => ({ h: r.human_verdict, j: judgeMap.get(r.verdict_id) }))
      .filter((p) => p.j !== undefined);
    const k = cohenKappa(
      paired.map((p) => p.h),
      paired.map((p) => p.j as string)
    );
    const agree = paired.filter((p) => p.h === p.j).length;
    return { name: g.name, n: paired.length, kappa: k, agree };
  });

  // --- Judge vs human majority (n≥2 raters per item, non-tied, non-flagged) ---
  const perItem = new Map<string, string[]>();
  for (const r of ratings) {
    if (!["A", "B", "C"].includes(r.human_verdict)) continue;
    if (flaggedIds.has(r.verdict_id)) continue;
    if (!perItem.has(r.verdict_id)) perItem.set(r.verdict_id, []);
    perItem.get(r.verdict_id)!.push(r.human_verdict);
  }
  const majPairs: { h: string; j: string }[] = [];
  for (const [vid, votes] of perItem) {
    if (votes.length < 2) continue;
    const { verdict, tied } = majority(votes);
    if (tied || !verdict) continue;
    const j = judgeMap.get(vid);
    if (j) majPairs.push({ h: verdict, j });
  }
  const majKappa = majPairs.length
    ? cohenKappa(
        majPairs.map((p) => p.h),
        majPairs.map((p) => p.j)
      )
    : null;

  // --- Pairwise grader agreement (Cohen's kappa) ---
  const pairwise: { g1: string; g2: string; n: number; kappa: number }[] = [];
  for (let i = 0; i < graderNames.length; i++) {
    for (let j = i + 1; j < graderNames.length; j++) {
      const g1 = graderNames[i];
      const g2 = graderNames[j];
      const r1 = ratings.filter(
        (r) => r.grader_name === g1 && ["A", "B", "C"].includes(r.human_verdict)
      );
      const r2 = ratings.filter(
        (r) => r.grader_name === g2 && ["A", "B", "C"].includes(r.human_verdict)
      );
      const idxR1 = new Map(r1.map((r) => [r.verdict_id, r.human_verdict]));
      const shared: { a: string; b: string }[] = [];
      for (const r of r2) {
        const other = idxR1.get(r.verdict_id);
        if (other) shared.push({ a: other, b: r.human_verdict });
      }
      if (shared.length) {
        pairwise.push({
          g1,
          g2,
          n: shared.length,
          kappa: cohenKappa(
            shared.map((s) => s.a),
            shared.map((s) => s.b)
          ),
        });
      }
    }
  }

  return (
    <main className="dashboard">
      <h1>Dashboard</h1>
      <p className="subtitle">BurnettBench · Human Validation · live</p>

      {fetchError && (
        <p className="error">Fetch error: {fetchError}</p>
      )}

      <div className="stats-row">
        <StatBox label="Total ratings" value={totalRatings.toString()} />
        <StatBox label="Graders" value={nGraders.toString()} />
        <StatBox label="A / B / C" value={nABC.toString()} />
        <StatBox label="Flags (D)" value={nFlags.toString()} />
        <StatBox label="Skips" value={nSkips.toString()} />
      </div>

      <h2>Per-grader progress</h2>
      {perGrader.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No graders yet.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Grader</th>
              <th>Rated</th>
              <th>A/B/C</th>
              <th>Flagged</th>
              <th>Skipped</th>
              <th>Avg s/item</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {perGrader.map((g) => (
              <tr key={g.name}>
                <td>{g.name}</td>
                <td>
                  <strong>{g.total}</strong> / 300{" "}
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    ({Math.round((g.total / 300) * 100)}%)
                  </span>
                </td>
                <td>{g.abc}</td>
                <td>{g.flagged}</td>
                <td>{g.skipped}</td>
                <td>{g.avgSec ? g.avgSec.toFixed(1) : "—"}</td>
                <td style={{ color: "var(--muted)", fontSize: 11 }}>
                  {g.last ? new Date(g.last).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Verdict distribution</h2>
      <div className="dist-grid">
        <DistBar label="A — Correct" count={dist.A} total={totalRatings} judge={judgeDist.A} />
        <DistBar label="B — Confidently wrong" count={dist.B} total={totalRatings} judge={judgeDist.B} />
        <DistBar label="C — Not addressed" count={dist.C} total={totalRatings} judge={judgeDist.C} />
        <DistBar label="D — Flag ground truth" count={dist.FLAG} total={totalRatings} judge={null} />
        <DistBar label="S — Skip" count={dist.SKIP} total={totalRatings} judge={null} />
      </div>

      <h2>Coverage of 300 items</h2>
      <div className="stats-row">
        <StatBox label="0 ratings" value={cov0.toString()} />
        <StatBox label="1 rating" value={cov1.toString()} />
        <StatBox label="2 ratings" value={cov2.toString()} />
        <StatBox label="3+ ratings" value={cov3p.toString()} />
      </div>

      <h2>Agreement with GPT-4o-mini judge (Cohen's κ)</h2>
      {judgeVsGrader.filter((j) => j.n > 0).length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>Need at least one A/B/C rating per grader.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Grader</th>
              <th>Shared items</th>
              <th>Raw agreement</th>
              <th>Cohen's κ</th>
            </tr>
          </thead>
          <tbody>
            {judgeVsGrader
              .filter((j) => j.n > 0)
              .map((j) => (
                <tr key={j.name}>
                  <td>{j.name}</td>
                  <td>{j.n}</td>
                  <td>
                    {j.agree} / {j.n}{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      ({Math.round((j.agree / j.n) * 100)}%)
                    </span>
                  </td>
                  <td>
                    <strong>{j.kappa.toFixed(3)}</strong>{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      {kappaLabel(j.kappa)}
                    </span>
                  </td>
                </tr>
              ))}
            {majKappa !== null && (
              <tr style={{ borderTop: "2px solid var(--line)" }}>
                <td>
                  <strong>Human majority vs judge</strong>
                </td>
                <td>{majPairs.length}</td>
                <td>
                  {majPairs.filter((p) => p.h === p.j).length} / {majPairs.length}
                </td>
                <td>
                  <strong>{majKappa.toFixed(3)}</strong>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    {kappaLabel(majKappa)}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h2>Pairwise inter-rater agreement</h2>
      {pairwise.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>Need at least 2 graders with shared items.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Grader 1</th>
              <th>Grader 2</th>
              <th>Shared items</th>
              <th>Cohen's κ</th>
            </tr>
          </thead>
          <tbody>
            {pairwise.map((p, i) => (
              <tr key={i}>
                <td>{p.g1}</td>
                <td>{p.g2}</td>
                <td>{p.n}</td>
                <td>
                  <strong>{p.kappa.toFixed(3)}</strong>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    {kappaLabel(p.kappa)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="footer">
        Refresh for live data · {new Date().toLocaleString()}
      </p>
    </main>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-box">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function DistBar({
  label,
  count,
  total,
  judge,
}: {
  label: string;
  count: number;
  total: number;
  judge: number | null;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const judgePct = judge !== null ? (judge / 300) * 100 : null;
  return (
    <div className="dist-row">
      <div className="dist-label">{label}</div>
      <div className="dist-bar">
        <div className="dist-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="dist-text">
        <strong>{count}</strong>{" "}
        <span style={{ color: "var(--muted)" }}>({pct.toFixed(1)}%)</span>
        {judgePct !== null && (
          <span style={{ color: "var(--muted)", marginLeft: 10, fontSize: 11 }}>
            judge: {judge} ({judgePct.toFixed(1)}%)
          </span>
        )}
      </div>
    </div>
  );
}

function kappaLabel(k: number): string {
  if (k >= 0.8) return "almost perfect";
  if (k >= 0.6) return "substantial";
  if (k >= 0.4) return "moderate";
  if (k >= 0.2) return "fair";
  if (k > 0) return "slight";
  return "poor";
}
