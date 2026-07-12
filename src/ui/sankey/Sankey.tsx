import { useEffect } from 'react';
import { useStore } from '../../store';

/**
 * Gas-load flow view (§3.3): sources (leaks, outgassing by surface group,
 * permeation) → network → sinks (pumps), ribbon width ∝ throughput.
 * Answers "what limits my base pressure" at a glance.
 */
export function Sankey() {
  const flows = useStore((s) => s.flows);
  const simLoaded = useStore((s) => s.simLoaded);
  const bottomTab = useStore((s) => s.bottomTab);
  const chartTick = useStore((s) => s.chartTick);
  const st = useStore.getState;

  useEffect(() => {
    if (bottomTab === 'flow' && simLoaded && chartTick % 20 === 0) st().requestFlows();
  }, [bottomTab, simLoaded, chartTick, st]);
  useEffect(() => {
    if (bottomTab === 'flow' && simLoaded) st().requestFlows();
  }, [bottomTab, simLoaded, st]);

  if (!flows) {
    return (
      <div className="hint pad">
        Load and run a system, then open this tab to see where the gas load comes from and which
        pump removes it. <button className="btn" onClick={() => st().requestFlows()}>Compute now</button>
      </div>
    );
  }

  const W = 760;
  const sources = [...flows.sources].sort((a, b) => b.q - a.q).slice(0, 12);
  const sinks = [...flows.sinks].sort((a, b) => b.q - a.q).slice(0, 12);
  const totalS = sources.reduce((a, s) => a + s.q, 0) || 1e-30;
  const totalK = sinks.reduce((a, s) => a + s.q, 0) || 1e-30;
  const H = 190;
  const scaleS = H * 0.8 / totalS;
  const scaleK = H * 0.8 / totalK;

  let ys = 10;
  const srcBoxes = sources.map((s) => {
    const h = Math.max(3, s.q * scaleS);
    const box = { ...s, y: ys, h };
    ys += h + 6;
    return box;
  });
  let yk = 10;
  const sinkBoxes = sinks.map((s) => {
    const h = Math.max(3, s.q * scaleK);
    const box = { ...s, y: yk, h };
    yk += h + 6;
    return box;
  });
  const midY = Math.max(ys, yk) / 2;
  const fmt = (q: number) => `${q.toExponential(2)} Torr·L/s`;

  return (
    <div className="sankey-wrap">
      <svg width={W} height={Math.max(ys, yk, 120) + 10} className="sankey">
        {srcBoxes.map((s) => (
          <g key={s.id}>
            <path
              d={`M 200 ${s.y} C 300 ${s.y}, 320 ${midY - 15}, 380 ${midY - 15} L 380 ${midY + 15} C 320 ${midY + 15}, 300 ${s.y + s.h}, 200 ${s.y + s.h} Z`}
              fill={s.kind === 'leak' ? '#ff707055' : '#7bd88f55'}
            />
            <rect x={188} y={s.y} width={12} height={s.h} fill={s.kind === 'leak' ? '#ff7070' : '#7bd88f'} />
            <text x={182} y={s.y + s.h / 2 + 4} textAnchor="end" className="sankey-label">
              {s.label} · {fmt(s.q)}
            </text>
          </g>
        ))}
        <rect x={378} y={midY - 17} width={16} height={34} fill="#6ab0ff" rx={3} />
        <text x={386} y={midY + 34} textAnchor="middle" className="sankey-label">network</text>
        {sinkBoxes.map((s) => (
          <g key={s.id}>
            <path
              d={`M 394 ${midY - 15} C 450 ${midY - 15}, 470 ${s.y}, 560 ${s.y} L 560 ${s.y + s.h} C 470 ${s.y + s.h}, 450 ${midY + 15}, 394 ${midY + 15} Z`}
              fill="#6ab0ff44"
            />
            <rect x={560} y={s.y} width={12} height={s.h} fill="#6ab0ff" />
            <text x={578} y={s.y + s.h / 2 + 4} className="sankey-label">
              {s.label} · {fmt(s.q)}
            </text>
          </g>
        ))}
      </svg>
      <div className="hint">
        Sources {fmt(totalS)} · terminal removal {fmt(totalS - flows.imbalance)} · accumulation {fmt(flows.imbalance)} — computed at t = {flows.t.toFixed(0)} s.
        Backed pumps hand their throughput to the foreline; only terminal pumps remove gas.
        <button className="btn" onClick={() => st().requestFlows()}>Refresh</button>
      </div>
    </div>
  );
}
