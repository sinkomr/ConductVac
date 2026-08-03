import { useMemo, useState } from 'react';
import { PUMP_CATALOG, type PumpCatalogEntry } from '../../data/pumps';
import { PART_BY_ID } from '../../data/fittings';
import { useStore } from '../../store';
import { speedCurve } from './curves';

/**
 * Pump catalog browser: class-grouped list with an honest S(p) curve for the
 * selection, sampled from the engine's own PumpRuntime — so the rolloff knee,
 * ultimate pressure and ion bell you see here are exactly what a build will
 * do. "Place this pump" arms the normal placement flow.
 */

const W = 480;
const H = 240;
const PAD = { l: 44, r: 10, t: 10, b: 26 };

function CurvePlot({ entry }: { entry: PumpCatalogEntry }) {
  const curve = useMemo(() => speedCurve(entry.model), [entry]);
  const sMax = Math.max(...curve.s, 1e-3);
  const yTop = Math.ceil(Math.log10(sMax * 1.6));
  const yBot = yTop - 6; // six decades of speed is plenty for any catalog pump
  const xLo = -10;
  const xHi = Math.log10(760);
  const X = (p: number) => PAD.l + ((Math.log10(p) - xLo) / (xHi - xLo)) * (W - PAD.l - PAD.r);
  const Y = (s: number) => {
    const l = Math.max(yBot, Math.min(yTop, Math.log10(Math.max(s, 10 ** yBot))));
    return PAD.t + ((yTop - l) / (yTop - yBot)) * (H - PAD.t - PAD.b);
  };
  const path = curve.p
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p).toFixed(1)},${Y(curve.s[i]).toFixed(1)}`)
    .join(' ');
  const xTicks = [1e-9, 1e-6, 1e-3, 1, 760];
  const yTicks = Array.from({ length: yTop - yBot + 1 }, (_, i) => yBot + i);

  return (
    <svg width={W} height={H} className="pb-curve" viewBox={`0 0 ${W} ${H}`}>
      {xTicks.map((p) => (
        <g key={p}>
          <line x1={X(p)} x2={X(p)} y1={PAD.t} y2={H - PAD.b} stroke="#2c3038" />
          <text x={X(p)} y={H - 9} textAnchor="middle" className="pb-tick">
            {p === 760 ? '760' : `1e${Math.round(Math.log10(p))}`}
          </text>
        </g>
      ))}
      {yTicks.map((d) => (
        <g key={d}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(10 ** d)} y2={Y(10 ** d)} stroke="#2c3038" />
          <text x={PAD.l - 5} y={Y(10 ** d) + 3} textAnchor="end" className="pb-tick">
            {d >= 0 && d <= 3 ? String(10 ** d) : `1e${d}`}
          </text>
        </g>
      ))}
      {curve.rolloff && (
        <rect
          x={X(curve.rolloff[0])} y={PAD.t}
          width={Math.max(0, X(curve.rolloff[1]) - X(curve.rolloff[0]))}
          height={H - PAD.t - PAD.b}
          fill="#ffb14e" opacity={0.08}
        />
      )}
      {curve.pUlt !== undefined && (
        <line
          x1={X(curve.pUlt)} x2={X(curve.pUlt)} y1={PAD.t} y2={H - PAD.b}
          stroke="#ff7070" strokeDasharray="3 3"
        />
      )}
      <path d={path} fill="none" stroke="#6ab0ff" strokeWidth={2} />
      <text x={PAD.l + 4} y={PAD.t + 10} className="pb-axis">S [L/s], air</text>
      <text x={W - PAD.r - 40} y={H - 9} textAnchor="end" className="pb-axis">p inlet [Torr]</text>
    </svg>
  );
}

export function PumpBrowser() {
  const open = useStore((s) => s.pumpBrowser);
  const st = useStore.getState;
  const [selId, setSelId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, PumpCatalogEntry[]>();
    for (const e of PUMP_CATALOG) {
      if (!m.has(e.class)) m.set(e.class, []);
      m.get(e.class)!.push(e);
    }
    return [...m.entries()];
  }, []);

  if (!open) return null;
  const activeId = selId ?? open.initial ?? PUMP_CATALOG[0].id;
  const entry = PUMP_CATALOG.find((e) => e.id === activeId) ?? PUMP_CATALOG[0];
  const partId = `pump-${entry.id}`;
  const placeable = !!PART_BY_ID[partId];
  const close = () => {
    setSelId(null);
    st().setPumpBrowser(null);
  };

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="pump-browser" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pb-header">
          <b>Pump catalog</b>
          <span className="hint">speed curves sampled from the simulation's own pump models</span>
          <button className="btn" onClick={close}>✕</button>
        </div>
        <div className="pb-body">
          <div className="pb-list">
            {groups.map(([cls, entries]) => (
              <div key={cls}>
                <div className="pb-class">{cls}</div>
                {entries.map((e) => (
                  <button
                    key={e.id}
                    className={`pb-item ${e.id === entry.id ? 'active' : ''}`}
                    onClick={() => setSelId(e.id)}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="pb-detail">
            <h3>{entry.name}</h3>
            <CurvePlot entry={entry} />
            <div className="pb-facts">
              <span>inlet {entry.inletFlange}</span>
              {entry.backingFlange && <span>backing {entry.backingFlange} (must be backed)</span>}
              {entry.model.kind === 'turbo' && <span>crit. backing {entry.model.pCritBack} Torr</span>}
              {entry.model.kind === 'diffusion' && <span>crit. backing {entry.model.pCritBack} Torr</span>}
            </div>
            <p className="hint">{entry.notes}</p>
            <button
              className="btn primary"
              disabled={!placeable}
              onClick={() => {
                st().setPlacing(partId);
                close();
              }}
            >
              Place this pump
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
