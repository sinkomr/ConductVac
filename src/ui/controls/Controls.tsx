import { formatSimTime, useStore } from '../../store';

const SPEEDS = [1, 10, 100, 1000, 10000];

export function Controls() {
  const running = useStore((s) => s.running);
  const ffActive = useStore((s) => s.ffActive);
  const speed = useStore((s) => s.speed);
  const snapshot = useStore((s) => s.snapshot);
  const stale = useStore((s) => s.stale);
  const simLoaded = useStore((s) => s.simLoaded);
  const st = useStore.getState;

  return (
    <div className="controls">
      <button className="btn primary" onClick={() => (running ? st().pauseSim() : st().runSim())} disabled={ffActive}>
        {running ? '❚❚ Pause' : '▶ Run'}
      </button>
      <button className="btn" onClick={() => st().resetSim()} disabled={ffActive} title="Reset to atmosphere">
        ↺ Reset
      </button>
      <span className="speed">
        {SPEEDS.map((v) => (
          <button
            key={v}
            className={`btn speed-btn ${speed === v ? 'active' : ''}`}
            onClick={() => st().setSpeed(v)}
          >
            {v}×
          </button>
        ))}
      </span>
      <button className="btn" onClick={() => st().fastForward()} disabled={ffActive || !simLoaded && stale}>
        {ffActive ? '⏩ running…' : '⏩ to steady state'}
      </button>
      <span className="sim-time">
        t = {snapshot ? formatSimTime(snapshot.t) : '—'}
        {snapshot?.steadyState && <em> (steady)</em>}
      </span>
      <label className="values-toggle" title="paint live pressures on chambers, pumps and gauges">
        <input
          type="checkbox"
          checked={useStore((s) => s.showValues)}
          onChange={(e) => st().setShowValues(e.target.checked)}
        />
        pressure labels
      </label>
      {stale && simLoaded && <span className="stale">system edited — Reset to apply</span>}
    </div>
  );
}
