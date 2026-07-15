import { useRef } from 'react';
import { Palette } from './builder/Palette';
import { Canvas } from './builder/Canvas';
import { Inspector } from './inspector/Inspector';
import { Controls } from './controls/Controls';
import { StripCharts } from './charts/StripCharts';
import { ScriptEditor } from './controls/ScriptEditor';
import { EventLog } from './controls/EventLog';
import { Sankey } from './sankey/Sankey';
import { SpeciesPanel } from './SpeciesPanel';
import { useStore, type PressureUnit } from '../store';
import { EXAMPLES } from '../examples';
import type { SystemDefinition } from '../types';

export function App() {
  const system = useStore((s) => s.system);
  const bottomTab = useStore((s) => s.bottomTab);
  const unit = useStore((s) => s.unit);
  const st = useStore.getState;
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const blob = new Blob([JSON.stringify(system, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${system.name.replace(/\s+/g, '-').toLowerCase() || 'system'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const load = (file: File) => {
    file.text().then((text) => {
      try {
        const sys = JSON.parse(text) as SystemDefinition;
        if (sys.version !== 1 || !Array.isArray(sys.parts)) throw new Error('not a ConductVac system file');
        st().loadSystem(sys);
      } catch (err) {
        alert(`Could not load: ${err}`);
      }
    });
  };

  const tabs = [
    ['charts', 'Strip charts'],
    ['flow', 'Gas flow'],
    ['species', 'Species'],
    ['script', 'Event script'],
    ['log', 'Event log'],
  ] as const;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ConductVac</span>
        <input
          className="sysname"
          value={system.name}
          onChange={(e) => st().renameSystem(e.target.value)}
        />
        <select
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) st().loadSystem(JSON.parse(JSON.stringify(ex.system)));
          }}
        >
          <option value="" disabled>Load example…</option>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>{ex.name}</option>
          ))}
        </select>
        <button className="btn" onClick={() => st().newSystem()}>New</button>
        <button className="btn" onClick={save}>Save JSON</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Load JSON</button>
        <input
          ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
        />
        <span className="spacer" />
        <button className="btn" onClick={() => st().undo()} title="Ctrl+Z">↶</button>
        <button className="btn" onClick={() => st().redo()} title="Ctrl+Shift+Z">↷</button>
        <label className="unit-label">
          units
          <select value={unit} onChange={(e) => st().setUnit(e.target.value as PressureUnit)}>
            {(['Torr', 'mbar', 'Pa', 'mTorr'] as const).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="unit-label">
          RH
          <input
            type="number" min={0} max={100} value={system.humidityRH} className="rh-input"
            onChange={(e) => st().setHumidity(Number(e.target.value))}
          />
          %
        </label>
      </header>
      <Controls />
      <main className="main">
        <Palette />
        <Canvas />
        <Inspector />
        {useStore((s2) => s2.paletteOpen) && (
          <div className="drawer-backdrop" onClick={() => st().setPaletteOpen(false)} />
        )}
      </main>
      <footer className="bottom">
        <div className="tabbar">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className={`tab ${bottomTab === id ? 'active' : ''}`}
              onClick={() => st().setBottomTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="tabpanel">
          {bottomTab === 'charts' && <StripCharts />}
          {bottomTab === 'flow' && <Sankey />}
          {bottomTab === 'species' && <SpeciesPanel />}
          {bottomTab === 'script' && <ScriptEditor />}
          {bottomTab === 'log' && <EventLog />}
        </div>
      </footer>
    </div>
  );
}
