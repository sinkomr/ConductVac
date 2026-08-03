import { create } from 'zustand';
import type {
  Connection, EventLogEntry, PartInstance, ScriptRow, SimEvent, SimEventAction,
  SimSnapshot, SystemDefinition,
} from './types';
import { compileSystem, translateAction, type CompiledSystem } from './compile';
import { PART_BY_ID } from './data/fittings';
import { tidyConnections } from './ui/builder/tidy';
import { buildPaste, copyParts, type ClipboardData } from './clipboard';
import { portPos } from './ui/builder/geometry';
import type { ChartSample, WorkerCmd, WorkerMsg } from './engine/worker';
import type { FlowReport } from './engine/report';
import EngineWorker from './engine/worker?worker';

// ------------------------------------------------------------ chart store ----

/**
 * Chart history lives outside React state (large, mutated at 10 Hz);
 * components subscribe via the store's chartTick counter.
 */
export interface ChartHistory {
  gaugeIds: string[];
  /** legend labels: "part-id · gauge type" */
  labels: string[];
  t: number[];
  /** per gauge: reading series (NaN = no output) */
  values: number[][];
  /** per gauge: truth series */
  truths: number[][];
}

export const chartHistory: ChartHistory = { gaugeIds: [], labels: [], t: [], values: [], truths: [] };

function resetChartHistory(gaugeIds: string[], labels: string[]) {
  chartHistory.gaugeIds = gaugeIds;
  chartHistory.labels = labels;
  chartHistory.t = [];
  chartHistory.values = gaugeIds.map(() => []);
  chartHistory.truths = gaugeIds.map(() => []);
}

function appendSamples(samples: ChartSample[]) {
  for (const s of samples) {
    chartHistory.t.push(s.t);
    for (let i = 0; i < chartHistory.gaugeIds.length; i++) {
      chartHistory.values[i].push(s.v[i]);
      chartHistory.truths[i].push(s.tr[i]);
    }
  }
  // decimate when huge: drop every other point in the older half
  if (chartHistory.t.length > 60000) {
    const half = Math.floor(chartHistory.t.length / 2);
    const keep = (arr: number[]) => arr.filter((_, i) => i >= half || i % 2 === 0);
    chartHistory.t = keep(chartHistory.t);
    chartHistory.values = chartHistory.values.map(keep);
    chartHistory.truths = chartHistory.truths.map(keep);
  }
}

// ------------------------------------------------------------------ units ----

export type PressureUnit = 'Torr' | 'mbar' | 'Pa' | 'mTorr';
export const UNIT_FACTOR: Record<PressureUnit, number> = {
  Torr: 1, mbar: 1.33322, Pa: 133.322, mTorr: 1000,
};

export function formatPressure(pTorr: number, unit: PressureUnit): string {
  if (!Number.isFinite(pTorr)) return '—';
  const v = pTorr * UNIT_FACTOR[unit];
  if (v === 0) return `0 ${unit}`;
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= -2 && exp <= 3) return `${v.toPrecision(3)} ${unit}`;
  return `${v.toExponential(2)} ${unit}`;
}

export function formatSimTime(t: number): string {
  if (t < 120) return `${t.toFixed(1)} s`;
  if (t < 7200) return `${(t / 60).toFixed(1)} min`;
  if (t < 172800) return `${(t / 3600).toFixed(2) } h`;
  return `${(t / 86400).toFixed(2)} d`;
}

// ------------------------------------------------------------------ store ----

const emptySystem = (): SystemDefinition => ({
  version: 1,
  name: 'Untitled system',
  parts: [],
  connections: [],
  script: [],
  humidityRH: 50,
});

let idCounter = 1;
export const freshId = (prefix: string) => `${prefix}${idCounter++}`;

/** bump idCounter past any ids already present in a loaded system */
function absorbIds(sys: SystemDefinition) {
  const all = [
    ...sys.parts.map((p) => p.id),
    ...sys.connections.map((c) => c.id),
    ...sys.script.map((s) => s.id),
  ];
  for (const id of all) {
    const m = /(\d+)$/.exec(id);
    if (m) idCounter = Math.max(idCounter, parseInt(m[1], 10) + 1);
  }
}

