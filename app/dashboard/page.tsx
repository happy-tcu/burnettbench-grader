import { cohenKappa, majority, bootstrapKappaCI, confusionMatrix } from "@/lib/kappa";
import { verifySession } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BarGroup, KappaBars, Heatmap3x3, TimelineChart } from "./charts";

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
type Question = {
  id: string;
  institution: string;
  model: string;
  condition: string;
  category: string | null;
};

async function fetchAll(url: string, key: string, table: string): Promise<unknown[]> {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=5000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

export default async function Dashboard() {
  const jar = await cookies();
  const session = jar.get("bb_dash")?.value;
  if (!verifySession(session)) {
    redirect("/dashboard/login");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let ratings: Rating[] = [];
  let judges: Judge[] = [];
  let questions: Question[] = [];
  let fetchError: string | null = null;
  try {
    [ratings, judges, questions] = (await Promise.all([
      fetchAll(url, svc, "ratings"),
      fetchAll(url, svc, "judge_verdicts"),
      fetchAll(url, svc, "questions"),
    ])) as [Rating[], Judge[], Question[]];
  } catch (e) {
    fetchError = String(e);
  }

  const questionMap = new Map(questions.map((q) => [q.id, q]));

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
  const majCI =
    majPairs.length >= 10
      ? bootstrapKappaCI(
          majPairs.map((p) => p.h),
          majPairs.map((p) => p.j)
        )
      : null;
  const majConfusion =
    majPairs.length > 0
      ? confusionMatrix(
          majPairs.map((p) => p.h),
          majPairs.map((p) => p.j)
        )
      : null;

  // --- Per-institution agreement (human majority vs judge) ---
  const institutions = Array.from(new Set(questions.map((q) => q.institution))).sort();
  const perInstitution = institutions.map((inst) => {
    const subset = majPairs.filter((p, i) => {
      const vid = Array.from(perItem.keys())[i]; // approximate: use index-aligned
      return vid && questionMap.get(vid)?.institution === inst;
    });
    // Rebuild properly from scratch to avoid index drift
    const ids: string[] = [];
    for (const [vid] of perItem) ids.push(vid);
    const instIds = ids.filter((vid) => questionMap.get(vid)?.institution === inst);
    const pairs: { h: string; j: string }[] = [];
    for (const vid of instIds) {
      const votes = perItem.get(vid)!;
      if (votes.length < 2) continue;
      const { verdict, tied } = majority(votes);
      if (tied || !verdict) continue;
      const j = judgeMap.get(vid);
      if (!j) continue;
      pairs.push({ h: verdict, j });
    }
    const k = pairs.length ? cohenKappa(pairs.map((p) => p.h), pairs.map((p) => p.j)) : null;
    const agree = pairs.filter((p) => p.h === p.j).length;
    return { inst, n: pairs.length, kappa: k, agree };
  });

  // --- Per-model agreement (human majority vs judge) ---
  const modelSet = Array.from(new Set(questions.map((q) => q.model))).sort();
  const perModel = modelSet.map((model) => {
    const ids: string[] = [];
    for (const [vid] of perItem) ids.push(vid);
    const mdIds = ids.filter((vid) => questionMap.get(vid)?.model === model);
    const pairs: { h: string; j: string }[] = [];
    for (const vid of mdIds) {
      const votes = perItem.get(vid)!;
      if (votes.length < 2) continue;
      const { verdict, tied } = majority(votes);
      if (tied || !verdict) continue;
      const j = judgeMap.get(vid);
      if (!j) continue;
      pairs.push({ h: verdict, j });
    }
    const k = pairs.length ? cohenKappa(pairs.map((p) => p.h), pairs.map((p) => p.j)) : null;
    const agree = pairs.filter((p) => p.h === p.j).length;
    return { model, n: pairs.length, kappa: k, agree };
  });

  // --- Flagged items audit (which items are being flagged, and by whom) ---
  const flagsByItem = new Map<string, string[]>();
  for (const r of ratings) {
    if (r.human_verdict !== "FLAG") continue;
    if (!flagsByItem.has(r.verdict_id)) flagsByItem.set(r.verdict_id, []);
    flagsByItem.get(r.verdict_id)!.push(r.grader_name);
  }
  const flagRows = Array.from(flagsByItem.entries())
    .map(([vid, graders]) => {
      const q = questionMap.get(vid);
      return {
        vid,
        graders,
        institution: q?.institution ?? "?",
        model: q?.model ?? "?",
        condition: q?.condition ?? "?",
      };
    })
    .sort((a, b) => b.graders.length - a.graders.length);

  const flagsByInstitution = new Map<string, number>();
  for (const inst of institutions) flagsByInstitution.set(inst, 0);
  for (const [vid] of flagsByItem) {
    const q = questionMap.get(vid);
    if (q) flagsByInstitution.set(q.institution, (flagsByInstitution.get(q.institution) ?? 0) + 1);
  }

  // --- Grader fatigue: rolling avg seconds per item (first third vs last third) ---
  const fatigue = perGrader.map((g) => {
    const myRatings = ratings
      .filter(
        (r) =>
          r.grader_name === g.name &&
          ["A", "B", "C"].includes(r.human_verdict) &&
          typeof r.rating_ms === "number"
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (myRatings.length < 15) return { name: g.name, first: null, last: null, delta: null };
    const third = Math.floor(myRatings.length / 3);
    const first = myRatings.slice(0, third);
    const last = myRatings.slice(myRatings.length - third);
    const avg = (xs: Rating[]) =>
      xs.reduce((s, r) => s + (r.rating_ms ?? 0), 0) / xs.length / 1000;
    const firstAvg = avg(first);
    const lastAvg = avg(last);
    return {
      name: g.name,
      first: firstAvg,
      last: lastAvg,
      delta: lastAvg - firstAvg,
      total: myRatings.length,
    };
  });

  // --- Time-to-completion estimate per grader ---
  const eta = perGrader.map((g) => {
    const myRatings = ratings.filter((r) => r.grader_name === g.name);
    if (myRatings.length < 5) return { name: g.name, remaining: 300 - myRatings.length, etaMin: null };
    const times = myRatings
      .map((r) => r.rating_ms)
      .filter((x): x is number => typeof x === "number");
    const avgSec = times.length ? times.reduce((a, b) => a + b, 0) / times.length / 1000 : 20;
    const remaining = 300 - myRatings.length;
    return { name: g.name, remaining, etaMin: Math.round((remaining * avgSec) / 60) };
  });

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

      <h2>Verdict distribution · humans vs GPT-4o-mini</h2>
      <div className="card chart-card">
        <BarGroup
          bars={[
            { label: "A", value: dist.A, second: judgeDist.A },
            { label: "B", value: dist.B, second: judgeDist.B },
            { label: "C", value: dist.C, second: judgeDist.C },
            { label: "D (flag)", value: dist.FLAG, color: "#c8102e" },
            { label: "S (skip)", value: dist.SKIP, color: "#999" },
          ]}
        />
      </div>
      <div className="dist-grid">
        <DistBar label="A — Correct" count={dist.A} total={totalRatings} judge={judgeDist.A} />
        <DistBar label="B — Confidently wrong" count={dist.B} total={totalRatings} judge={judgeDist.B} />
        <DistBar label="C — Not addressed" count={dist.C} total={totalRatings} judge={judgeDist.C} />
        <DistBar label="D — Flag ground truth" count={dist.FLAG} total={totalRatings} judge={null} />
        <DistBar label="S — Skip" count={dist.SKIP} total={totalRatings} judge={null} />
      </div>

      {ratings.length >= 5 && (
        <>
          <h2>Ratings over time</h2>
          <div className="card chart-card">
            <TimelineChart
              points={(() => {
                const perG = new Map<string, { t: number; value: number }[]>();
                for (const g of graderNames) perG.set(g, []);
                const sorted = [...ratings].sort((a, b) =>
                  a.created_at.localeCompare(b.created_at)
                );
                const counts: Record<string, number> = {};
                const pts: { t: number; value: number; grader: string }[] = [];
                for (const r of sorted) {
                  counts[r.grader_name] = (counts[r.grader_name] ?? 0) + 1;
                  pts.push({
                    t: new Date(r.created_at).getTime(),
                    value: counts[r.grader_name],
                    grader: r.grader_name,
                  });
                }
                return pts;
              })()}
            />
          </div>
        </>
      )}

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
                  {majCI && !isNaN(majCI.low) && (
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      95% CI [{majCI.low.toFixed(2)}, {majCI.high.toFixed(2)}]
                    </span>
                  )}
                  <br />
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

      {majConfusion && majPairs.length > 0 && (
        <>
          <h2>Confusion matrix · human majority × judge</h2>
          <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
            Rows: what humans voted. Columns: what GPT-4o-mini said. Diagonal cells are agreements;
            off-diagonal are the specific disagreements. Patterns here tell the paper's story.
          </p>
          <div className="card chart-card" style={{ display: "flex", justifyContent: "center" }}>
            <Heatmap3x3 matrix={majConfusion} />
          </div>
          <table className="dash-table confusion">
            <thead>
              <tr>
                <th></th>
                <th>Judge: A</th>
                <th>Judge: B</th>
                <th>Judge: C</th>
                <th>Row total</th>
              </tr>
            </thead>
            <tbody>
              {["A", "B", "C"].map((row, i) => {
                const rowTotal = majConfusion[i].reduce((s, v) => s + v, 0);
                return (
                  <tr key={row}>
                    <td>
                      <strong>Human: {row}</strong>
                    </td>
                    {[0, 1, 2].map((j) => (
                      <td
                        key={j}
                        className={i === j ? "confusion-diag" : "confusion-off"}
                      >
                        <strong>{majConfusion[i][j]}</strong>
                      </td>
                    ))}
                    <td style={{ color: "var(--muted)" }}>{rowTotal}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ color: "var(--muted)" }}>Col total</td>
                {[0, 1, 2].map((j) => (
                  <td key={j} style={{ color: "var(--muted)" }}>
                    {majConfusion.reduce((s, row) => s + row[j], 0)}
                  </td>
                ))}
                <td style={{ color: "var(--muted)" }}>{majPairs.length}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <h2>Agreement by institution</h2>
      {perInstitution.filter((p) => p.n > 0).length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>Need ≥2 raters per item in each institution.</p>
        </div>
      ) : (
        <>
          <div className="card chart-card">
            <KappaBars
              bars={perInstitution
                .filter((p) => p.n > 0 && p.kappa !== null)
                .map((p) => ({ label: p.inst, kappa: p.kappa!, n: p.n }))}
            />
          </div>
          <table className="dash-table">
          <thead>
            <tr>
              <th>Institution</th>
              <th>Items with ≥2 raters</th>
              <th>Raw agreement</th>
              <th>Cohen's κ</th>
            </tr>
          </thead>
          <tbody>
            {perInstitution
              .filter((p) => p.n > 0)
              .map((p) => (
                <tr key={p.inst}>
                  <td>{p.inst}</td>
                  <td>{p.n}</td>
                  <td>
                    {p.agree} / {p.n}{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      ({Math.round((p.agree / p.n) * 100)}%)
                    </span>
                  </td>
                  <td>
                    <strong>{p.kappa !== null ? p.kappa.toFixed(3) : "—"}</strong>{" "}
                    {p.kappa !== null && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {kappaLabel(p.kappa)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </>
      )}

      <h2>Agreement by model</h2>
      {perModel.filter((p) => p.n > 0).length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>Need ≥2 raters per item.</p>
        </div>
      ) : (
        <>
          <div className="card chart-card">
            <KappaBars
              bars={perModel
                .filter((p) => p.n > 0 && p.kappa !== null)
                .map((p) => ({ label: p.model, kappa: p.kappa!, n: p.n }))}
            />
          </div>
          <table className="dash-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Items with ≥2 raters</th>
              <th>Raw agreement</th>
              <th>Cohen's κ</th>
            </tr>
          </thead>
          <tbody>
            {perModel
              .filter((p) => p.n > 0)
              .map((p) => (
                <tr key={p.model}>
                  <td>{p.model}</td>
                  <td>{p.n}</td>
                  <td>
                    {p.agree} / {p.n}{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      ({Math.round((p.agree / p.n) * 100)}%)
                    </span>
                  </td>
                  <td>
                    <strong>{p.kappa !== null ? p.kappa.toFixed(3) : "—"}</strong>{" "}
                    {p.kappa !== null && (
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {kappaLabel(p.kappa)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        </>
      )}

      <h2>Flagged ground-truth items ({flagRows.length})</h2>
      <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 12 }}>
        Items a grader marked with D. Review these facts manually; if the fact itself is wrong or
        unverifiable, exclude the item from the final κ computation.
      </p>
      {flagRows.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No flags yet.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Item ID</th>
              <th>Institution</th>
              <th>Model</th>
              <th>Condition</th>
              <th>Flagged by (n)</th>
            </tr>
          </thead>
          <tbody>
            {flagRows.map((f) => (
              <tr key={f.vid}>
                <td style={{ fontFamily: "ui-monospace, monospace" }}>{f.vid}</td>
                <td>{f.institution}</td>
                <td>{f.model}</td>
                <td>{f.condition}</td>
                <td>
                  <strong>{f.graders.length}</strong>{" "}
                  <span style={{ color: "var(--muted)", fontSize: 11 }}>
                    ({f.graders.join(", ")})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {Array.from(flagsByInstitution.entries()).some(([, n]) => n > 0) && (
        <>
          <h2>Flag rate by institution</h2>
          <div className="stats-row">
            {Array.from(flagsByInstitution.entries()).map(([inst, n]) => (
              <StatBox
                key={inst}
                label={inst}
                value={`${n} / ${questions.filter((q) => q.institution === inst).length}`}
              />
            ))}
          </div>
        </>
      )}

      <h2>Grader fatigue (first-third vs last-third avg sec/item)</h2>
      {fatigue.filter((f) => f.first !== null).length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>Need ≥15 ratings per grader to detect fatigue.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Grader</th>
              <th>First third (s)</th>
              <th>Last third (s)</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {fatigue
              .filter((f) => f.first !== null)
              .map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>{f.first!.toFixed(1)}</td>
                  <td>{f.last!.toFixed(1)}</td>
                  <td
                    style={{
                      color: (f.delta ?? 0) > 2 ? "var(--red)" : (f.delta ?? 0) < -2 ? "var(--green)" : "var(--fg)",
                    }}
                  >
                    {(f.delta ?? 0) > 0 ? "+" : ""}
                    {f.delta!.toFixed(1)}s{" "}
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      ({(f.delta ?? 0) > 2 ? "slowing" : (f.delta ?? 0) < -2 ? "speeding up" : "stable"})
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <h2>Time to completion</h2>
      {eta.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No active graders yet.</p>
        </div>
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Grader</th>
              <th>Done</th>
              <th>Remaining</th>
              <th>ETA at current pace</th>
            </tr>
          </thead>
          <tbody>
            {eta.map((e) => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td>{300 - e.remaining} / 300</td>
                <td>{e.remaining}</td>
                <td>
                  {e.etaMin !== null ? (
                    <strong>
                      {e.etaMin >= 60
                        ? `${Math.floor(e.etaMin / 60)}h ${e.etaMin % 60}m`
                        : `${e.etaMin}m`}
                    </strong>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>need ≥5 ratings</span>
                  )}
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
