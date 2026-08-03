/**
 * Pin-a-run support: merge a live run and a pinned (ghost) run onto ONE
 * uPlot-aligned x axis — the union of both time grids, each series
 * null-filled where its run has no sample. Ghost series render with
 * spanGaps so the nulls just bridge; the live series get spanGaps too
 * while a ghost is shown.
 */

export interface AlignedMerge {
  t: number[];
  live: (number | null)[][];
  ghost: (number | null)[][];
}

/** Both time arrays must be ascending (chart history is appended in order). */
export function mergeAligned(
  liveT: number[],
  liveSeries: number[][],
  ghostT: number[],
  ghostSeries: number[][],
): AlignedMerge {
  const t: number[] = [];
  const liveIdx: number[] = [];
  const ghostIdx: number[] = [];
  let i = 0;
  let j = 0;
  while (i < liveT.length || j < ghostT.length) {
    const a = i < liveT.length ? liveT[i] : Infinity;
    const b = j < ghostT.length ? ghostT[j] : Infinity;
    if (a < b) {
      t.push(a);
      liveIdx.push(i++);
      ghostIdx.push(-1);
    } else if (b < a) {
      t.push(b);
      liveIdx.push(-1);
      ghostIdx.push(j++);
    } else {
      t.push(a);
      liveIdx.push(i++);
      ghostIdx.push(j++);
    }
  }
  const pick = (series: number[][], idx: number[]): (number | null)[][] =>
    series.map((s) => idx.map((k) => (k >= 0 ? s[k] : null)));
  return { t, live: pick(liveSeries, liveIdx), ghost: pick(ghostSeries, ghostIdx) };
}
