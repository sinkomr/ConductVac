import { PART_BY_ID } from '../../data/fittings';
import type { ScriptRow, SimEventAction } from '../../types';
import { useStore } from '../../store';

/**
 * Timeline event scripting (§3.2): an editable table — at t = X do Y.
 * Targets are part ids; the compiler translates them to engine ids on load.
 */

type ActionKind = SimEventAction['type'];

const ACTION_KINDS: { value: ActionKind; label: string }[] = [
  { value: 'valve', label: 'set valve' },
  { value: 'pump', label: 'pump on/off' },
  { value: 'ballast', label: 'gas ballast' },
  { value: 'gauge', label: 'gauge on/off' },
  { value: 'bakeStart', label: 'start bake' },
  { value: 'bakeEnd', label: 'end bake' },
  { value: 'heSpray', label: 'spray He' },
  { value: 'setLeak', label: 'set leak rate' },
  { value: 'regenerate', label: 'regenerate pump' },
];

function defaultAction(kind: ActionKind, firstOf: (k: string[]) => string): SimEventAction {
  switch (kind) {
    case 'valve': return { type: 'valve', edgeId: firstOf(['valve']), open: 1 };
    case 'pump': return { type: 'pump', pumpId: firstOf(['pump']), on: true };
    case 'ballast': return { type: 'ballast', pumpId: firstOf(['pump']), on: true };
    case 'gauge': return { type: 'gauge', gaugeId: firstOf(['gauge']), enabled: true };
    case 'bakeStart': return { type: 'bakeStart', nodeIds: 'all', temperatureC: 150 };
    case 'bakeEnd': return { type: 'bakeEnd', nodeIds: 'all' };
    case 'heSpray': return { type: 'heSpray', leakId: firstOf(['leak']), dwell: 5 };
    case 'setLeak': return { type: 'setLeak', leakId: firstOf(['leak']), qStd: 1e-6 };
    case 'regenerate': return { type: 'regenerate', pumpId: firstOf(['pump']) };
  }
}

export function ScriptEditor() {
  const system = useStore((s) => s.system);
  const st = useStore.getState;

  const partsOf = (kinds: string[]) =>
    system.parts.filter((p) => {
      const k = PART_BY_ID[p.def]?.kind ?? '';
      return kinds.some((kk) => k.startsWith(kk));
    });
  const firstOf = (kinds: string[]) => partsOf(kinds)[0]?.id ?? '';

  const rows = [...system.script].sort((a, b) => a.t - b.t);

  return (
    <div className="script-editor">
      <table>
        <thead>
          <tr><th>t [s]</th><th>action</th><th>target / value</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} partsOf={partsOf} firstOf={firstOf} />
          ))}
        </tbody>
      </table>
      <button
        className="btn"
        onClick={() => st().addScriptRow({ t: 0, action: defaultAction('valve', firstOf) })}
      >
        + add event
      </button>
      <span className="hint"> Events apply on Run/Reset; edits require Reset.</span>
    </div>
  );
}

function Row({ row, partsOf, firstOf }: {
  row: ScriptRow;
  partsOf: (kinds: string[]) => { id: string }[];
  firstOf: (kinds: string[]) => string;
}) {
  const st = useStore.getState;
  const a = row.action;
  const upd = (patch: Partial<ScriptRow>) => st().updateScriptRow(row.id, patch);
  const updAction = (action: SimEventAction) => upd({ action });

  const targetSelect = (kinds: string[], value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {partsOf(kinds).map((p) => (
        <option key={p.id} value={p.id}>{p.id}</option>
      ))}
    </select>
  );

  let detail: JSX.Element;
  switch (a.type) {
    case 'valve':
      detail = (
        <>
          {targetSelect(['valve'], a.edgeId, (v) => updAction({ ...a, edgeId: v }))}
          <select
            value={a.open > 0 ? 'open' : 'close'}
            onChange={(e) => updAction({ ...a, open: e.target.value === 'open' ? 1 : 0 })}
          >
            <option value="open">open</option>
            <option value="close">close</option>
          </select>
          {a.open > 0 && a.open < 1 && <span>{Math.round(a.open * 100)}%</span>}
        </>
      );
      break;
    case 'pump':
    case 'ballast':
      detail = (
        <>
          {targetSelect(['pump'], a.pumpId, (v) => updAction({ ...a, pumpId: v }))}
          <select value={a.on ? 'on' : 'off'} onChange={(e) => updAction({ ...a, on: e.target.value === 'on' })}>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </>
      );
      break;
    case 'regenerate':
      detail = targetSelect(['pump'], a.pumpId, (v) => updAction({ ...a, pumpId: v }));
      break;
    case 'gauge':
      detail = (
        <>
          {targetSelect(['gauge'], a.gaugeId, (v) => updAction({ ...a, gaugeId: v }))}
          <select value={a.enabled ? 'on' : 'off'} onChange={(e) => updAction({ ...a, enabled: e.target.value === 'on' })}>
            <option value="on">on</option>
            <option value="off">off</option>
          </select>
        </>
      );
      break;
    case 'bakeStart':
      detail = (
        <>
          <span>all bakeable surfaces at</span>
          <input
            type="number" value={a.temperatureC} min={30} max={450} step={10}
            onChange={(e) => updAction({ ...a, temperatureC: Number(e.target.value) })}
          />
          <span>°C</span>
        </>
      );
      break;
    case 'bakeEnd':
      detail = <span>complete bake (baked surfaces switch to H2 rates)</span>;
      break;
    case 'heSpray':
      detail = (
        <>
          {targetSelect(['leak'], a.leakId, (v) => updAction({ ...a, leakId: v }))}
          <input
            type="number" value={a.dwell} min={0.5} max={600} step={0.5}
            onChange={(e) => updAction({ ...a, dwell: Number(e.target.value) })}
          />
          <span>s dwell</span>
        </>
      );
      break;
    case 'setLeak':
      detail = (
        <>
          {targetSelect(['leak'], a.leakId, (v) => updAction({ ...a, leakId: v }))}
          <input
            type="number" value={a.qStd}
            onChange={(e) => updAction({ ...a, qStd: Number(e.target.value) })}
          />
          <span>Torr·L/s</span>
        </>
      );
      break;
  }

  return (
    <tr>
      <td>
        <input
          type="number" value={row.t} min={0} step={1} className="t-input"
          onChange={(e) => st().updateScriptRow(row.id, { t: Number(e.target.value) })}
        />
      </td>
      <td>
        <select
          value={a.type}
          onChange={(e) => {
            const kind = e.target.value as ActionKind;
            st().updateScriptRow(row.id, { action: defaultAction(kind, firstOf) });
          }}
        >
          {ACTION_KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </td>
      <td className="detail">{detail}</td>
      <td>
        <button className="btn danger" onClick={() => st().deleteScriptRow(row.id)}>✕</button>
      </td>
    </tr>
  );
}
