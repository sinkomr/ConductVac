import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import { segmentTube } from '../network';
import { PUMP_BY_ID } from '../../data/pumps';
import type { EngineSystemSpec, SimEvent } from '../../types';

/**
 * Build-order step 3: headless demo of example system 2 — scroll + turbo-300
 * on a CF160 chamber with gate valve, scripted rough → crossover → turbo.
 * Sanity-checks the crossover and the turbo-stall failure case (gate opened
 * at 10 Torr). Run `npm run demo` to see the pressure curves.
 */

function buildSystem(): EngineSystemSpec {
  // CF160 chamber: cylinder D=30 cm, L=40 cm → V ≈ 28.3 L, A ≈ 5183 cm²
  const hose = segmentTube({
    id: 'roughhose',
    from: 'ch',
    to: 'fl',
    d: 2.4,
    L: 100,
    lengthFactor: 1.4, // corrugated flex
    material: 'ss304',
  });
  return {
    // default reduced species set {air, H2O, H2, He}, 50% RH
    nodes: [
      {
        id: 'ch', volume: 28.3, label: 'Chamber',
        surfaces: [
          { area: 5183, material: 'ss304' },
          { area: 4, material: 'viton' }, // door O-ring + KF seals
        ],
      },
      { id: 'ti', volume: 0.5, label: 'Turbo inlet' },
      { id: 'fl', volume: 0.2, label: 'Foreline', surfaces: [{ area: 4, material: 'viton' }] },
      { id: 'si', volume: 0.1, label: 'Scroll inlet' },
      ...hose.nodes,
    ],
    edges: [
      // CF160 gate valve: full bore d=15 cm, short body
      { id: 'gate', a: 'ch', b: 'ti', conductance: { kind: 'tube', d: 15, L: 6 }, open: 0 },
      // roughing valve lives in the first hose segment path: add explicit valve edge ch->hose start
      ...hose.edges.map((e, i) => (i === 0 ? { ...e, id: 'roughvalve', open: 0 } : e)),
      { id: 'flpipe', a: 'fl', b: 'si', conductance: { kind: 'tube', d: 2.4, L: 30 } },
    ],
    pumps: [
      { id: 'turbo', node: 'ti', backingNode: 'fl', model: PUMP_BY_ID['turbo-300'].model, label: 'Turbo 300' },
      { id: 'scroll', node: 'si', model: PUMP_BY_ID['scroll-10'].model, label: 'Scroll' },
    ],
    leaks: [{ id: 'lk1', node: 'ch', qStd: 1e-6 }],
  };
}

function run(events: SimEvent[], tEnd: number, sampleEvery: number, header: string) {
  const sim = new Sim(buildSystem());
  sim.scheduleEvents(events);
  const rows: string[] = [
    `\n=== ${header} ===`,
    't[s]\tp_ch[Torr]\tp_foreline\tair\tH2O\tH2\tHe\tS_turbo\tspin',
  ];
  for (let t = sampleEvery; t <= tEnd + 1e-9; t += sampleEvery) {
    sim.advance(t - sim.t);
    const s = sim.snapshot();
    const ch = s.nodes.find((n) => n.id === 'ch')!;
    const fl = s.nodes.find((n) => n.id === 'fl')!;
    const turbo = s.pumps.find((x) => x.id === 'turbo')!;
    rows.push(
      [
        t.toFixed(0),
        ch.pTotal.toExponential(2),
        fl.pTotal.toExponential(2),
        ...ch.partials.map((v) => v.toExponential(1)),
        turbo.sEffective.toFixed(1),
        turbo.spinFraction.toFixed(2),
      ].join('\t'),
    );
  }
  console.log(rows.join('\n'));
  console.log('events:\n' + sim.log.map((e) => `  [${e.t.toFixed(1)}s ${e.severity}] ${e.message}`).join('\n'));
  return sim;
}

