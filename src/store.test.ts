import { beforeEach, describe, expect, it } from 'vitest';
import {
  UNIT_FACTOR, _resetForTests, _setWorkerFactory, chartHistory, formatPressure,
  getPinnedRun, redoDepth, undoDepth, useStore,
} from './store';
import type { SimSnapshot } from './types';
import { PART_BY_ID } from './data/fittings';
import type { WorkerCmd } from './engine/worker';

/**
 * Store-layer tests, made possible by the injectable worker factory
 * (node has no Worker). The fake records postMessage traffic and lets a test
 * drive onmessage by hand.
 */

interface FakeWorker {
  posted: WorkerCmd[];
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(cmd: WorkerCmd): void;
  terminate(): void;
}

let fake: FakeWorker;

const st = () => useStore.getState();

// pick real catalog defs by kind so the tests survive id churn
const defOf = (pred: (d: (typeof PART_BY_ID)[string]) => boolean): string => {
  const d = Object.values(PART_BY_ID).find(pred);
  if (!d) throw new Error('no catalog part matches');
  return d.id;
};
const CHAMBER = defOf((d) => d.kind === 'chamber');
const TUBE = defOf((d) => d.kind === 'tube' && d.ports.length === 2);
const VALVE = defOf((d) => d.kind === 'valve' && d.ports.length === 2);

beforeEach(() => {
  fake = {
    posted: [],
    onmessage: null,
    postMessage(cmd) { this.posted.push(cmd); },
    terminate() {},
  };
  _setWorkerFactory(() => fake as unknown as Worker);
  _resetForTests();
});

describe('undo / redo', () => {
  it('round-trips edits and clears redo on a new edit', () => {
    expect(undoDepth()).toBe(0);
    expect(redoDepth()).toBe(0);
    const tick0 = st().histTick;
    const a = st().addPart(CHAMBER, 2, 2);
    st().addPart(TUBE, 8, 3);
    expect(st().system.parts).toHaveLength(2);
    expect(undoDepth()).toBe(2);
    expect(st().histTick).toBeGreaterThan(tick0); // buttons re-derive from this

    st().undo();
    expect(st().system.parts.map((p) => p.id)).toEqual([a]);
    expect(redoDepth()).toBe(1);
    st().redo();
    expect(st().system.parts).toHaveLength(2);
    expect(redoDepth()).toBe(0);

    st().undo(); // back to 1 part
    st().addPart(VALVE, 5, 5); // divergent edit
    st().redo(); // redo stack was cleared — no change
    expect(st().system.parts).toHaveLength(2);
    expect(st().system.parts.some((p) => p.def === VALVE)).toBe(true);
  });

  it('undo on an empty stack is a no-op', () => {
    const before = st().system;
    st().undo();
    expect(st().system).toBe(before);
  });
});

describe('drag undo (commitDragUndo)', () => {
  it('a whole drag undoes as ONE step, back to pre-drag positions', () => {
    const a = st().addPart(CHAMBER, 2, 2);
    const pre = JSON.stringify(st().system);

    // simulate the Canvas drag: many silent moveParts, one commit on drop
    st().moveParts([{ id: a, x: 3, y: 2 }]);
    st().moveParts([{ id: a, x: 5, y: 4 }]);
    st().moveParts([{ id: a, x: 9, y: 9 }]);
    st().commitDragUndo(pre);
    expect(st().system.parts[0]).toMatchObject({ x: 9, y: 9 });

    st().undo(); // one step: back to where the drag started
    expect(st().system.parts[0]).toMatchObject({ x: 2, y: 2 });
    st().undo(); // next step: before the part existed
    expect(st().system.parts).toHaveLength(0);
  });
});

