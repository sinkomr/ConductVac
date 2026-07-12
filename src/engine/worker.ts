import { Sim } from './solver';
import { computeFlows, type FlowReport } from './report';
import type { EngineSystemSpec, EventLogEntry, SimEvent, SimEventAction, SimSnapshot } from '../types';

/**
 * Engine host: the solver runs here, decoupled from the UI. Wall-clock tick
 * every 50 ms advances speed×0.05 s of sim time; snapshots post at ~10 Hz.
 * Chart samples are recorded per accepted solver step (decimated) so fast
 * transients stay resolved even at high sim speed.
 */

export type WorkerCmd =
  | { type: 'load'; engine: EngineSystemSpec; script: SimEvent[]; autorun?: boolean }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'speed'; value: number }
  | { type: 'action'; action: SimEventAction }
  | { type: 'ff' }
  | { type: 'flows' };

export interface ChartSample {
  t: number;
  /** per gauge (engine order): reading value */
  v: number[];
  /** per gauge: true pressure at the gauge node */
  tr: number[];
}

export type WorkerMsg =
  | { type: 'loaded'; gaugeIds: string[]; warnings?: string[] }
  | {
      type: 'snapshot';
      snap: SimSnapshot;
      log: EventLogEntry[];
      samples: ChartSample[];
      running: boolean;
      ffActive: boolean;
    }
  | { type: 'ffdone'; converged: boolean; t: number }
  | { type: 'flows'; report: FlowReport }
  | { type: 'error'; message: string };

const post = (m: WorkerMsg) => (self as unknown as Worker).postMessage(m);

let sim: Sim | null = null;
let running = false;
let speed = 1;
let pendingLog: EventLogEntry[] = [];
let samples: ChartSample[] = [];
let lastSampleT = -Infinity;
let ffActive = false;

function attach(s: Sim) {
  s.onLog = (e) => pendingLog.push(e);
  s.onSample = (t) => {
    // decimate: at least 0.2% of elapsed time between samples, min 5 ms
    const gap = Math.max(5e-3, t * 0.002);
    if (t - lastSampleT < gap) return;
    lastSampleT = t;
    const snap = samples.length < 12000; // hard cap per posting interval
    if (!snap) return;
    const v: number[] = [];
    const tr: number[] = [];
    for (const gg of s.net.gauges) {
      const r = gg.reading(s.partialsAt(gg.nodeIdx));
      v.push(r.value);
      tr.push(r.truth);
    }
    samples.push({ t, v, tr });
  };
}

function postSnapshot() {
  if (!sim) return;
  post({
    type: 'snapshot',
    snap: sim.snapshot(),
    log: pendingLog,
    samples,
    running,
    ffActive,
  });
  pendingLog = [];
  samples = [];
}

let lastPost = 0;

setInterval(() => {
  if (!sim || !running || ffActive) return;
  try {
    sim.advance(speed * 0.05);
  } catch (err) {
    running = false;
    post({ type: 'error', message: String(err) });
  }
  const now = Date.now();
  if (now - lastPost >= 95) {
    lastPost = now;
    postSnapshot();
  }
}, 50);

self.onmessage = (ev: MessageEvent<WorkerCmd>) => {
  const cmd = ev.data;
  try {
    switch (cmd.type) {
      case 'load': {
        sim = new Sim(cmd.engine);
        sim.scheduleEvents(cmd.script);
        running = cmd.autorun ?? false;
        pendingLog = [];
        samples = [];
        lastSampleT = -Infinity;
        ffActive = false;
        attach(sim);
        post({ type: 'loaded', gaugeIds: sim.net.gauges.map((g) => g.spec.id) });
        postSnapshot();
        break;
      }
      case 'run':
        running = true;
        break;
      case 'pause':
        running = false;
        postSnapshot();
        break;
      case 'speed':
        speed = cmd.value;
        break;
      case 'action':
        if (sim) {
          sim.applyAction(cmd.action);
          postSnapshot();
        }
        break;
      case 'ff': {
        if (!sim) break;
        ffActive = true;
        // run in slices so the UI keeps painting
        let slices = 0;
        const step = () => {
          if (!sim || !ffActive) return;
          const res = sim.fastForward(3600 * 6);
          postSnapshot();
          slices++;
          if (res.converged || slices > 120) {
            ffActive = false;
            post({ type: 'ffdone', converged: res.converged, t: sim.t });
            postSnapshot();
          } else {
            setTimeout(step, 0);
          }
        };
        setTimeout(step, 0);
        break;
      }
      case 'flows':
        if (sim) post({ type: 'flows', report: computeFlows(sim) });
        break;
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
