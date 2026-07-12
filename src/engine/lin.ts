/**
 * Linear algebra for the Newton solves: reverse Cuthill-McKee ordering +
 * banded LU without pivoting.
 *
 * The Jacobian has graph-Laplacian structure (network edges) plus pump
 * inlet↔backing coupling blocks; it is strongly diagonally dominant for the
 * backward-Euler system in u = ln p, so factorization without pivoting is
 * stable. Vacuum systems are chain-dominated graphs, so RCM yields a small
 * bandwidth and the O(n·k²) banded factorization stays fast up to the ~2000
 * node cap.
 */

/** Reverse Cuthill-McKee: returns perm where perm[newIdx] = oldIdx. */
export function rcmOrder(n: number, adjacency: number[][]): Int32Array {
  const degree = adjacency.map((a) => a.length);
  const visited = new Uint8Array(n);
  const order: number[] = [];
  // handle disconnected components: start each from its min-degree node
  while (order.length < n) {
    let start = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && degree[i] < best) {
        best = degree[i];
        start = i;
      }
    }
    const queue = [start];
    visited[start] = 1;
    while (queue.length) {
      const v = queue.shift()!;
      order.push(v);
      const nbrs = adjacency[v].filter((w) => !visited[w]).sort((a, b) => degree[a] - degree[b]);
      for (const w of nbrs) {
        visited[w] = 1;
        queue.push(w);
      }
    }
  }
  order.reverse();
  return Int32Array.from(order);
}

/**
 * Banded matrix, half-bandwidth k: entry (i,j) with |i-j| <= k stored at
 * data[i*(2k+1) + (j-i+k)].
 */
export class BandMatrix {
  readonly n: number;
  readonly k: number;
  readonly stride: number;
  readonly data: Float64Array;

  constructor(n: number, k: number) {
    this.n = n;
    this.k = k;
    this.stride = 2 * k + 1;
    this.data = new Float64Array(n * this.stride);
  }

  zero(): void {
    this.data.fill(0);
  }

  add(i: number, j: number, v: number): void {
    this.data[i * this.stride + (j - i + this.k)] += v;
  }

  set(i: number, j: number, v: number): void {
    this.data[i * this.stride + (j - i + this.k)] = v;
  }

  get(i: number, j: number): number {
    if (Math.abs(i - j) > this.k) return 0;
    return this.data[i * this.stride + (j - i + this.k)];
  }

  /**
   * Row-equilibrate: divide each row (and the matching rhs entry) by its max
   * |entry|. The Newton rows scale like dt/(V·p_i), which spans tens of
   * decades across a system; equilibration keeps the no-pivot elimination
   * from overflowing without changing the solution.
   */
  equilibrate(rhs: Float64Array): void {
    const { n, k, stride, data } = this;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const lo = Math.max(0, i - k);
      const hi = Math.min(n - 1, i + k);
      for (let j = lo; j <= hi; j++) {
        const a = Math.abs(data[i * stride + (j - i + k)]);
        if (a > m) m = a;
      }
      if (m > 0 && Number.isFinite(m)) {
        const inv = 1 / m;
        for (let j = lo; j <= hi; j++) data[i * stride + (j - i + k)] *= inv;
        rhs[i] *= inv;
      }
    }
  }

  /** In-place LU factorization without pivoting. Returns false on a ~zero pivot. */
  factor(): boolean {
    const { n, k, stride, data } = this;
    for (let j = 0; j < n; j++) {
      const piv = data[j * stride + k];
      if (!Number.isFinite(piv) || Math.abs(piv) < 1e-300) return false;
      const iMax = Math.min(n - 1, j + k);
      for (let i = j + 1; i <= iMax; i++) {
        const m = data[i * stride + (j - i + k)] / piv;
        data[i * stride + (j - i + k)] = m;
        if (m !== 0) {
          const lMax = Math.min(n - 1, j + k);
          for (let l = j + 1; l <= lMax; l++) {
            data[i * stride + (l - i + k)] -= m * data[j * stride + (l - j + k)];
          }
        }
      }
    }
    return true;
  }

  /** Solve LUx = b in place (b is overwritten with x). Call factor() first. */
  solve(b: Float64Array): void {
    const { n, k, stride, data } = this;
    // forward: L has unit diagonal
    for (let i = 0; i < n; i++) {
      const jMin = Math.max(0, i - k);
      let s = b[i];
      for (let j = jMin; j < i; j++) s -= data[i * stride + (j - i + k)] * b[j];
      b[i] = s;
    }
    // backward
    for (let i = n - 1; i >= 0; i--) {
      const jMax = Math.min(n - 1, i + k);
      let s = b[i];
      for (let j = i + 1; j <= jMax; j++) s -= data[i * stride + (j - i + k)] * b[j];
      b[i] = s / data[i * stride + k];
    }
  }
}
