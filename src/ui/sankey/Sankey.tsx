import { useEffect, useMemo } from 'react';
import { useStore } from '../../store';
import type { ChamberDiagnosis } from '../../engine/report';

/**
 * Gas-load flow view (§3.3): sources (leaks, outgassing, permeation) →
 * network → sinks (pumps), ribbon width ∝ throughput, plus the per-chamber
 * "what's limiting me" diagnosis with culprit highlighting.
 */

const VERDICT_LABEL: Record<ChamberDiagnosis['verdict'], string> = {
  conductance: 'conductance-limited',
  pump: 'pump-limited',
  load: 'gas-load-limited',
  leak: 'leak-limited',
  transient: 'still equilibrating',
};

const fmtS = (s: number) => (s >= 10 ? s.toFixed(0) : s >= 0.1 ? s.toFixed(1) : s.toExponential(1));

export function Sankey() {
  const flows = useStore((s) => s.flows);
  const simLoaded = useStore((s) => s.simLoaded);
  const bottomTab = useStore((s) => s.bottomTab);
  const chartTick = useStore((s) => s.chartTick);
  const compiled = useStore((s) => s.compiled);
  const highlightParts = useStore((s) => s.highlightParts);
  const st = useStore.getState;

  // engine id → part id, inverted from the compiler's region/port maps
  const toPart = useMemo(() => {
    const map = new Map<string, string>();
    if (compiled) {
      for (const [key, nodeId] of Object.entries(compiled.portNode)) {
        if (!map.has(nodeId)) map.set(nodeId, key.split(':')[0]);
      }
      for (const [key, nodeId] of Object.entries(compiled.regionNode)) {
        if (!map.has(nodeId)) map.set(nodeId, key.split(':')[0]);
      }
    }
    const partExists = (id: string) => st().system.parts.some((p) => p.id === id);
    return (engineId: string): string | null => {
      const direct = map.get(engineId);
      if (direct && partExists(direct)) return direct;
      if (engineId.startsWith('outgas.') || engineId.startsWith('perm.')) {
        return toPartInner(engineId.slice(engineId.indexOf('.') + 1));
      }
      const prefix = engineId.split('.')[0];
      return !engineId.startsWith('_') && partExists(prefix) ? prefix : null;
    };
    function toPartInner(engineId: string): string | null {
      const direct = map.get(engineId);
      if (direct && partExists(direct)) return direct;
      const prefix = engineId.split('.')[0];
      return !engineId.startsWith('_') && partExists(prefix) ? prefix : null;
    }
  }, [compiled, st]);

  const culpritsOf = (d: ChamberDiagnosis): string[] => {
    const ids: (string | null)[] = [];
    if (d.verdict === 'conductance' && d.bottleneckEdgeId) ids.push(toPart(d.bottleneckEdgeId));
    if (d.verdict === 'pump' && d.pumpId) ids.push(toPart(d.pumpId));
    if (d.verdict === 'load' || d.verdict === 'leak') {
      for (const s of d.topSources) ids.push(toPart(s.id));
    }
    return [...new Set(ids.filter((x): x is string => !!x))];
  };

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

  const allCulprits = [...new Set((flows.diagnoses ?? []).flatMap(culpritsOf))];
  const highlighting = !!highlightParts;

  return (
    <div className="sankey-wrap">
      {(flows.diagnoses ?? []).length > 0 && (
        <div className="diag-section">
          {(flows.diagnoses ?? []).map((d) => (
            <div key={d.nodeId} className={`diag-card diag-${d.verdict}`}>
              <b>{d.label}</b> — <em>{VERDICT_LABEL[d.verdict]}</em>
              {d.verdict === 'conductance' && (
                <span>
                  {' '}· delivered {fmtS(d.sDelivered)} L/s of {d.pumpId ? `${toPart(d.pumpId) ?? d.pumpId}'s` : ''} {fmtS(d.sPump)} L/s
                  {d.bottleneckEdgeId && <> · worst drop ×{d.dropFactor >= 10 ? d.dropFactor.toFixed(0) : d.dropFactor.toFixed(1)} at <b>{toPart(d.bottleneckEdgeId) ?? d.bottleneckEdgeId}</b></>}
                </span>
              )}
              {d.verdict === 'pump' && (
                <span>
                  {' '}· {d.pumpId ? `${toPart(d.pumpId) ?? d.pumpId} is the limit (speed, backing, saturation or ultimate)` : 'no pump is running on this chamber'}
                </span>
              )}
              {(d.verdict === 'load' || d.verdict === 'leak') && d.topSources.length > 0 && (
                <span>
                  {' '}· top: {d.topSources.map((s) => `${toPart(s.id) ?? s.id} (${Math.round(s.share * 100)}%)`).join(', ')}
                </span>
              )}
              {d.verdict === 'transient' && <span> · run to steady state for a reliable verdict</span>}
              {culpritsOf(d).map((pid) => (
                <button key={pid} className="btn diag-chip" onClick={() => st().select(pid)}>{pid}</button>
              ))}
            </div>
          ))}
          {allCulprits.length > 0 && (
            <label className="values-toggle">
              <input
                type="checkbox"
                checked={highlighting}
                onChange={(e) => st().setHighlightParts(e.target.checked ? allCulprits : null)}
              />
              highlight culprits on the schematic
            </label>
          )}
        </div>
      )}
      <svg width={W} height={Math.max(ys, yk, 120) + 10} className="sankey">
        {srcBoxes.map((s) => (
          <g key={s.id}>
            <path
              d={`M 200 ${s.y} C 300 ${s.y}, 320 ${midY - 15}, 380 ${midY - 15} L 380 ${midY + 15} C 320 ${midY + 15}, 300 ${s.y + s.h}, 200 ${s.y + s.h} Z`}
              fill={s.kind === 'leak' ? '#ff707055' : '#7bd88f55'}
            />
            <rect x={188} y={s.y} width={12} height={s.h}
              fill={s.kind === 'leak' ? '#ff7070' : s.kind === 'permeation' ? '#caa9ff' : '#7bd88f'} />
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
