import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import { compileConductance } from '../conductance';
import type { EngineSystemSpec, GasId } from '../../types';

/**
 * Per-node temperature + power-fail physics. The master identity — at a
 * uniform 20 °C everything reduces EXACTLY to the isothermal model — is
 * guarded by the entire pre-existing suite staying green; these tests cover
 * the new behavior.
 */

const base = (over: Partial<EngineSystemSpec>): EngineSystemSpec => ({
  nodes: [], edges: [], pumps: [], leaks: [], gauges: [],
  species: ['air', 'H2O', 'H2', 'He'],
  startAtAtmosphere: true,
  ...over,
});

describe('temperature identity', () => {
  it('cOf without tRel is bit-identical to tRel = 1, and molecular scales as √tRel', () => {
    const species: GasId[] = ['air', 'H2', 'H2O'];
    const tube = compileConductance({ kind: 'tube', d: 2.5, L: 100 }, species);
    const ap = compileConductance({ kind: 'aperture', area: 5 }, species);
    const fixed = compileConductance({ kind: 'fixed', value: 0.3, speciesScaling: 'molecular' }, species);
    for (const p of [1e-8, 1e-3, 1, 100]) {
      for (let g = 0; g < 3; g++) {
        expect(tube.cOf(g, p, 1, 1)).toBe(tube.cOf(g, p, 1));
        expect(ap.cOf(g, p, 0.7, 1)).toBe(ap.cOf(g, p, 0.7));
        expect(fixed.cOf(g, p, 1, 1)).toBe(fixed.cOf(g, p, 1));
      }
    }
    // deep molecular limit: exact √tRel scaling
    const tRel = 1.44;
    expect(tube.cOf(0, 1e-9, 1, tRel) / tube.cOf(0, 1e-9, 1)).toBeCloseTo(Math.sqrt(tRel), 6);
    expect(fixed.cOf(0, 1e-9, 1, tRel) / fixed.cOf(0, 1e-9, 1)).toBe(Math.sqrt(tRel));
  });

  it('setTemperature to ambient mid-run is physically a no-op', () => {
    const mk = () => new Sim(base({
      nodes: [{ id: 'ch', volume: 20, label: 'chamber' }],
      pumps: [{ id: 'p1', node: 'ch', model: { kind: 'displacement', sPeak: 5, pUlt: 1e-3 }, on: true }],
      leaks: [{ id: 'lk', node: 'ch', qStd: 1e-6 }],
    }));
    const a = mk();
    const b = mk();
    b.scheduleEvents([
      { t: 5, action: { type: 'setTemperature', nodeIds: 'all', temperatureC: 20 } },
      { t: 20, action: { type: 'setTemperature', nodeIds: ['ch'], temperatureC: 20 } },
    ]);
    a.advance(60);
    b.advance(60);
    // only the event-driven dt resets differ — trajectories agree within error control
    expect(b.pressureOf('ch') / a.pressureOf('ch')).toBeCloseTo(1, 2);
  });
});

describe('ideal-gas heating', () => {
  it('sealed chamber: p tracks T exactly (isochoric), and returns on cooling', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 10, label: 'sealed' }],
    }));
    sim.scheduleEvents([
      { t: 1, action: { type: 'setTemperature', nodeIds: 'all', temperatureC: 100, tauOverride: 50 } },
    ]);
    sim.advance(1 + 50 * 12); // 12τ: fully settled
    const hot = sim.pressureOf('ch');
    expect(hot / 760).toBeCloseTo(373.15 / 293.15, 3);
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 20, tauOverride: 50 });
    sim.advance(50 * 12);
    expect(sim.pressureOf('ch') / 760).toBeCloseTo(1, 3);
  });
});

