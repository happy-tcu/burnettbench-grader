# BurnettBench — Human Validation App

Minimal Next.js app for collecting human verdicts to validate the GPT-4o-mini judge used in
**BurnettBench Study 2 — Scope Coverage Effects in llms.txt V2** (Niyorurema & Estella, 2026).

Deploys to Vercel, writes to Supabase, zero backend to maintain.

## How it works

- `/public/sample.json` — 120 stratified-sampled items (institution × judge verdict × model), **judge verdict blinded**
- `/private/sample_with_verdicts.json` — same items with the judge verdict, **kept local**, used for post-hoc κ
- Graders see probe + fact + model response → press A / B / C / S → rating written to Supabase `ratings` table
- Progress saved per-grader in `localStorage` → graders can pause and resume

## Setup — 15 minutes end-to-end

### 1. Supabase (5 min)

1. Create a free account at https://supabase.com and start a new project.
2. SQL Editor → paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. Settings → API → copy the **Project URL** and the **anon public key**.
4. (For post-hoc analysis only) copy the **service_role** key — this stays local, never commit.

### 2. Local dev (5 min)

```bash
cd burnettbench-grader
pnpm install  # or npm/yarn
cp .env.example .env.local
# edit .env.local with your Supabase URL + anon key
pnpm dev
```

Open http://localhost:3000, grade a few items, confirm they appear in Supabase Table Editor.

### 3. Deploy to Vercel (5 min)

```bash
# From GitHub:
# 1. Push this repo to GitHub (e.g., github.com/happy-tcu/burnettbench-grader)
# 2. Go to vercel.com → New Project → import from GitHub
# 3. Framework: Next.js (auto-detected)
# 4. Environment Variables — add:
#      NEXT_PUBLIC_SUPABASE_URL=...
#      NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# 5. Deploy
```

Or from CLI:

```bash
pnpm add -g vercel
vercel --prod
# follow the prompts; set env vars when asked
```

### 4. Send the link to graders

Target: 3 graders × 120 items. Each takes ~45–60 min. Email template below.

## Computing κ

Once you have ≥60 shared items with ≥2 ratings:

```bash
cd analysis
pip install supabase pandas scikit-learn krippendorff
export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ...service_role..."
python compute_kappa.py
```

Reports:
- Pairwise Cohen's κ between every pair of graders
- Krippendorff's α across all graders (nominal)
- Cohen's κ between human majority verdict and GPT-4o-mini judge
- Confusion matrix (human majority × judge)

## Grader email template

> **Subject:** 45-minute favor — help validate an AI judge for a research paper
>
> Hi [name],
>
> I'm finalizing a paper on the `llms.txt` web standard. Reviewers will ask whether the automated
> judge (GPT-4o-mini) agrees with human graders. I'd love your help validating that.
>
> It's a web form, 120 short items, A/B/C buttons, keyboard shortcuts. Takes ~45–60 minutes total
> and you can pause and resume (progress is saved in your browser).
>
> Link: https://burnettbench-grader.vercel.app
>
> If you're in: aim to finish within the next 7 days. If not, no worries — just reply so I can ask
> someone else.
>
> Thank you,
> Happy

## License

MIT. Study data (sampled from the main BurnettBench repo) under CC BY 4.0.

Related:
- Main repo: https://github.com/happy-tcu/burnettbench
- Model checkpoints: https://huggingface.co/hniyorurema/burnettbench-scope-classifiers
