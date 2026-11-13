import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTests, _setWorkerFactory, chartHistory, undoDepth, useStore } from './store';
import type { SimSnapshot } from './types';
import { PART_BY_ID } from './data/fittings';
import type { WorkerCmd, WorkerMsg } from './engine/worker';

/**
 * Store behaviour that depends on the worker conversation: what a running
 * sim does to toggles, undo, New and fast-forward. Uses the injectable fake
 * worker (node has no Worker).
 */

interface FakeWorker {
  posted: WorkerCmd[];
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  postMessage(cmd: WorkerCmd): void;
  terminate(): void;
}

let fake: FakeWorker;
const st = () => useStore.getState();
const say = (msg: WorkerMsg) => fake.onmessage?.({ data: msg } as MessageEvent);

const defOf = (pred: (d: (typeof PART_BY_ID)[string]) => boolean): string => {
  const d = Object.values(PART_BY_ID).find(pred);
  if (!d) throw new Error('no catalog part matches');
  return d.id;
};
const CHAMBER = defOf((d) => d.kind === 'chamber');
const VALVE = defOf((d) => d.kind === 'valve' && d.ports.length === 2);
const PUMP = defOf((d) => d.kind === 'pump' && !d.data.backed);
const TUBE = defOf((d) => d.kind === 'tube' && d.ports.length === 2);

const snapshot = (over: Partial<SimSnapshot>): SimSnapshot => ({
  t: 100, dt: 1, species: ['air'], nodes: [], gauges: [], valves: [], pumps: [],
  steadyState: false, powerFailed: false, ...over,
});
const snapMsg = (snap: SimSnapshot): WorkerMsg =>
  ({ type: 'snapshot', snap, log: [], samples: [], running: true, ffActive: false });

beforeEach(() => {
  fake = {
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(cmd) { this.posted.push(cmd); },
    terminate() {},
  };
  _setWorkerFactory(() => fake as unknown as Worker);
  _resetForTests();
});

describe('live toggles', () => {
  it('a double-click flips the LIVE valve state, not the stale editor param', () => {
    const v = st().addPart(VALVE, 2, 2);
    expect(st().system.parts[0].params.open).toBeFalsy();
    st().loadSim(true);
    say({ type: 'loaded', gaugeIds: [] });
    // a script opened the valve: the editor param still says closed
    const edgeId = st().compiled!.valveEdge[v];
    say(snapMsg(snapshot({ valves: [{ id: edgeId, open: 1 }] })));

    fake.posted.length = 0;
    st().toggleLive(v);
    expect(fake.posted).toEqual([{ type: 'action', action: expect.objectContaining({ type: 'valve', open: 0 }) }]);
    expect(st().system.parts[0].params.open).toBe(false);
  });

  it('a pump the power failure stopped is switched back ON by a double-click', () => {
    const p = st().addPart(PUMP, 2, 2);
    st().setParam(p, 'on', true);
    st().loadSim(true);
    say({ type: 'loaded', gaugeIds: [] });
    say(snapMsg(snapshot({
      pumps: [{ id: p, on: false, sEffective: 0, atSpeed: false, spinFraction: 0.4, qHelium: 0, capacityFrac: null, capacityUsed: [] }],
    })));
    fake.posted.length = 0;
    st().toggleLive(p);
    expect(fake.posted).toEqual([{ type: 'action', action: { type: 'pump', pumpId: p, on: true } }]);
  });

  it('without a running sim it toggles the param', () => {
    const v = st().addPart(VALVE, 2, 2);
    st().toggleLive(v);
    expect(st().system.parts[0].params.open).toBe(true);
  });
});

describe('undo granularity', () => {
  it('a burst of edits to one field is a single undo step', () => {
    const c = st().addPart(CHAMBER, 2, 2);
    const before = undoDepth();
    for (const D of [310, 320, 330, 340, 350]) st().setParam(c, 'D', D);
    expect(undoDepth()).toBe(before + 1);
    st().undo();
    expect(st().system.parts[0].params.D).not.toBe(350);
    expect(st().system.parts[0].params.D).not.toBe(310);
  });

  it('edits to different fields stay separate steps', () => {
    const c = st().addPart(CHAMBER, 2, 2);
    const before = undoDepth();
    st().setParam(c, 'D', 310);
    st().setParam(c, 'L', 500);
    st().setParam(c, 'D', 320);
    expect(undoDepth()).toBe(before + 3);
  });

  it('script edits are undoable instead of being swept away by the next undo', () => {
    st().addPart(CHAMBER, 2, 2);
    st().rotatePart(st().system.parts[0].id);
    st().addScriptRow({ t: 10, action: { type: 'powerFail' } });
    st().addScriptRow({ t: 20, action: { type: 'powerFail' } });
    expect(st().system.script).toHaveLength(2);
    st().undo();
    expect(st().system.script).toHaveLength(1);
    expect(st().system.parts[0].rot).toBe(90); // the rotation survives
  });

  it('humidity edits are clamped, ignore garbage, and undo', () => {
    st().setHumidity(250);
    expect(st().system.humidityRH).toBe(100);
    st().setHumidity(Number('abc'));
    expect(st().system.humidityRH).toBe(100);
    st().undo();
    expect(st().system.humidityRH).toBe(50);
  });
});

