import { useState } from 'react';
import { PART_BY_ID } from '../../data/fittings';
import { MATERIALS } from '../../data/materials';
import { formatPressure, nodePartials, nodePressures, nodeTemps, selectedOne, useStore } from '../../store';

const TEMP_KINDS = ['chamber', 'tube', 'flex', 'bellows', 'tee', 'cross', 'payload'];

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

  if (selection.length > 1) {
    const s = useStore.getState();
    return (
      <aside className="inspector open">
        <button className="btn mobile-only drawer-close" onClick={() => s.select(null)}>✕ close</button>
        <h3>{selection.length} parts selected</h3>
        <div className="hint">Drag any member to move the group. Shift-click toggles membership.</div>
        <div className="btn-row">
          <button className="btn" onClick={() => s.rotateSelection()}>Rotate all (R)</button>
          <button className="btn" onClick={() => s.duplicateSelection()}>Duplicate (Ctrl+D)</button>
        </div>
        <div className="btn-row">
          <button className="btn danger" onClick={() => s.deleteParts(s.selection)}>Delete all</button>
        </div>
      </aside>
    );
  }

  const inst = system.parts.find((p) => p.id === selectedOne({ selection }));
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
    <aside className="inspector open">
      <button className="btn mobile-only drawer-close" onClick={() => useStore.getState().select(null)}>✕ close</button>
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
      {def.kind === 'pump' && (
        <button
          className="btn"
          onClick={() => useStore.getState().setPumpBrowser({ initial: String(def.data.pumpId ?? '') })}
        >
          ⧉ Browse pump catalog
        </button>
      )}
      {(def.kind === 'pump' || def.kind.startsWith('coldtrap')) && <CapacityReadout partId={inst.id} />}
      {TEMP_KINDS.includes(def.kind) && <TemperatureBlock partId={inst.id} />}
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

function TemperatureBlock({ partId }: { partId: string }) {
  const compiled = useStore((s) => s.compiled);
  const simLoaded = useStore((s) => s.simLoaded);
  const liveAction = useStore((s) => s.liveAction);
  const snapshot = useStore((s) => s.snapshot);
  useStore((s) => s.chartTick);
  const [setpoint, setSetpoint] = useState(150);
  const node = compiled?.regionNode[`${partId}:0`] ?? compiled?.portNode[`${partId}:0`];
  const tc = node ? nodeTemps.get(node) : undefined;
  const condensed = node ? snapshot?.nodes.find((n) => n.id === node)?.condensedH2O : undefined;
  if (!simLoaded) return null;
  return (
    <div className="temp-block">
      <div className="prop-row">
        <span>temperature</span>
        <b>{tc !== undefined ? `${tc.toFixed(tc >= 100 ? 0 : 1)} °C` : '—'}</b>
      </div>
      {condensed !== undefined && condensed > 0.01 && (
        <div className="prop-row">
          <span>condensed H₂O</span>
          <b>{condensed.toExponential(1)} Torr·L</b>
        </div>
      )}
      <div className="prop-row">
        <span>setpoint</span>
        <span>
          <input
            type="number" min={-40} max={450} step={5} value={setpoint}
            style={{ width: 64 }}
            onChange={(e) => setSetpoint(Number(e.target.value))}
          />
          <button
            className="btn" style={{ marginLeft: 6 }}
            onClick={() => liveAction({ type: 'setTemperature', nodeIds: [partId], temperatureC: setpoint })}
          >
            Apply
          </button>
        </span>
      </div>
      <div className="hint">Heats with τ≈10 min, cools slower. Outgassing follows ×10 per 60 °C; enough hot hours flip the surfaces to baked.</div>
    </div>
  );
}

function CapacityReadout({ partId }: { partId: string }) {
  const snapshot = useStore((s) => s.snapshot);
  const pm = snapshot?.pumps.find((p) => p.id === partId);
  if (!snapshot || !pm || pm.capacityFrac === null) return null;
  const frac = Math.min(1, pm.capacityFrac);
  const color = frac >= 1 ? '#ff7070' : frac > 0.8 ? '#ffb14e' : '#7bd88f';
  return (
    <div className="cap-readout">
      <div className="prop-row"><span>capacity used</span><b>{frac >= 0.995 ? 'FULL' : `${Math.round(frac * 100)}%`}</b></div>
      <div className="species-bar-bg">
        <div className="species-bar" style={{ width: `${frac * 100}%`, background: color }} />
      </div>
      {snapshot.species.map((g, i) =>
        (pm.capacityUsed[i] ?? 0) > 1e-9 ? (
          <div key={g} className="prop-row tiny-row">
            <span>{g}</span><span>{pm.capacityUsed[i].toExponential(1)} Torr·L</span>
          </div>
        ) : null,
      )}
      <div className="hint">Regenerate (script action) while off to empty a saturated capture pump.</div>
    </div>
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
