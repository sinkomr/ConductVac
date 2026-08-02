import { useEffect, useState } from 'react';
import { formatSimTime, useStore } from '../../store';

const SPEEDS = [1, 10, 100, 1000, 10000];

/**
 * Compact warnings + stale indicators at the START of the controls strip, so
 * they stay visible on mobile where the bar scrolls sideways (the old trailing
 * text scrolled off-screen and compile warnings only lived in the desktop
 * inspector). The popover is position:fixed so the scroll strip can't clip it.
 */
function StatusChips() {
  const warnings = useStore((s) => s.warnings);
  const stale = useStore((s) => s.stale);
  const simLoaded = useStore((s) => s.simLoaded);
  const [pop, setPop] = useState<null | { left: number; top: number }>(null);

  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [pop]);

  if (warnings.length === 0 && !(stale && simLoaded)) return null;
  return (
    <span className="status-chips">
      {warnings.length > 0 && (
        <button
          className="btn status-chip warn"
          title="compile warnings"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPop(pop ? null : { left: Math.max(8, r.left), top: r.bottom + 6 });
          }}
        >
          ⚠ {warnings.length}
        </button>
      )}
      {stale && simLoaded && (
        <span className="status-chip edited" title="system edited — Reset to apply">↺ edited</span>
      )}
      {pop && warnings.length > 0 && (
        <div className="warn-popover" style={{ left: pop.left, top: pop.top }} onPointerDown={(e) => e.stopPropagation()}>
          {warnings.map((w, i) => (
            <div key={i} className="warning">⚠ {w}</div>
          ))}
        </div>
      )}
    </span>
  );
}

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
      <button
        className="btn mobile-only"
        onClick={() => st().setPaletteOpen(!useStore.getState().paletteOpen)}
        title="parts palette"
      >
        ☰ Parts
      </button>
      <StatusChips />
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
      <button className="btn" onClick={() => st().requestFit()} title="fit the system into view">
        ⤢ Fit
      </button>
      <button className="btn" onClick={() => st().tidyWiring()} title="reassign joints to equivalent ports for cleaner wiring">
        ⌗ Tidy
      </button>
      <button
        className="btn danger"
        disabled={!simLoaded}
        title="cut site power: pumps coast down, electronic gauges go dark"
        onClick={() =>
          st().liveAction(
            useStore.getState().snapshot?.powerFailed
              ? { type: 'powerRestore', pumpIds: 'all', gaugeIds: 'all' }
              : { type: 'powerFail' },
          )
        }
      >
        {snapshot?.powerFailed ? '⚡ Restore power' : '⚡ Power fail'}
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
    </div>
  );
}