interface AppState {
  system: SystemDefinition;
  /** selected part ids, ordered — the LAST entry is the primary selection */
  selection: string[];
  connectFrom: { part: string; port: number } | null;
  placing: string | null; // catalog def id being placed
  compiled: CompiledSystem | null;
  warnings: string[];
  stale: boolean;

  running: boolean;
  ffActive: boolean;
  speed: number;
  snapshot: SimSnapshot | null;
  simLoaded: boolean;
  eventLog: EventLogEntry[];
  chartTick: number;
  flows: FlowReport | null;

  unit: PressureUnit;
  truthOverlay: boolean;
  logTime: boolean;
  /** paint live numeric pressures on chambers/pumps/gauges in the schematic */
  showValues: boolean;
  /** mobile: parts palette drawer visibility */
  paletteOpen: boolean;
  /** bump to ask the canvas to fit the system into view */
  fitTick: number;
  /** part ids tinted as bottleneck culprits (diagnosis highlight) */
  highlightParts: string[] | null;
  bottomTab: 'charts' | 'flow' | 'species' | 'script' | 'log' | 'rga';
  /** bumped whenever the undo/redo stacks change (they live outside the store) */
  histTick: number;

  // builder actions
  setPlacing(defId: string | null): void;
  addPart(defId: string, x: number, y: number): string;
  movePart(id: string, x: number, y: number): void;
  moveParts(entries: { id: string; x: number; y: number }[]): void;
  /** push a pre-drag snapshot so a whole drag undoes as one step */
  commitDragUndo(preJson: string): void;
  rotatePart(id: string): void;
  rotateSelection(): void;
  setParam(id: string, key: string, value: number | string | boolean): void;
  deletePart(id: string): void;
  deleteParts(ids: string[]): void;
  select(id: string | null): void;
  toggleSelect(id: string): void;
  selectMany(ids: string[], additive: boolean): void;
  selectAll(): void;
  copySelection(): void;
  pasteClipboard(): void;
  duplicateSelection(): void;
  /** cut a 2-port part into an existing wire (single undo entry) */
  spliceIntoWire(defId: string, connId: string, x: number, y: number, rot: PartInstance['rot']): void;
  beginConnect(part: string, port: number): void;
  completeConnect(part: string, port: number): void;
  toggleMesh(connId: string): void;
  disconnect(connId: string): void;
  undo(): void;
  redo(): void;
  /** reassign joints to equivalent ports for cleaner wiring (undoable) */
  tidyWiring(): void;
  loadSystem(sys: SystemDefinition): void;
  newSystem(): void;
  renameSystem(name: string): void;
  setHumidity(rh: number): void;

  // script
  addScriptRow(row: Omit<ScriptRow, 'id'>): void;
  updateScriptRow(id: string, patch: Partial<ScriptRow>): void;
  deleteScriptRow(id: string): void;

  // sim
  loadSim(autorun: boolean): void;
  runSim(): void;
  pauseSim(): void;
  resetSim(): void;
  setSpeed(v: number): void;
  fastForward(): void;
  liveAction(a: SimEventAction): void;
  requestFlows(): void;

  setUnit(u: PressureUnit): void;
  setTruthOverlay(v: boolean): void;
  setLogTime(v: boolean): void;
  setShowValues(v: boolean): void;
  setPaletteOpen(v: boolean): void;
  requestFit(): void;
  setBottomTab(t: AppState['bottomTab']): void;
  setHighlightParts(ids: string[] | null): void;
}

// undo stack outside the store; histTick lets the UI derive button states
const undoStack: string[] = [];
const redoStack: string[] = [];
const bumpHist = () => useStore.setState((s) => ({ histTick: s.histTick + 1 }));
const pushUndo = (sys: SystemDefinition) => {
  undoStack.push(JSON.stringify(sys));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  bumpHist();
};

export const undoDepth = (): number => undoStack.length;
export const redoDepth = (): number => redoStack.length;

