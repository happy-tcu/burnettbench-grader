"""
Compute Cohen's kappa and Krippendorff's alpha from Supabase ratings.

Usage:
    export SUPABASE_URL="https://xxxxx.supabase.co"
    export SUPABASE_SERVICE_KEY="eyJ...service_role..."
    python analysis/compute_kappa.py

Reports:
  - Inter-rater agreement across human graders (Krippendorff's alpha, pairwise Cohen's kappa)
  - Agreement between human majority verdict and GPT-4o-mini judge (Cohen's kappa)

Requires: pip install supabase pandas scikit-learn krippendorff
"""

import os
import json
import sys
from collections import defaultdict
from itertools import combinations

try:
    from supabase import create_client
    import pandas as pd
    from sklearn.metrics import cohen_kappa_score, confusion_matrix
except ImportError as e:
    print(f"Missing dep: {e}. Run: pip install supabase pandas scikit-learn krippendorff", file=sys.stderr)
    sys.exit(1)

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")
if not url or not key:
    print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars.", file=sys.stderr)
    sys.exit(1)

client = create_client(url, key)
rows = client.table("ratings").select("*").execute().data
if not rows:
    print("No ratings yet.")
    sys.exit(0)

df_all = pd.DataFrame(rows)
print(f"Loaded {len(df_all)} total ratings from {df_all['grader_name'].nunique()} graders.")
print(f"Graders: {sorted(df_all['grader_name'].unique())}")

# Ground-truth flag audit: how often did graders flag the ground truth as suspect?
n_flag = (df_all["human_verdict"] == "FLAG").sum()
n_skip = (df_all["human_verdict"] == "SKIP").sum()
n_total = len(df_all)
print(f"\nGround-truth flag rate: {n_flag}/{n_total} = {100*n_flag/n_total:.1f}%  (healthy: <5%)")
print(f"Skip rate:              {n_skip}/{n_total} = {100*n_skip/n_total:.1f}%")

flagged_ids = set(df_all[df_all["human_verdict"] == "FLAG"]["verdict_id"].unique())
if flagged_ids:
    print(f"\nFlagged verdict IDs (removed from kappa calc): {sorted(flagged_ids)[:10]}{'...' if len(flagged_ids)>10 else ''}")

# For kappa: keep only A/B/C, exclude any item that any grader flagged
df = df_all[
    df_all["human_verdict"].isin(["A", "B", "C"])
    & ~df_all["verdict_id"].isin(flagged_ids)
].copy()
print(f"\nRatings used for kappa (A/B/C, non-flagged items): {len(df)}")
print()

# Load the private sample with judge verdicts
sample_path = os.path.join(os.path.dirname(__file__), "..", "private", "sample_with_verdicts.json")
with open(sample_path) as f:
    sample = {s["id"]: s for s in json.load(f)}

df["judge_verdict"] = df["verdict_id"].map(lambda x: sample.get(x, {}).get("judge_verdict"))

# ---- Inter-rater agreement ----
graders = sorted(df["grader_name"].unique())
print("=" * 60)
print("INTER-RATER AGREEMENT (Cohen's kappa, pairwise)")
print("=" * 60)
pairs = list(combinations(graders, 2))
if not pairs:
    print("Need at least 2 graders for inter-rater kappa.")
else:
    for g1, g2 in pairs:
        merged = df[df["grader_name"] == g1].merge(
            df[df["grader_name"] == g2], on="verdict_id", suffixes=("_1", "_2")
        )
        if len(merged) == 0:
            continue
        k = cohen_kappa_score(merged["human_verdict_1"], merged["human_verdict_2"])
        print(f"  {g1} vs {g2}: κ = {k:.3f}  (n={len(merged)} shared items)")

# Krippendorff's alpha (requires krippendorff package)
try:
    import krippendorff
    # Reshape: rows = raters, columns = items
    pivot = df.pivot_table(
        index="grader_name", columns="verdict_id", values="human_verdict", aggfunc="first"
    )
    # Map A/B/C to 0/1/2 for nominal
    code = {"A": 0, "B": 1, "C": 2}
    coded = pivot.map(lambda x: code[x] if isinstance(x, str) else None).to_numpy()
    alpha = krippendorff.alpha(reliability_data=coded, level_of_measurement="nominal")
    print(f"\nKrippendorff's α (nominal, all graders): {alpha:.3f}")
except ImportError:
    print("\n(install `krippendorff` for Krippendorff's alpha)")

# ---- Judge vs human majority ----
print()
print("=" * 60)
print("JUDGE (GPT-4o-mini) vs HUMAN MAJORITY (Cohen's kappa)")
print("=" * 60)

def majority(verdicts):
    counts = {"A": 0, "B": 0, "C": 0}
    for v in verdicts:
        counts[v] += 1
    best = max(counts, key=counts.get)
    # tie → mark ambiguous
    tied = sum(1 for v in counts.values() if v == counts[best]) > 1
    return best, tied

human_majorities = {}
for vid, group in df.groupby("verdict_id"):
    verdicts = group["human_verdict"].tolist()
    maj, tied = majority(verdicts)
    human_majorities[vid] = (maj, tied, len(verdicts))

mdf = pd.DataFrame(
    [
        {
            "verdict_id": vid,
            "human_majority": maj,
            "tied": tied,
            "n_raters": n,
            "judge_verdict": sample.get(vid, {}).get("judge_verdict"),
        }
        for vid, (maj, tied, n) in human_majorities.items()
    ]
)
mdf = mdf[mdf["judge_verdict"].notna() & (mdf["n_raters"] >= 2) & (~mdf["tied"])]
print(f"Items with ≥2 raters and non-tied human majority: {len(mdf)}")
if len(mdf) >= 10:
    k = cohen_kappa_score(mdf["human_majority"], mdf["judge_verdict"])
    print(f"\n  Cohen's κ (judge vs human majority): {k:.3f}")
    print("  Guidelines: >0.6 substantial · >0.4 moderate · <0.4 fair/poor\n")
    print("  Confusion matrix (rows = human majority, cols = judge):")
    cm = confusion_matrix(mdf["human_majority"], mdf["judge_verdict"], labels=["A", "B", "C"])
    print("          A    B    C")
    for lab, row in zip(["A", "B", "C"], cm):
        print(f"    {lab}   {row[0]:3d}  {row[1]:3d}  {row[2]:3d}")
else:
    print("  (need ≥10 non-tied items with ≥2 raters each)")

print()
print("Done.")
