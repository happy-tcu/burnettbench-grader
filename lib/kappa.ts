/**
 * Cohen's kappa for nominal (A/B/C) ratings.
 * Returns κ, with a graceful 0 when there's no variance.
 */
export function cohenKappa(
  a: string[],
  b: string[],
  categories: string[] = ["A", "B", "C"]
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  const idx = new Map(categories.map((c, i) => [c, i]));
  const k = categories.length;

  // Confusion matrix
  const mat: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const ia = idx.get(a[i]);
    const ib = idx.get(b[i]);
    if (ia === undefined || ib === undefined) continue;
    mat[ia][ib] += 1;
  }

  // Observed agreement
  let po = 0;
  for (let i = 0; i < k; i++) po += mat[i][i];
  po /= n;

  // Expected agreement (chance)
  const rowSum = mat.map((row) => row.reduce((s, v) => s + v, 0));
  const colSum = Array(k).fill(0);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) colSum[j] += mat[i][j];

  let pe = 0;
  for (let i = 0; i < k; i++) pe += (rowSum[i] / n) * (colSum[i] / n);

  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

export function majority(verdicts: string[]): { verdict: string | null; tied: boolean } {
  const counts: Record<string, number> = {};
  for (const v of verdicts) counts[v] = (counts[v] ?? 0) + 1;
  const entries = Object.entries(counts);
  if (!entries.length) return { verdict: null, tied: false };
  entries.sort((x, y) => y[1] - x[1]);
  const top = entries[0];
  const tied = entries.length > 1 && entries[1][1] === top[1];
  return { verdict: top[0], tied };
}
