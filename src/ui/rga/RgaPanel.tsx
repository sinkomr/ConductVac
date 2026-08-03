import { useRef, useState } from 'react';
import { PART_BY_ID } from '../../data/fittings';
import { RGA_MAX_MZ, buildSpectrum } from '../../data/cracking';
import { formatPressure, nodePartials, nodePressures, useStore } from '../../store';

/**
 * Virtual residual gas analyzer: live m/z bar spectrum at the node an RGA
 * head part is bolted to. Log intensity, standard cracking patterns,
 * ionization-sensitivity weighting, filament interlock above 1e-4 Torr.
 */

const FLOOR = 1e-13;
const TRIP = 1e-4;

/** deterministic per-peak shimmer so the display breathes like the real thing */
const shimmer = (mz: number, tick: number): number => {
  let h = (mz * 7919 + (tick >> 2) * 104729) >>> 0;
  h = (h ^ (h >> 13)) * 0x5bd1e995;
  return 1 + (((h >>> 16) % 1000) / 1000 - 0.5) * 0.1;
};

export function RgaPanel() {
  const system = useStore((s) => s.system);
  const compiled = useStore((s) => s.compiled);
  const snapshot = useStore((s) => s.snapshot);
  const unit = useStore((s) => s.unit);
  const chartTick = useStore((s) => s.chartTick);
  const [sel, setSel] = useState<string | null>(null);
  // container-measured plot width so the spectrum fits phones (was fixed 740)
  const [panelW, setPanelW] = useState(740);
  const roRef = useRef<ResizeObserver | null>(null);
  const hostRef = (el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el) {
      const ro = new ResizeObserver(() =>
        setPanelW(Math.max(300, Math.min(900, el.clientWidth - 12))));
      ro.observe(el);
      roRef.current = ro;
    }
  };

  const rgas = system.parts.filter((p) => PART_BY_ID[p.def]?.kind === 'rga');
  if (rgas.length === 0) {
    return (
      <div className="hint pad">
        Place an <b>RGA head</b> (Gauges palette) on any port — splicing works too — then run
        the simulation to watch the mass spectrum.
      </div>
    );
  }
  const active = rgas.find((r) => r.id === sel) ?? rgas[0];
  const node = compiled?.regionNode[`${active.id}:0`] ?? compiled?.portNode[`${active.id}:0`];
  const partials = node ? nodePartials.get(node) : undefined;
  const total = node ? nodePressures.get(node) : undefined;
  if (!snapshot || !partials || total === undefined) {
    return <div className="hint pad">Run the simulation to see the spectrum.</div>;
  }

  const tripped = total > TRIP;
  const amp = buildSpectrum(snapshot.species, partials);
  let peak = 0;
  for (let m = 1; m <= RGA_MAX_MZ; m++) peak = Math.max(peak, amp[m]);
  const top = Math.max(peak * 2, 1e-9);
  const lTop = Math.log10(top);
  const lFloor = Math.log10(FLOOR);

  const W = panelW;
  const H = 190;
  const plotH = H - 28;
  const bw = W / (RGA_MAX_MZ + 1);
  // label the tallest few peaks
  const labeled = Array.from({ length: RGA_MAX_MZ }, (_, i) => i + 1)
    .filter((m) => amp[m] > FLOOR)
    .sort((a, b) => amp[b] - amp[a])
    .slice(0, 6);

  return (
    <div className="rga-panel" ref={hostRef}>
      <div className="chart-toolbar">
        {rgas.length > 1 && (
          <select value={active.id} onChange={(e) => setSel(e.target.value)}>
            {rgas.map((r) => <option key={r.id} value={r.id}>{r.id}</option>)}
          </select>
        )}
        <span>{active.id} · total {formatPressure(total, unit)}</span>
        {tripped && <span className="stale">filament off — inlet above {formatPressure(TRIP, unit)}</span>}
      </div>
      <svg width={W} height={H} className="rga-plot">
        {[-12, -10, -8, -6].map((d) => {
          const y = plotH - ((d - lFloor) / (lTop - lFloor)) * plotH;
          return y > 0 && y < plotH ? (
            <g key={d}>
              <line x1={0} x2={W} y1={y} y2={y} stroke="#2c3038" />
              <text x={4} y={y - 2} className="tiny">1e{d}</text>
            </g>
          ) : null;
        })}
        {!tripped && Array.from({ length: RGA_MAX_MZ }, (_, i) => i + 1).map((m) => {
          const a = amp[m] * shimmer(m, chartTick);
          if (a <= FLOOR) return null;
          const hFrac = Math.max(0, (Math.log10(a) - lFloor) / (lTop - lFloor));
          const bh = hFrac * plotH;
          return (
            <rect key={m} x={m * bw + 1} y={plotH - bh} width={bw - 2} height={bh}
              fill="#6ab0ff" opacity={0.9} />
          );
        })}
        {!tripped && labeled.map((m) => {
          const hFrac = Math.max(0, (Math.log10(amp[m]) - lFloor) / (lTop - lFloor));
          return (
            <text key={m} x={m * bw + bw / 2} y={plotH - hFrac * plotH - 4}
              textAnchor="middle" className="pvalue">{m}</text>
          );
        })}
        <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="#4a4f5a" />
        {[10, 20, 30, 40, 50].map((m) => (
          <text key={m} x={m * bw} y={H - 8} textAnchor="middle" className="tiny">{m}</text>
        ))}
      </svg>
      <div className="hint">
        m/z, log intensity (ionization-sensitivity weighted). H₂O cracks 18/17/16, N₂ → 28/14,
        CO₂ → 44/28/16/12 — peak 28 stacks N₂ + CO fragments exactly like a real quad.
      </div>
    </div>
  );
}