// node pressures by engine node id — read by the colormap without re-render churn
export const nodePressures = new Map<string, number>();
export const nodePartials = new Map<string, number[]>();
/** live node temperatures, °C, by engine node id */
export const nodeTemps = new Map<string, number>();

/** the primary selection (last-selected part id), for single-part panels */
export const selectedOne = (s: { selection: string[] }): string | null =>
  s.selection.length ? s.selection[s.selection.length - 1] : null;

// copy/paste buffer (in-memory; survives system switches, not reloads)
let clipboard: ClipboardData | null = null;

let worker: Worker | null = null;
// injectable for tests (node has no Worker); production uses the Vite worker bundle
let workerFactory: () => Worker = () => new EngineWorker();

function ensureWorker(set: (p: Partial<AppState>) => void, get: () => AppState): Worker {
  if (worker) return worker;
  worker = workerFactory();
  worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'loaded': {
        const engGauges = get().compiled?.engine.gauges ?? [];
        const labels = msg.gaugeIds.map((id) => {
          const g = engGauges.find((x) => x.id === id);
          return g ? `${id} · ${g.type}` : id;
        });
        resetChartHistory(msg.gaugeIds, labels);
        set({ simLoaded: true, eventLog: [], chartTick: 0, flows: null });
        break;
      }
      case 'snapshot': {
        for (const n of msg.snap.nodes) {
          nodePressures.set(n.id, n.pTotal);
          nodePartials.set(n.id, n.partials);
          nodeTemps.set(n.id, n.tempC);
        }
        appendSamples(msg.samples);
        set({
          snapshot: msg.snap,
          running: msg.running,
          ffActive: msg.ffActive,
          eventLog: msg.log.length ? [...get().eventLog, ...msg.log] : get().eventLog,
          chartTick: get().chartTick + 1,
        });
        break;
      }
      case 'ffdone':
        set({ ffActive: false });
        break;
      case 'flows':
        set({ flows: msg.report });
        break;
      case 'error':
        set({
          running: false,
          eventLog: [...get().eventLog, { t: get().snapshot?.t ?? 0, severity: 'error', message: `engine: ${msg.message}` }],
        });
        break;
    }
  };
  return worker;
}

const send = (cmd: WorkerCmd) => worker?.postMessage(cmd);

/** params that can be pushed into a RUNNING sim without recompiling */
function liveParamAction(inst: PartInstance, key: string, value: number | string | boolean): SimEventAction | null {
  const def = PART_BY_ID[inst.def];
  if (!def) return null;
  if ((def.kind === 'valve' || def.kind === 'valve-metering' || def.kind === 'valve-vent' || def.kind === 'valve-gas') && key === 'open') {
    return { type: 'valve', edgeId: inst.id, open: value ? 1 : 0 };
  }
  if (def.kind === 'valve-butterfly' && key === 'open') {
    return { type: 'valve', edgeId: inst.id, open: (value as number) / 100 };
  }
  if (def.kind === 'pump' && key === 'on') return { type: 'pump', pumpId: inst.id, on: Boolean(value) };
  if ((def.kind === 'coldtrap-meissner' || def.kind === 'coldtrap-inline') && key === 'on') {
    return { type: 'pump', pumpId: inst.id, on: Boolean(value) };
  }
  if (def.kind === 'pump' && key === 'ballast') return { type: 'ballast', pumpId: inst.id, on: Boolean(value) };
  if (def.kind === 'gauge' && key === 'enabled') return { type: 'gauge', gaugeId: inst.id, enabled: Boolean(value) };
  if (def.kind === 'leak' && key === 'qStd') return { type: 'setLeak', leakId: inst.id, qStd: value as number };
  return null;
}