describe('bake by temperature (dose)', () => {
  const bakeSys = () => base({
    nodes: [{
      id: 'ch', volume: 5, label: 'chamber',
      surfaces: [{ area: 1000, material: 'ss304' }],
    }],
    pumps: [{ id: 'p1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
  });

  it('holding 150 °C long enough flips baked; outgassing spikes while hot', () => {
    const sim = new Sim(bakeSys());
    sim.advance(1800);
    const before = sim.pressureOf('ch');
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 150, tauOverride: 60 });
    sim.advance(1800);
    const during = sim.pressureOf('ch');
    expect(during / before).toBeGreaterThan(30); // Arrhenius ×147 at 150 °C, minus decay drift
    expect(sim.net.surfaces[0].baked).toBe(false); // dose not yet reached (~1 h at 150 °C)
    sim.advance(70000); // total hot time ≈ 20 h > 16.7 h dose target
    expect(sim.net.surfaces[0].baked).toBe(true);
    // cool down: H2O load collapses vs an unbaked control at the same age
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 20, tauOverride: 60 });
    sim.advance(4000);
    const ctrl = new Sim(bakeSys());
    ctrl.advance(sim.t);
    expect(sim.partialOf('ch', 'H2O')).toBeLessThan(ctrl.partialOf('ch', 'H2O') / 10);
  });
});

describe('power failure', () => {
  const turboSys = () => base({
    nodes: [
      // start already roughed — a turbo alone can't cross over from 760 Torr
      { id: 'ch', volume: 50, label: 'chamber', initial: { air: 1e-4 } },
      { id: 'fl', volume: 0.2, label: 'foreline', initial: { air: 5e-3 } },
    ],
    pumps: [
      {
        id: 'turbo', node: 'ch', backingNode: 'fl', on: true,
        model: {
          kind: 'turbo', sPeak: 80, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 5e3 },
          pCritBack: 0.5, tauSpin: 30, cOff: 2,
        },
      },
      { id: 'scroll', node: 'fl', on: true, model: { kind: 'displacement', sPeak: 3, pUlt: 5e-3 } },
    ],
    leaks: [{ id: 'lk', node: 'ch', qStd: 1e-6 }],
  });

  it('coast-down floods the chamber; restore recovers; control unaffected', () => {
    const sim = new Sim(turboSys());
    sim.advance(600);
    sim.fastForward(86400);
    const pBase = sim.pressureOf('ch');
    expect(pBase).toBeLessThan(1e-7);
    const t0 = sim.t;
    sim.applyAction({ type: 'powerFail', restoreAfter: 300 });
    sim.advance(300);
    const pDark = sim.pressureOf('ch');
    expect(pDark / pBase).toBeGreaterThan(100); // ≥2 decades within 5 min
    // restore fired at t0+300: pumps return, system recovers
    sim.advance(3600);
    expect(sim.pressureOf('ch')).toBeLessThan(1e-6);
    expect(sim.t).toBeGreaterThan(t0 + 3600);

    const ctrl = new Sim(turboSys());
    ctrl.advance(600);
    ctrl.fastForward(86400);
    ctrl.advance(300);
    expect(ctrl.pressureOf('ch') / pBase).toBeLessThan(3); // no fail → no flood
  });

  it('K0 collapses log-linearly with spin (bit-exact at full speed)', () => {
    const sim = new Sim(turboSys());
    const pm = sim.net.pumps.find((p) => p.spec.id === 'turbo')!;
    const partials = new Float64Array(4);
    pm.freeze(1e-8, 1e-3, partials);
    const kapFull = pm.kap[0];
    expect(kapFull).toBeCloseTo(1e-8, 20); // exactly 1/K0(air)
    pm.spinFrac = 0.5;
    pm.freeze(1e-8, 1e-3, partials);
    expect(Math.log(pm.kap[0])).toBeCloseTo(0.5 * Math.log(kapFull), 10); // K0^0.5
  });

  it('electronic gauges die on power fail; the bourdon survives; restore revives', () => {
    const sim = new Sim(base({
      // low start: a hot cathode enabled at atmosphere would trip on its own
      nodes: [{ id: 'ch', volume: 5, label: 'chamber', initial: { air: 1e-7 } }],
      gauges: [
        { id: 'hc', node: 'ch', type: 'hotcathode', seed: 3 },
        { id: 'bd', node: 'ch', type: 'bourdon', seed: 4 },
      ],
      pumps: [{ id: 'p1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
    }));
    sim.advance(30);
    sim.applyAction({ type: 'powerFail' });
    sim.advance(5);
    let snap = sim.snapshot();
    expect(snap.powerFailed).toBe(true);
    expect(snap.gauges.find((g) => g.id === 'hc')!.status).toBe('off');
    expect(Number.isFinite(snap.gauges.find((g) => g.id === 'bd')!.value)).toBe(true);
    sim.applyAction({ type: 'powerRestore', pumpIds: 'all', gaugeIds: 'all' });
    sim.advance(5);
    snap = sim.snapshot();
    expect(snap.powerFailed).toBe(false);
    expect(snap.gauges.find((g) => g.id === 'hc')!.status).not.toBe('off');
  });
});

describe('cryo warm-up release', () => {
  it('a warming cold head re-emits its inventory, but the gas phase pins at psat — the rest condenses on the walls', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 5, label: 'chamber', initial: { air: 1e-8 } }],
      pumps: [{
        id: 'cryo', node: 'ch', on: true,
        model: { kind: 'cryo', sPeak: { H2O: 100, N2: 50 }, capacity: { H2O: 1000 }, crossoverWarn: 0.5 },
      }],
    }));
    const pm = sim.net.pumps[0];
    const node = sim.net.nodes[sim.net.nodeIndex.get('ch')!];
    const h2o = sim.net.species.indexOf('H2O');
    pm.capacityUsed[h2o] = 300; // pre-loaded ice
    sim.advance(300); // cold + on: gates closed, nothing escapes
    expect(pm.capacityUsed[h2o]).toBeCloseTo(300, 6);
    expect(sim.partialOf('ch', 'H2O')).toBeLessThan(1e-6);

    sim.applyAction({ type: 'pump', pumpId: 'cryo', on: false });
    sim.advance(1500); // head warms through the 165 K H2O gate, τ_release = 120 s
    expect(pm.capacityUsed[h2o]).toBeLessThan(1);
    // 300 Torr·L into 5 L would be 60 Torr of water vapor — 3.4× above
    // saturation at 20 °C, physically impossible. The gas phase pins at psat
    // and the excess sits as condensate ("regen dew"), mass-balanced.
    const pW = sim.partialOf('ch', 'H2O');
    expect(pW).toBeGreaterThan(17.5 * 0.95);
    expect(pW).toBeLessThan(17.5 * 1.1);
    const total = pW * 5 + node.condensedH2O;
    expect(total).toBeGreaterThan(300 * 0.95);
    expect(total).toBeLessThan(300 * 1.05);
  });
});