describe('example 2 headless demo', () => {
  it('normal sequence: rough → seal (rate-of-rise) → turbo crossover → outgassing plateau', () => {
    const events: SimEvent[] = [
      { t: 0, action: { type: 'pump', pumpId: 'scroll', on: true } },
      { t: 1, action: { type: 'valve', edgeId: 'roughvalve', open: 1, actuateTime: 1 } },
      { t: 120, action: { type: 'valve', edgeId: 'roughvalve', open: 0, actuateTime: 1 } },
      { t: 125, action: { type: 'pump', pumpId: 'turbo', on: true } },
      { t: 420, action: { type: 'valve', edgeId: 'gate', open: 1, actuateTime: 2 } },
    ];
    const sim = run(events, 1200, 30, 'example 2: normal rough→crossover→turbo');

    // plateau: unbaked outgassing floor in the 1e-7..3e-5 range, H2O-dominated
    const s = sim.snapshot();
    const ch = s.nodes.find((n) => n.id === 'ch')!;
    expect(ch.pTotal).toBeGreaterThan(1e-7);
    expect(ch.pTotal).toBeLessThan(3e-5);
    const gi = (g: string) => s.species.indexOf(g as never);
    expect(ch.partials[gi('H2O')]).toBeGreaterThan(ch.partials[gi('air')]);
    expect(ch.partials[gi('H2O')]).toBeGreaterThan(0.5 * ch.pTotal);

    // turbo at speed, pumping, no stall in the log
    const turbo = s.pumps.find((x) => x.id === 'turbo')!;
    expect(turbo.atSpeed).toBe(true);
    expect(turbo.sEffective).toBeGreaterThan(100);
    expect(sim.log.some((e) => e.message.includes('stalled'))).toBe(false);
    expect(sim.log.some((e) => e.message.includes('at speed'))).toBe(true);
  });

  it('crossover transient: gate opening drops the chamber ≥ 2 decades in 40 s', () => {
    const events: SimEvent[] = [
      { t: 0, action: { type: 'pump', pumpId: 'scroll', on: true } },
      { t: 1, action: { type: 'valve', edgeId: 'roughvalve', open: 1, actuateTime: 1 } },
      { t: 120, action: { type: 'valve', edgeId: 'roughvalve', open: 0, actuateTime: 1 } },
      { t: 125, action: { type: 'pump', pumpId: 'turbo', on: true } },
      { t: 420, action: { type: 'valve', edgeId: 'gate', open: 1, actuateTime: 2 } },
    ];
    const sim = new Sim(buildSystem());
    sim.scheduleEvents(events);
    sim.advance(419);
    const before = sim.pressureOf('ch');
    expect(before).toBeGreaterThan(0.05);
    expect(before).toBeLessThan(0.6);
    sim.advance(41);
    expect(sim.pressureOf('ch')).toBeLessThan(before / 100);
  });

  it('failure case: opening the gate at ~10 Torr stalls the turbo', () => {
    const events: SimEvent[] = [
      { t: 0, action: { type: 'pump', pumpId: 'scroll', on: true } },
      { t: 1, action: { type: 'valve', edgeId: 'roughvalve', open: 1, actuateTime: 1 } },
      // stop roughing early, chamber still ~10 Torr
      { t: 58, action: { type: 'valve', edgeId: 'roughvalve', open: 0, actuateTime: 1 } },
      { t: 60, action: { type: 'pump', pumpId: 'turbo', on: true } },
      // gate opens with the chamber at ~10 Torr — the turbo must visibly stall
      { t: 360, action: { type: 'valve', edgeId: 'gate', open: 1, actuateTime: 2 } },
    ];
    const sim = run(events, 600, 30, 'example 2 failure: gate opened at 10 Torr');

    const stall = sim.log.find((e) => e.message.includes('stalled'));
    expect(stall).toBeDefined();
    expect(stall!.t).toBeGreaterThan(359);
    expect(stall!.t).toBeLessThan(365);

    // during the stall the chamber hangs far above the normal-path pressure
    // (the normal sequence is at ~1e-5 Torr 90 s after its gate opening);
    // eventually the trickle through the overloaded rotor lets it recover
    const sim2 = new Sim(buildSystem());
    sim2.scheduleEvents(events);
    sim2.advance(450);
    expect(sim2.pressureOf('ch')).toBeGreaterThan(0.5);
    const recovery = sim.log.find((e) => e.message.includes('recovered'));
    expect(recovery).toBeDefined();
    expect(recovery!.t - stall!.t).toBeGreaterThan(60);
  });
});