export const useStore = create<AppState>((set, get) => ({
  system: emptySystem(),
  selection: [],
  connectFrom: null,
  placing: null,
  compiled: null,
  warnings: [],
  stale: false,

  running: false,
  ffActive: false,
  speed: 10,
  snapshot: null,
  simLoaded: false,
  eventLog: [],
  chartTick: 0,
  flows: null,

  unit: 'Torr',
  truthOverlay: false,
  logTime: false,
  showValues: false,
  paletteOpen: false,
  fitTick: 0,
  highlightParts: null,
  bottomTab: 'charts',
  histTick: 0,

  setPlacing: (defId) => set({ placing: defId, connectFrom: null, paletteOpen: false }),

  addPart: (defId, x, y) => {
    const def = PART_BY_ID[defId];
    const id = freshId(defId.split('-')[0]);
    pushUndo(get().system);
    const inst: PartInstance = { id, def: defId, x, y, rot: 0, params: { ...def.defaults } };
    set({
      system: { ...get().system, parts: [...get().system.parts, inst] },
      selection: [id],
      stale: true,
    });
    return id;
  },

  movePart: (id, x, y) => get().moveParts([{ id, x, y }]),

  // the Canvas captures JSON.stringify(system) on drag start and commits it
  // here on drop; like moveParts this leaves `system` untouched
  commitDragUndo: (preJson) => {
    undoStack.push(preJson);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    bumpHist();
  },

  moveParts: (entries) => {
    const byId = new Map(entries.map((e) => [e.id, e]));
    set({
      system: {
        ...get().system,
        parts: get().system.parts.map((p) => {
          const e = byId.get(p.id);
          return e ? { ...p, x: e.x, y: e.y } : p;
        }),
      },
    });
  },

  rotatePart: (id) => {
    pushUndo(get().system);
    set({
      system: {
        ...get().system,
        parts: get().system.parts.map((p) =>
          p.id === id ? { ...p, rot: (((p.rot + 90) % 360) as PartInstance['rot']) } : p,
        ),
      },
      stale: true,
    });
  },

  rotateSelection: () => {
    const st = get();
    if (st.selection.length === 0) return;
    const sel = new Set(st.selection);
    pushUndo(st.system);
    set({
      system: {
        ...st.system,
        parts: st.system.parts.map((p) =>
          sel.has(p.id) ? { ...p, rot: (((p.rot + 90) % 360) as PartInstance['rot']) } : p,
        ),
      },
      stale: true,
    });
  },

  setParam: (id, key, value) => {
    const st = get();
    const inst = st.system.parts.find((p) => p.id === id);
    if (!inst) return;
    pushUndo(st.system);
    set({
      system: {
        ...st.system,
        parts: st.system.parts.map((p) =>
          p.id === id ? { ...p, params: { ...p.params, [key]: value } } : p,
        ),
      },
    });
    const action = liveParamAction(inst, key, value);
    if (action && st.simLoaded) {
      const translated = st.compiled ? translateAction(action, st.compiled) : action;
      if (translated) send({ type: 'action', action: translated });
    } else {
      set({ stale: true });
    }
  },

  deletePart: (id) => get().deleteParts([id]),

  deleteParts: (ids) => {
    const st = get();
    if (ids.length === 0) return;
    const gone = new Set(ids);
    pushUndo(st.system);
    set({
      system: {
        ...st.system,
        parts: st.system.parts.filter((p) => !gone.has(p.id)),
        connections: st.system.connections.filter((c) => !gone.has(c.a.part) && !gone.has(c.b.part)),
      },
      selection: st.selection.filter((s) => !gone.has(s)),
      stale: true,
    });
  },

  select: (id) => set({ selection: id ? [id] : [], connectFrom: null }),

  toggleSelect: (id) =>
    set({
      selection: get().selection.includes(id)
        ? get().selection.filter((s) => s !== id)
        : [...get().selection, id],
      connectFrom: null,
    }),

  selectMany: (ids, additive) => {
    const base = additive ? get().selection.filter((s) => !ids.includes(s)) : [];
    set({ selection: [...base, ...ids], connectFrom: null });
  },

  selectAll: () => set({ selection: get().system.parts.map((p) => p.id), connectFrom: null }),

  copySelection: () => {
    const st = get();
    clipboard = copyParts(st.system, st.selection) ?? clipboard;
  },

  pasteClipboard: () => {
    if (!clipboard) return;
    const st = get();
    const { parts, connections, ids } = buildPaste(clipboard, freshId);
    pushUndo(st.system);
    set({
      system: {
        ...st.system,
        parts: [...st.system.parts, ...parts],
        connections: [...st.system.connections, ...connections],
      },
      selection: ids,
      stale: true,
    });
  },

  duplicateSelection: () => {
    const st = get();
    const clip = copyParts(st.system, st.selection);
    if (!clip) return;
    const { parts, connections, ids } = buildPaste(clip, freshId);
    pushUndo(st.system);
    set({
      system: {
        ...st.system,
        parts: [...st.system.parts, ...parts],
        connections: [...st.system.connections, ...connections],
      },
      selection: ids,
      stale: true,
    });
  },

  spliceIntoWire: (defId, connId, x, y, rot) => {
    const st = get();
    const def = PART_BY_ID[defId];
    const conn = st.system.connections.find((c) => c.id === connId);
    if (!def || !conn || def.ports.length !== 2) return;
    const endA = st.system.parts.find((p) => p.id === conn.a.part);
    if (!endA) return;
    pushUndo(st.system);
    const id = freshId(defId.split('-')[0]);
    const inst: PartInstance = { id, def: defId, x, y, rot, params: { ...def.defaults } };
    // the new port nearer to the old endpoint A takes its side
    const aPos = portPos(endA, conn.a.port);
    const d0 = Math.hypot(portPos(inst, 0).x - aPos.x, portPos(inst, 0).y - aPos.y);
    const d1 = Math.hypot(portPos(inst, 1).x - aPos.x, portPos(inst, 1).y - aPos.y);
    const portA = d0 <= d1 ? 0 : 1;
    set({
      system: {
        ...st.system,
        parts: [...st.system.parts, inst],
        connections: [
          ...st.system.connections.filter((c) => c.id !== connId),
          { id: freshId('c'), a: conn.a, b: { part: id, port: portA } },
          { id: freshId('c'), a: { part: id, port: 1 - portA }, b: conn.b },
        ],
      },
      selection: [id],
      stale: true,
    });
  },

  beginConnect: (part, port) => set({ connectFrom: { part, port } }),

  completeConnect: (part, port) => {
    const st = get();
    const from = st.connectFrom;
    if (!from || (from.part === part && from.port === port)) {
      set({ connectFrom: null });
      return;
    }
    // refuse duplicate connections on a port
    const used = (p: string, i: number) =>
      st.system.connections.some(
        (c) => (c.a.part === p && c.a.port === i) || (c.b.part === p && c.b.port === i),
      );
    if (used(from.part, from.port) || used(part, port)) {
      set({ connectFrom: null });
      return;
    }
    pushUndo(st.system);
    const conn: Connection = { id: freshId('c'), a: { part: from.part, port: from.port }, b: { part, port } };
    set({
      system: { ...st.system, connections: [...st.system.connections, conn] },
      connectFrom: null,
      stale: true,
    });
  },

  toggleMesh: (connId) => {
    pushUndo(get().system);
    set({
      system: {
        ...get().system,
        connections: get().system.connections.map((c) =>
          c.id === connId ? { ...c, mesh: !c.mesh } : c,
        ),
      },
      stale: true,
    });
  },

  disconnect: (connId) => {
    pushUndo(get().system);
    set({
      system: {
        ...get().system,
        connections: get().system.connections.filter((c) => c.id !== connId),
      },
      stale: true,
    });
  },

  undo: () => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(JSON.stringify(get().system));
    set({ system: JSON.parse(prev), stale: true, selection: [], histTick: get().histTick + 1 });
  },

  redo: () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(get().system));
    set({ system: JSON.parse(next), stale: true, selection: [], histTick: get().histTick + 1 });
  },

  tidyWiring: () => {
    const st = get();
    const t = tidyConnections(st.system);
    if (!t.changed) return;
    pushUndo(st.system);
    set({ system: { ...st.system, connections: t.connections }, stale: true });
  },

  loadSystem: (sys) => {
    absorbIds(sys);
    const tidied = tidyConnections(sys);
    if (tidied.changed) sys = { ...sys, connections: tidied.connections };
    pushUndo(get().system);
    set({
      system: sys, selection: [], stale: true, snapshot: null,
      simLoaded: false, eventLog: [], fitTick: get().fitTick + 1,
    });
    get().loadSim(false);
  },

  newSystem: () => {
    pushUndo(get().system);
    set({ system: emptySystem(), selection: [], stale: true, snapshot: null, simLoaded: false });
  },

  renameSystem: (name) => set({ system: { ...get().system, name } }),
  setHumidity: (rh) => set({ system: { ...get().system, humidityRH: rh }, stale: true }),

  addScriptRow: (row) =>
    set({
      system: { ...get().system, script: [...get().system.script, { ...row, id: freshId('ev') }] },
      stale: true,
    }),
  updateScriptRow: (id, patch) =>
    set({
      system: {
        ...get().system,
        script: get().system.script.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
      stale: true,
    }),
  deleteScriptRow: (id) =>
    set({
      system: { ...get().system, script: get().system.script.filter((r) => r.id !== id) },
      stale: true,
    }),

  loadSim: (autorun) => {
    const st = get();
    ensureWorker(set, get);
    try {
      const compiled = compileSystem(st.system);
      const script: SimEvent[] = [];
      for (const row of [...st.system.script].sort((a, b) => a.t - b.t)) {
        const action = translateAction(row.action, compiled);
        if (action) script.push({ t: row.t, action });
      }
      set({ compiled, warnings: compiled.warnings, stale: false, flows: null });
      send({ type: 'load', engine: compiled.engine, script, autorun });
      if (autorun) set({ running: true });
    } catch (err) {
      set({ warnings: [String(err)] });
    }
  },

  runSim: () => {
    const st = get();
    if (!st.simLoaded || st.stale) {
      st.loadSim(true);
    } else {
      send({ type: 'run' });
      set({ running: true });
    }
  },

  pauseSim: () => {
    send({ type: 'pause' });
    set({ running: false });
  },

  resetSim: () => get().loadSim(false),

  setSpeed: (v) => {
    send({ type: 'speed', value: v });
    set({ speed: v });
  },

  fastForward: () => {
    const st = get();
    if (!st.simLoaded || st.stale) st.loadSim(false);
    send({ type: 'ff' });
    set({ ffActive: true });
  },

  liveAction: (a) => {
    const st = get();
    const translated = st.compiled ? translateAction(a, st.compiled) : a;
    if (translated) send({ type: 'action', action: translated });
  },

  requestFlows: () => {
    const st = get();
    // focus the diagnosis on the user's chambers (post-merge engine node ids)
    const focus = st.compiled
      ? st.system.parts
          .filter((p) => PART_BY_ID[p.def]?.kind === 'chamber')
          .map((p) => st.compiled!.regionNode[`${p.id}:0`])
          .filter((n): n is string => !!n)
      : undefined;
    send({ type: 'flows', focus });
  },

  setUnit: (u) => set({ unit: u }),
  setTruthOverlay: (v) => set({ truthOverlay: v }),
  setLogTime: (v) => set({ logTime: v }),
  setShowValues: (v) => set({ showValues: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  requestFit: () => set({ fitTick: get().fitTick + 1 }),
  setBottomTab: (t) => set({ bottomTab: t }),
  setHighlightParts: (ids) => set({ highlightParts: ids }),
}));

// ------------------------------------------------------------- test hooks ----

/** Replace (or restore, with null) the worker constructor. Tests only. */
export function _setWorkerFactory(f: (() => Worker) | null): void {
  workerFactory = f ?? (() => new EngineWorker());
  worker = null;
}

/** Reset store state and undo/redo stacks to boot defaults. Tests only. */
export function _resetForTests(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  worker = null;
  useStore.setState({
    system: emptySystem(),
    selection: [], connectFrom: null, placing: null,
    compiled: null, warnings: [], stale: false,
    running: false, ffActive: false, snapshot: null, simLoaded: false,
    eventLog: [], chartTick: 0, flows: null,
    unit: 'Torr', highlightParts: null, histTick: 0,
  });
}
