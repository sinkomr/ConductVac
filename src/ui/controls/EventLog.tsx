import { formatSimTime, useStore } from '../../store';

export function EventLog() {
  const log = useStore((s) => s.eventLog);
  if (log.length === 0) {
    return <div className="hint pad">Pump trips, gauge failures, saturation warnings and other events appear here.</div>;
  }
  return (
    <div className="event-log">
      {[...log].reverse().map((e, i) => (
        <div key={log.length - i} className={`log-entry ${e.severity}`}>
          <span className="log-t">{formatSimTime(e.t)}</span>
          <span>{e.message}</span>
        </div>
      ))}
    </div>
  );
}