describe('turbo coast-down', () => {
  it('coasts ~20× slower than it spins up; high inlet pressure brakes the rotor in seconds', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 50, label: 'chamber', initial: { air: 1e-8 } }],
      pumps: [{
        id: 'turbo', node: 'ch', on: true,
        model: {
          kind: 'turbo', sPeak: 80, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 5e3 },
          pCritBack: 0.5, tauSpin: 30, cOff: 2,
        },
      }],
    }));
    const pm = sim.net.pumps.find((p) => p.spec.id === 'turbo')!;
    const q = new Float64Array(4);
    // spin-up from rest: τ = tauSpin = 30 s
    pm.spinFrac = 0;
    pm.advance(30, 0, 1e-8, q);
    expect(pm.spinFrac).toBeCloseTo(1 - Math.exp(-1), 2);
    // coast in high vacuum: bearing friction only, τ = 20·tauSpin = 600 s
    pm.on = false;
    pm.spinFrac = 1;
    pm.advance(600, 10, 1e-8, q);
    expect(pm.spinFrac).toBeCloseTo(Math.exp(-1), 2);
    // coast at 1 Torr inlet: windage dominates (τ_eff ≈ 6.6 s)
    pm.spinFrac = 1;
    pm.advance(30, 20, 1, q);
    expect(pm.spinFrac).toBeLessThan(0.05);
  });
});

