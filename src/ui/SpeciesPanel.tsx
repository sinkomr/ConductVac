import { formatPressure, nodePartials, nodePressures, useStore } from '../store';
import { GASES } from '../data/gases';

/** stacked partial-pressure view for the selected node (§3.3) */
export function SpeciesPanel() {
  const selection = useStore((s) => s.selection);
  const compiled = useStore((s) => s.compiled);
  const snapshot = useStore((s) => s.snapshot);
  const unit = useStore((s) => s.unit);
  useStore((s) => s.chartTick);

  if (!snapshot || !compiled) return <div className="hint pad">Run the simulation to see species data.</div>;
  const species = snapshot.species;

  const node = selection
    ? compiled.regionNode[`${selection}:0`] ?? compiled.portNode[`${selection}:0`]
    : compiled.engine.nodes[0]?.id;
  if (!node) return <div className="hint pad">Select a part.</div>;
  const partials = nodePartials.get(node);
  const total = nodePressures.get(node);
  if (!partials || total === undefined) return <div className="hint pad">No data for this node yet.</div>;

  const floor = 1e-14;
  const lmin = Math.log10(floor);
  const lmax = Math.log10(760);

  return (
    <div className="species-panel">
      <h4>
        Partial pressures — {selection ?? node} · total {formatPressure(total, unit)}
      </h4>
      {species.map((g, i) => {
        const p = partials[i];
        const w = Math.max(0, ((Math.log10(Math.max(p, floor)) - lmin) / (lmax - lmin)) * 100);
        return (
          <div key={g} className="species-row">
            <span className="species-name">{g}</span>
            <div className="species-bar-bg">
              <div className="species-bar" style={{ width: `${w}%`, background: GASES[g].color }} />
            </div>
            <span className="species-val">{formatPressure(p, unit)}</span>
          </div>
        );
      })}
      <div className="hint">Bars are logarithmic, {floor.toExponential(0)} → 760 Torr.</div>
    </div>
  );
}
