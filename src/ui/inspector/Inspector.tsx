import { PART_BY_ID } from '../../data/fittings';
import { MATERIALS } from '../../data/materials';
import { formatPressure, nodePartials, nodePressures, useStore } from '../../store';

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const system = useStore((s) => s.system);
  const compiled = useStore((s) => s.compiled);
  const unit = useStore((s) => s.unit);
  const simLoaded = useStore((s) => s.simLoaded);
  const setParam = useStore((s) => s.setParam);
  const rotatePart = useStore((s) => s.rotatePart);
  const deletePart = useStore((s) => s.deletePart);
  const liveAction = useStore((s) => s.liveAction);
  useStore((s) => s.chartTick);

  const inst = system.parts.find((p) => p.id === selection);
  if (!inst) {
    return (
      <aside className="inspector">
        <div className="hint">Select a part to edit its properties.</div>
        <SystemSummary />
      </aside>
    );
  }
  const def = PART_BY_ID[inst.def];
  const node = compiled?.regionNode[`${inst.id}:0`] ?? compiled?.portNode[`${inst.id}:0`];
  const p = node ? nodePressures.get(node) : undefined;
  const partials = node ? nodePartials.get(node) : undefined;
  const species = useStore.getState().snapshot?.species;

  return (
    <aside className="inspector">
      <h3>{def.name}</h3>
      <div className="prop-row"><span>id</span><b>{inst.id}</b></div>
      {p !== undefined && (
        <div className="prop-row"><span>pressure</span><b>{formatPressure(p, unit)}</b></div>
      )}
      {partials && species && (
        <div className="species-mini">
          {species.map((g, i) => (
            <div key={g} className="prop-row tiny-row">
              <span>{g}</span><span>{formatPressure(partials[i], unit)}</span>
            </div>
          ))}
        </div>
      )}
      {def.params.map((pd) => {
        const val = inst.params[pd.key] ?? def.defaults[pd.key];
        switch (pd.kind) {
          case 'boolean':
            return (
              <label key={pd.key} className="prop-row">
                <span>{pd.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(val)}
                  onChange={(e) => setParam(inst.id, pd.key, e.target.checked)}
                />
              </label>
            );
          case 'select':
            return (
              <label key={pd.key} className="prop-row">
                <span>{pd.label}</span>
                <select
                  value={String(val)}
                  onChange={(e) => {
                    const opt = pd.options?.find((o) => String(o.value) === e.target.value);
                    setParam(inst.id, pd.key, opt ? opt.value : e.target.value);
                  }}
                >
                  {pd.options?.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                  ))}
                </select>
              </label>
            );
          case 'log': {
            const lo = Math.log10(pd.min ?? 1e-9);
            const hi = Math.log10(pd.max ?? 1);
            const lv = Math.log10(Math.max(Number(val) || pd.min || 1e-9, pd.min ?? 1e-12));
            return (
              <label key={pd.key} className="prop-col">
                <span>{pd.label}: <b>{Number(val).toExponential(1)}</b> {pd.unit}</span>
                <input
                  type="range" min={lo} max={hi} step={0.05} value={lv}
                  onChange={(e) => setParam(inst.id, pd.key, 10 ** Number(e.target.value))}
                />
              </label>
            );
          }
          default:
            return (
              <label key={pd.key} className="prop-row">
                <span>{pd.label}{pd.unit ? ` (${pd.unit})` : ''}</span>
                <input
                  type="number"
                  value={Number(val)}
                  min={pd.min}
                  max={pd.max}
                  step={pd.step ?? 1}
                  onChange={(e) => setParam(inst.id, pd.key, Number(e.target.value))}
                />
              </label>
            );
        }
      })}
      {def.kind === 'chamber' && (
        <div className="hint">
          Material: {MATERIALS[(inst.params.material as keyof typeof MATERIALS) ?? 'ss304']?.name}
        </div>
      )}
      {def.kind === 'leak' && simLoaded && (
        <button
          className="btn"
          onClick={() => liveAction({ type: 'heSpray', leakId: inst.id, dwell: 5 })}
        >
          Spray He (5 s)
        </button>
      )}
      {def.kind === 'leakdetector' && <LeakDetectorReadout partId={inst.id} />}
      <div className="btn-row">
        <button className="btn" onClick={() => rotatePart(inst.id)}>Rotate (R)</button>
        <button className="btn danger" onClick={() => deletePart(inst.id)}>Delete</button>
      </div>
      {def.fidelity && (
        <details className="fidelity">
          <summary>ⓘ model fidelity</summary>
          <p>{def.fidelity}</p>
        </details>
      )}
    </aside>
  );
}

function LeakDetectorReadout({ partId }: { partId: string }) {
  const snapshot = useStore((s) => s.snapshot);
  const det = snapshot?.pumps.find((p) => p.id === `${partId}.t`);
  if (!det) return null;
  const q = Math.max(det.qHelium, 1e-13);
  const lo = -12, hi = -4;
  const frac = Math.max(0, Math.min(1, (Math.log10(q) - lo) / (hi - lo)));
  return (
    <div className="ld-readout">
      <div className="prop-row"><span>He signal</span><b>{det.qHelium.toExponential(2)} Torr·L/s</b></div>
      <div className="species-bar-bg">
        <div className="species-bar" style={{ width: `${frac * 100}%`, background: '#b279a2' }} />
      </div>
      <div className="hint">log scale 1e-12 → 1e-4 Torr·L/s</div>
    </div>
  );
}

function SystemSummary() {
  const system = useStore((s) => s.system);
  const warnings = useStore((s) => s.warnings);
  const compiled = useStore((s) => s.compiled);
  return (
    <div>
      <h3>{system.name}</h3>
      <div className="prop-row"><span>parts</span><b>{system.parts.length}</b></div>
      <div className="prop-row"><span>joints</span><b>{system.connections.length}</b></div>
      {compiled && <div className="prop-row"><span>engine nodes</span><b>{compiled.engine.nodes.length}</b></div>}
      {warnings.length > 0 && (
        <div className="warnings">
          {warnings.map((w, i) => (
            <div key={i} className="warning">⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