describe('water saturation clamp', () => {
  it('a supersaturated node pins at psat(T); condensate re-evaporates on heating and returns on cooling', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 2, label: 'wet', initial: { H2O: 100 } }],
    }));
    sim.advance(120);
    const node = sim.net.nodes[sim.net.nodeIndex.get('ch')!];
    expect(sim.partialOf('ch', 'H2O')).toBeCloseTo(17.5, 0);
    expect(node.condensedH2O).toBeGreaterThan(155); // (100 − 17.5)·2 ≈ 165
    expect(node.condensedH2O).toBeLessThan(172);
    // mass balance within the ±5% the u-space step bookkeeping allows
    // (same class as cryo capacity integration)
    const total = sim.partialOf('ch', 'H2O') * 2 + node.condensedH2O;
    expect(total).toBeGreaterThan(190);
    expect(total).toBeLessThan(206);

    // heat to 60 °C: psat(333 K) ≈ 148 Torr — the whole inventory re-evaporates
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 60, tauOverride: 30 });
    sim.advance(600);
    expect(node.condensedH2O).toBeLessThan(1);
    expect(sim.partialOf('ch', 'H2O')).toBeGreaterThan(80);

    // cool back: gas returns to psat, the rest condenses again. (Inventory is
    // p·V at the node temperature, so a condense-at-20°/evaporate-at-60°
    // cycle books ~12% low — documented standard-conditions simplification.)
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 20, tauOverride: 30 });
    sim.advance(900);
    expect(sim.partialOf('ch', 'H2O')).toBeCloseTo(17.5, 0);
    expect(node.condensedH2O).toBeGreaterThan(125);
    expect(node.condensedH2O).toBeLessThan(162);
  });
});

describe('vent gas discipline', () => {
  const ventedSys = (dry: boolean): EngineSystemSpec => base({
    species: ['air', 'N2', 'H2O', 'H2', 'He'],
    nodes: [
      { id: 'ch', volume: 30, label: 'chamber', surfaces: [{ area: 4000, material: 'ss304' }] },
      ...(dry ? [{ id: 'n2res', volume: 1, fixed: { N2: 800 } as Partial<Record<GasId, number>>, label: 'N2 line' }] : []),
    ],
    edges: [{
      id: 'vent', a: 'ch', b: dry ? 'n2res' : '_atm',
      conductance: { kind: 'tube', d: 1.6, L: 5 }, open: 0,
    }],
    pumps: [{ id: 'p1', node: 'ch', model: { kind: 'displacement', sPeak: 8, pUlt: 1e-8 }, on: true }],
  });

  it('venting with dry N2 keeps the walls dry — re-pumpdown carries ~50× less water than an air vent', () => {
    const run = (dry: boolean) => {
      const sim = new Sim(ventedSys(dry));
      sim.advance(3600); // pump to base
      sim.applyAction({ type: 'valve', edgeId: 'vent', open: 1 });
      sim.advance(900); // chamber floods to ~atmosphere
      expect(sim.pressureOf('ch')).toBeGreaterThan(300);
      sim.applyAction({ type: 'valve', edgeId: 'vent', open: 0 });
      sim.advance(7200); // re-pump for 2 h
      return sim;
    };
    const humid = run(false);
    const dry = run(true);
    // the exposure clock reset identically for both — only the recorded
    // humidity of the vent gas differs
    expect(humid.net.surfaces[0].ventRH).toBeGreaterThan(40);
    expect(humid.net.surfaces[0].ventRH).toBeLessThan(60);
    expect(dry.net.surfaces[0].ventRH).toBeLessThan(2);
    const ratio = humid.partialOf('ch', 'H2O') / dry.partialOf('ch', 'H2O');
    expect(ratio).toBeGreaterThan(10);
  });
});

describe('thermal transpiration', () => {
  it('an ion gauge on a hot zone under-reads by √(T0/T) in the molecular regime', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 5, label: 'hot zone', initial: { air: 1e-7 } }],
      gauges: [{ id: 'hc', node: 'ch', type: 'hotcathode', seed: 7 }],
    }));
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 150, tauOverride: 1 });
    sim.advance(20); // T settled; p rose with T (sealed); gauge lag settled
    const r = sim.snapshot().gauges[0];
    expect(r.value / r.truth).toBeGreaterThan(0.79);
    expect(r.value / r.truth).toBeLessThan(0.88); // √(293/423) ≈ 0.832 ± noise
  });

  it('no correction in the viscous regime', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 5, label: 'hot zone', initial: { air: 10 } }],
      gauges: [{ id: 'pi', node: 'ch', type: 'pirani', seed: 7 }],
    }));
    sim.applyAction({ type: 'setTemperature', nodeIds: 'all', temperatureC: 150, tauOverride: 1 });
    sim.advance(20);
    const r = sim.snapshot().gauges[0];
    expect(r.value / r.truth).toBeGreaterThan(0.85);
    expect(r.value / r.truth).toBeLessThan(1.15);
  });
});
