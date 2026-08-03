import { useState } from 'react';
import { formatSimTime, useStore } from '../../store';

/**
 * Shows the latest script note the simulation has passed — the examples'
 * lesson commentary (ScriptRow.note), finally rendered. Pure derivation from
 * system.script + snapshot.t; dismissing hides a note until the next one
 * supersedes it, and a Reset naturally rewinds to silence.
 */
export function LessonTicker() {
  const system = useStore((s) => s.system);
  const snapshot = useStore((s) => s.snapshot);
  useStore((s) => s.chartTick);
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!snapshot) return null;
  const passed = system.script
    .filter((r) => r.note && r.t <= snapshot.t + 1e-9)
    .sort((a, b) => a.t - b.t);
  const cur = passed[passed.length - 1];
  if (!cur || cur.id === dismissed) return null;

  return (
    <div className="lesson-ticker">
      <span className="lesson-t">t = {formatSimTime(cur.t)}</span>
      <span className="lesson-text">{cur.note}</span>
      <button className="lesson-x" title="dismiss" onClick={() => setDismissed(cur.id)}>✕</button>
    </div>
  );
}