describe('structural edits', () => {
  it('deleteParts drops connections touching the deleted parts', () => {
    const a = st().addPart(CHAMBER, 2, 2);
    const b = st().addPart(TUBE, 9, 3);
    st().beginConnect(a, 0);
    st().completeConnect(b, 0);
    expect(st().system.connections).toHaveLength(1);

    st().deleteParts([a]);
    expect(st().system.parts.map((p) => p.id)).toEqual([b]);
    expect(st().system.connections).toHaveLength(0);

    st().undo();
    expect(st().system.parts).toHaveLength(2);
    expect(st().system.connections).toHaveLength(1);
  });

  it('spliceIntoWire is a single composite undo step', () => {
    const a = st().addPart(CHAMBER, 2, 2);
    const b = st().addPart(TUBE, 12, 3);
    st().beginConnect(a, 0);
    st().completeConnect(b, 0);
    const conn = st().system.connections[0];
    const preParts = st().system.parts.length;

    st().spliceIntoWire(VALVE, conn.id, 7, 3, 0);
    expect(st().system.parts).toHaveLength(preParts + 1);
    expect(st().system.connections).toHaveLength(2);
    expect(st().system.connections.some((c) => c.id === conn.id)).toBe(false);

    st().undo();
    expect(st().system.parts).toHaveLength(preParts);
    expect(st().system.connections.map((c) => c.id)).toEqual([conn.id]);
  });

  it('loadSystem replaces the system, clears selection, auto-loads the sim', () => {
    st().addPart(CHAMBER, 2, 2);
    st().addPart(TUBE, 9, 3);
    const sys = st().system;

    _resetForTests();
    _setWorkerFactory(() => fake as unknown as Worker);
    st().loadSystem(sys);
    expect(st().system.parts).toHaveLength(2);
    expect(st().selection).toEqual([]);
    // loadSystem ends in loadSim(false): compiled + sent to the worker, not stale
    expect(st().stale).toBe(false);
    expect(st().compiled).not.toBeNull();
    expect(fake.posted.some((c) => c.type === 'load')).toBe(true);
    expect(st().simLoaded).toBe(false); // flips only on the worker's reply
  });
});

describe('worker seam', () => {
  it('loadSim compiles and posts a load command to the injected worker', () => {
    const a = st().addPart(CHAMBER, 2, 2);
    st().addPart(TUBE, 9, 3);
    st().beginConnect(a, 0);
    st().completeConnect(st().system.parts[1].id, 0);

    st().loadSim(false);
    const load = fake.posted.find((c) => c.type === 'load');
    expect(load).toBeDefined();
    expect(st().stale).toBe(false);
    expect(st().compiled).not.toBeNull();
    expect(st().simLoaded).toBe(false); // flips only on the worker's reply

    fake.onmessage!({ data: { type: 'loaded', gaugeIds: [] } } as MessageEvent);
    expect(st().simLoaded).toBe(true);
  });
});

describe('pinned comparison run', () => {
  it('pinRun deep-copies the chart history and survives the worker reset a re-run causes', () => {
    chartHistory.gaugeIds = ['g1'];
    chartHistory.labels = ['g1 · pirani'];
    chartHistory.t = [0, 1, 2];
    chartHistory.values = [[7, 6, 5]];
    chartHistory.truths = [[7, 6, 5]];
    useStore.setState({ snapshot: { t: 2 } as SimSnapshot });
    st().pinRun();
    const pin = getPinnedRun();
    expect(pin?.history.t).toEqual([0, 1, 2]);
    expect(pin?.label).toContain('pinned at');

    // a re-run makes the worker report 'loaded', wiping the LIVE history —
    // the pinned copy must not move
    st().addPart(CHAMBER, 2, 2);
    st().loadSim(false);
    fake.onmessage!({ data: { type: 'loaded', gaugeIds: ['g1'] } } as MessageEvent);
    expect(chartHistory.t).toEqual([]);
    expect(getPinnedRun()?.history.t).toEqual([0, 1, 2]);
    expect(getPinnedRun()?.history.values[0]).toEqual([7, 6, 5]);

    st().clearPin();
    expect(getPinnedRun()).toBeNull();
  });
});

describe('units', () => {
  it('UNIT_FACTOR and formatPressure agree with the Torr anchors', () => {
    expect(UNIT_FACTOR.Torr).toBe(1);
    expect(UNIT_FACTOR.mbar).toBeCloseTo(1.33322, 5);
    expect(UNIT_FACTOR.Pa).toBeCloseTo(133.322, 3);
    expect(UNIT_FACTOR.mTorr).toBe(1000);
    expect(formatPressure(1, 'Pa')).toBe('133 Pa');
    expect(formatPressure(1e-6, 'Torr')).toBe('1.00e-6 Torr');
    expect(formatPressure(Number.NaN, 'Torr')).toBe('—');
    st().setUnit('mbar');
    expect(st().unit).toBe('mbar');
  });
});