describe('deleting parts', () => {
  it('takes script rows aimed at them along, and undo brings both back', () => {
    const c = st().addPart(CHAMBER, 2, 2);
    const v = st().addPart(VALVE, 6, 2);
    const t = st().addPart(TUBE, 9, 2);
    st().addScriptRow({ t: 5, action: { type: 'valve', edgeId: v, open: 1 } });
    st().addScriptRow({ t: 6, action: { type: 'setTemperature', nodeIds: [c, t], temperatureC: 150 } });
    st().addScriptRow({ t: 7, action: { type: 'powerFail' } });
    st().deleteParts([v, t]);
    expect(st().system.script.map((r) => r.action)).toEqual([
      { type: 'setTemperature', nodeIds: [c], temperatureC: 150 },
      { type: 'powerFail' },
    ]);
    st().undo();
    expect(st().system.script).toHaveLength(3);
    expect(st().system.parts).toHaveLength(3);
  });
});

describe('New', () => {
  it('unloads the worker and clears every trace of the old run', () => {
    st().addPart(CHAMBER, 2, 2);
    st().loadSim(true);
    say({ type: 'loaded', gaugeIds: ['g'] });
    say(snapMsg(snapshot({})));
    expect(st().snapshot).not.toBeNull();

    fake.posted.length = 0;
    st().newSystem();
    expect(fake.posted).toEqual([{ type: 'unload' }]);
    expect(st()).toMatchObject({
      running: false, simLoaded: false, snapshot: null, compiled: null, eventLog: [], warnings: [],
    });
    expect(chartHistory.gaugeIds).toEqual([]);
    // a snapshot already in flight from the old sim must not resurrect it
    say(snapMsg(snapshot({ t: 101 })));
    expect(st().snapshot).toBeNull();
    expect(st().running).toBe(false);
  });
});

describe('fast-forward', () => {
  it('reports a run that stopped short of steady state, and a crashed engine releases the controls', () => {
    st().addPart(CHAMBER, 2, 2);
    st().loadSim(false);
    say({ type: 'loaded', gaugeIds: [] });
    st().fastForward();
    expect(st().ffActive).toBe(true);
    const sent = fake.posted.filter((c) => c.type === 'ff').length;
    st().fastForward(); // already running: no second chain
    expect(fake.posted.filter((c) => c.type === 'ff').length).toBe(sent);

    say({ type: 'ffdone', converged: false, t: 3600 });
    expect(st().ffActive).toBe(false);
    expect(st().eventLog.at(-1)?.message).toContain('without reaching steady state');

    st().fastForward();
    fake.onerror?.({ message: 'boom' } as ErrorEvent);
    expect(st().ffActive).toBe(false);
    expect(st().running).toBe(false);
    expect(st().eventLog.at(-1)?.message).toContain('engine crashed: boom');
  });
});

describe('importSystem', () => {
  it('loads a repaired system and surfaces what was dropped', () => {
    const ok = st().importSystem({
      version: 1, name: 'old save',
      parts: [
        { id: 'ch', def: CHAMBER, x: 0, y: 0, rot: 0, params: {} },
        { id: 'gone', def: 'part-from-an-older-build', x: 4, y: 0, rot: 0, params: {} },
      ],
      connections: [{ id: 'c1', a: { part: 'ch', port: 0 }, b: { part: 'gone', port: 0 } }],
    });
    expect(ok).toBe(true);
    expect(st().system.parts.map((p) => p.id)).toEqual(['ch']);
    expect(st().system.connections).toEqual([]);
    expect(st().warnings.join(' ')).toContain('part-from-an-older-build');
  });

  it('refuses things that are not systems and leaves the current one alone', () => {
    st().addPart(CHAMBER, 2, 2);
    expect(st().importSystem({ version: 1, parts: 'x' })).toBe(false);
    expect(st().importSystem(null)).toBe(false);
    expect(st().system.parts).toHaveLength(1);
  });
});
