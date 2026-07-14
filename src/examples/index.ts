import type { PartInstance, ScriptRow, SimEventAction, SystemDefinition } from '../types';

/**
 * Bundled example systems (§3.5). Authored with a tiny builder and exported
 * as plain SystemDefinition objects — identical in shape to the JSON files
 * the app saves/loads. They double as integration-test fixtures
 * (src/engine/tests/examples.test.ts).
 */

class B {
  parts: PartInstance[] = [];
  connections: SystemDefinition['connections'] = [];
  script: ScriptRow[] = [];
  private n = 1;

  part(def: string, id: string, x: number, y: number, params: PartInstance['params'] = {}, rot: PartInstance['rot'] = 0) {
    this.parts.push({ id, def, x, y, rot, params });
    return id;
  }

  join(a: string, ap: number, b: string, bp: number) {
    this.connections.push({ id: `c${this.n++}`, a: { part: a, port: ap }, b: { part: b, port: bp } });
  }

  at(t: number, action: SimEventAction) {
    this.script.push({ id: `ev${this.n++}`, t, action });
  }

  build(name: string): SystemDefinition {
    return {
      version: 1, name, parts: this.parts, connections: this.connections,
      script: [...this.script].sort((x, y) => x.t - y.t), humidityRH: 50,
    };
  }
}

// ---- 1. Rotary vane + KF25 hose + 50 L chamber — basic rough-down --------

function example1(): SystemDefinition {
  const b = new B();
  b.part('chamber-cyl', 'chamber1', 8, 2, { D: 368, L: 470, portFlange: 'KF25', material: 'ss304' });
  b.part('gauge-pirani', 'pirani1', 9, 0, { portFlange: 'KF25' }, 180);
  b.part('gauge-thermocouple', 'tc1', 12, 0, { portFlange: 'KF25' }, 180);
  b.part('ball-KF25', 'ball1', 10, 7);
  b.part('flex-KF25', 'hose1', 13, 7, { length: 1000 });
  b.part('pump-rv-2stage-5', 'rv1', 17, 6);

  b.join('chamber1', 6, 'pirani1', 0);
  b.join('chamber1', 0, 'tc1', 0);
  b.join('chamber1', 3, 'ball1', 0);
  b.join('ball1', 1, 'hose1', 0);
  b.join('hose1', 1, 'rv1', 0);

  b.at(0, { type: 'pump', pumpId: 'rv1', on: true });
  b.at(2, { type: 'valve', edgeId: 'ball1', open: 1 });
  return b.build('Example 1 — RV rough-down of a 50 L chamber');
}

// ---- 2. Scroll + turbo-300, CF100 chamber with gate valve ----------------

function example2(): SystemDefinition {
  const b = new B();
  b.part('chamber-cyl', 'chamber1', 7, 2, { D: 300, L: 400, portFlange: 'CF100', material: 'ss304' });
  b.part('gauge-fullrange', 'frg1', 8, 0, { portFlange: 'CF100' }, 180);
  b.part('gauge-pirani', 'pirani1', 11, 0, { portFlange: 'CF100' }, 180);
  b.part('gate-CF100', 'gate1', 13.5, 3.4);
  b.part('pump-turbo-300', 'turbo1', 16.5, 2.5);
  b.part('adapter', 'adap1', 10, 8, { flangeA: 'CF100', flangeB: 'KF25' }, 0);
  b.part('angle-KF25', 'rough1', 12.5, 7.5);
  b.part('flex-KF25', 'hose1', 15, 8, { length: 1000 });
  b.part('tee-KF25', 'tee1', 19, 7.75);
  b.part('flex-KF25', 'hose2', 20, 5.5, { length: 400 }, 90);
  b.part('pump-scroll-10', 'scroll1', 21.5, 9);
  b.part('leak', 'leak1', 5, 1.4, { qStd: 1e-6, portFlange: 'CF100' }, 90);

  b.join('chamber1', 0, 'frg1', 0);
  b.join('chamber1', 6, 'pirani1', 0);
  b.join('chamber1', 1, 'gate1', 0);
  b.join('gate1', 1, 'turbo1', 0);
  b.join('chamber1', 3, 'adap1', 0);
  b.join('adap1', 1, 'rough1', 1);
  b.join('rough1', 0, 'hose1', 0);
  b.join('hose1', 1, 'tee1', 0);
  b.join('turbo1', 1, 'hose2', 0);
  b.join('hose2', 1, 'tee1', 1);
  b.join('tee1', 2, 'scroll1', 0);
  b.join('chamber1', 5, 'leak1', 0);

  b.at(0, { type: 'pump', pumpId: 'scroll1', on: true });
  b.at(1, { type: 'valve', edgeId: 'rough1', open: 1 });
  b.at(120, { type: 'valve', edgeId: 'rough1', open: 0 });
  b.at(125, { type: 'pump', pumpId: 'turbo1', on: true });
  b.at(420, { type: 'valve', edgeId: 'gate1', open: 1 });
  return b.build('Example 2 — scroll + turbo with scripted crossover');
}

// ---- 3. O-ring bell jar + diffusion pump — permeation-limited -------------

function example3(): SystemDefinition {
  const b = new B();
  b.part('chamber-bell', 'bell1', 8, 2, { portFlange: 'ISO100' });
  b.part('gauge-fullrange', 'frg1', 9, 0, { portFlange: 'ISO100' }, 180);
  b.part('pump-diff-300', 'diff1', 9, 7);
  b.part('tee-KF25', 'tee1', 13, 7.75);
  b.part('flex-KF25', 'hose1', 15, 9, { length: 600 });
  b.part('pump-rv-2stage-16', 'rv1', 19, 8);
  b.part('adapter', 'adap1', 15, 6, { flangeA: 'KF25', flangeB: 'KF16' });
  b.part('gauge-thermocouple', 'tc1', 18, 5.5);

  b.join('bell1', 0, 'frg1', 0);
  b.join('bell1', 3, 'diff1', 0);
  b.join('diff1', 1, 'tee1', 0);
  b.join('tee1', 2, 'hose1', 0);
  b.join('hose1', 1, 'rv1', 0);
  b.join('tee1', 1, 'adap1', 0);
  b.join('adap1', 1, 'tc1', 0);

  b.at(0, { type: 'pump', pumpId: 'rv1', on: true });
  b.at(120, { type: 'pump', pumpId: 'diff1', on: true });
  return b.build('Example 3 — bell jar + diffusion pump (permeation floor)');
}

// ---- 4. UHV: baked CF chamber, turbo + ion + NEG --------------------------

function example4(): SystemDefinition {
  const b = new B();
  b.part('chamber-cyl', 'chamber1', 7, 2, { D: 200, L: 300, portFlange: 'CF63', material: 'ss-ep' });
  b.part('gauge-hotcathode', 'ba1', 8, 0, { portFlange: 'CF63' }, 180);
  b.part('gate-CF63', 'gate1', 13, 3.4);
  b.part('pump-turbo-80', 'turbo1', 15.5, 2.5);
  b.part('flex-KF16', 'hose1', 19, 4, { length: 500 });
  b.part('adapter', 'adap1', 22, 4, { flangeA: 'KF16', flangeB: 'KF25' });
  b.part('pump-scroll-10', 'scroll1', 24, 3);
  b.part('pump-ion-20', 'ion1', 9, 7.5);
  b.part('adapter', 'adap2', 5, 4.5, { flangeA: 'CF63', flangeB: 'CF40' }, 90);
  b.part('pump-neg-100', 'neg1', 3, 6);

  b.join('chamber1', 0, 'ba1', 0);
  b.join('chamber1', 1, 'gate1', 0);
  b.join('gate1', 1, 'turbo1', 0);
  b.join('turbo1', 1, 'hose1', 0);
  b.join('hose1', 1, 'adap1', 0);
  b.join('adap1', 1, 'scroll1', 0);
  b.join('chamber1', 3, 'ion1', 0);
  b.join('chamber1', 4, 'adap2', 0);
  b.join('adap2', 1, 'neg1', 0);

  b.at(0, { type: 'pump', pumpId: 'scroll1', on: true });
  b.at(5, { type: 'valve', edgeId: 'gate1', open: 1 });
  b.at(30, { type: 'pump', pumpId: 'turbo1', on: true });
  b.at(1800, { type: 'bakeStart', nodeIds: 'all', temperatureC: 150 });
  b.at(1800 + 24 * 3600, { type: 'bakeEnd', nodeIds: 'all' });
  b.at(1800 + 24 * 3600 + 7200, { type: 'pump', pumpId: 'ion1', on: true });
  b.at(1800 + 24 * 3600 + 7200 + 60, { type: 'pump', pumpId: 'neg1', on: true });
  return b.build('Example 4 — UHV bakeout: turbo + ion + NEG → 1e-10 Torr');
}

// ---- 6. Virtual-leak demonstration chamber --------------------------------

function example6(): SystemDefinition {
  const b = new B();
  b.part('chamber-cell', 'cell1', 8, 3, { D: 200, L: 320, portFlange: 'CF40' });
  b.part('gauge-fullrange', 'frg1', 9, 1, { portFlange: 'CF40' }, 180);
  b.part('vleak', 'vleak1', 6, 1.5, { volume: 1, C: 1e-6, portFlange: 'CF40' }, 90);
  b.part('adapter', 'adap1', 12, 3.5, { flangeA: 'CF40', flangeB: 'KF25' });
  b.part('ball-KF25', 'ball1', 14.5, 3.5);
  b.part('pump-scroll-10', 'scroll1', 17, 3);

  b.join('cell1', 0, 'frg1', 0);
  b.join('cell1', 3, 'vleak1', 0);
  b.join('cell1', 1, 'adap1', 0);
  b.join('adap1', 1, 'ball1', 0);
  b.join('ball1', 1, 'scroll1', 0);

  b.at(0, { type: 'pump', pumpId: 'scroll1', on: true });
  b.at(2, { type: 'valve', edgeId: 'ball1', open: 1 });
  return b.build('Example 6 — trapped volume (virtual leak) signature');
}

// ---- Starter: one chamber, one pump, two gauges ---------------------------

function starter(): SystemDefinition {
  const b = new B();
  b.part('chamber-cyl', 'chamber', 8, 2, { D: 250, L: 350, portFlange: 'KF25', material: 'ss304' });
  b.part('gauge-fullrange', 'gauge', 9.5, 0, { portFlange: 'KF25' }, 180);
  b.part('vent', 'vent', 6, 1.5, { ventFlange: 'KF25' }, 90);
  b.part('ball-KF25', 'valve', 14, 3.5);
  b.part('flex-KF25', 'hose', 16.5, 3.5, { length: 750 });
  b.part('pump-scroll-10', 'pump', 20.5, 3);

  b.join('chamber', 0, 'gauge', 0);
  b.join('chamber', 5, 'vent', 0);
  b.join('chamber', 1, 'valve', 0);
  b.join('valve', 1, 'hose', 0);
  b.join('hose', 1, 'pump', 0);

  b.at(0, { type: 'pump', pumpId: 'pump', on: true });
  b.at(2, { type: 'valve', edgeId: 'valve', open: 1 });
  return b.build('Starter — first pump-down (try venting it live!)');
}

// ---- Coating station: diffusion-pumped high vacuum with process backfill ---
// Classic evaporator/sputter architecture: 110 L chamber, diffusion pump
// behind a gate valve and LN2 right-angle trap, single rotary-vane doing
// rough + backing duty through a tee, Meissner coil for water, Ar process
// gas admittance, and a cable bundle payload that dominates the gas load.

function coater(): SystemDefinition {
  const b = new B();
  b.part('chamber-cyl', 'chamber', 7, 1.5, { D: 450, L: 700, portFlange: 'ISO160', material: 'ss304' });
  b.part('gauge-fullrange', 'frg', 8, -0.5, { portFlange: 'ISO160' }, 180);
  b.part('gauge-pirani', 'pirani', 10.5, -0.5, { portFlange: 'ISO160' }, 180);
  b.part('coldtrap-meissner', 'meissner', 13, 2.2, { area: 600, on: false, portFlange: 'ISO160' });
  b.part('gasadmit', 'argon', 4.5, 2.2, { gas: 'Ar', C: 1e-3, open: false, gasFlange: 'ISO160' });
  b.part('leak', 'leak', 4.5, 4, { qStd: 1e-7, portFlange: 'ISO160' }, 90);
  b.part('payload-cable', 'cables', 10, 6, { length: 3, diameter: 12, insulation: 'ptfe', portFlange: 'ISO160' });

  // high-vac stack below the chamber
  b.part('gate-ISO160', 'gate', 7.5, 7, {}, 90);
  b.part('adapter', 'adap-diff', 7.5, 9.5, { flangeA: 'ISO160', flangeB: 'ISO100' }, 90);
  b.part('coldtrap-inline', 'trap', 8.5, 11, { on: false, portFlange: 'ISO100' });
  b.part('pump-diff-300', 'diff', 10.5, 12.5);

  // rough/backing line
  b.part('adapter', 'adap-rough', 12, 4.8, { flangeA: 'ISO160', flangeB: 'KF25' });
  b.part('angle-KF25', 'roughvalve', 14.5, 4.3);
  b.part('flex-KF25', 'roughhose', 16.5, 5, { length: 1500 });
  b.part('tee-KF25', 'tee', 20, 4.75);
  b.part('flex-KF25', 'backhose', 15, 13, { length: 800 });
  b.part('pump-rv-2stage-16', 'rv', 22.5, 6.5);

  b.join('chamber', 0, 'frg', 0);
  b.join('chamber', 6, 'pirani', 0);
  b.join('chamber', 1, 'meissner', 0);
  b.join('chamber', 5, 'argon', 0);
  b.join('chamber', 4, 'leak', 0);
  b.join('chamber', 7, 'cables', 0);
  b.join('chamber', 3, 'gate', 0);
  b.join('gate', 1, 'adap-diff', 0);
  b.join('adap-diff', 1, 'trap', 0);
  b.join('trap', 1, 'diff', 0);
  b.join('chamber', 2, 'adap-rough', 0);
  b.join('adap-rough', 1, 'roughvalve', 1);
  b.join('roughvalve', 0, 'roughhose', 0);
  b.join('roughhose', 1, 'tee', 0);
  b.join('diff', 1, 'backhose', 0);
  b.join('backhose', 1, 'tee', 1);
  b.join('tee', 2, 'rv', 0);

  b.at(0, { type: 'pump', pumpId: 'rv', on: true });
  b.at(2, { type: 'valve', edgeId: 'roughvalve', open: 1 });
  b.at(10, { type: 'pump', pumpId: 'diff', on: true }); // heater on early (15 min warm-up)
  b.at(300, { type: 'valve', edgeId: 'roughvalve', open: 0 });
  b.at(305, { type: 'pump', pumpId: 'trap', on: true }); // fill the trap before crossover
  b.at(310, { type: 'pump', pumpId: 'meissner', on: true });
  b.at(1600, { type: 'valve', edgeId: 'gate', open: 1 }); // diffusion pump hot: crossover
  b.at(3600, { type: 'valve', edgeId: 'argon', open: 1 }); // process: Ar backfill
  b.at(4800, { type: 'valve', edgeId: 'argon', open: 0 }); // process done, recover
  return b.build('Coating station — diffusion-pumped high vacuum with Ar process');
}

// ---- Surface science: bakeable CF UHV chamber, ion+NEG holding ------------
// Turbo does the dirty work, a 150 °C × 24 h bake clears the water, then the
// ion pump + NEG take over and the gate valve CLOSES — the classic vibration-
// free UHV endgame, H2-limited around 1e-10 Torr.

function uhvLab(): SystemDefinition {
  const b = new B();
  b.part('chamber-sphere', 'chamber', 7, 2, { D: 450, portFlange: 'CF100', material: 'ss-ep' });
  b.part('gauge-hotcathode', 'ba', 8, 0, { portFlange: 'CF100', enabled: false }, 180);
  b.part('gauge-fullrange', 'frg', 10.5, 0, { portFlange: 'CF100' }, 180);
  b.part('payload-metal', 'holder', 4.5, 2.5, { material: 'ss-ep', area: 300, volume: 0.3, portFlange: 'CF100' }, 90);
  b.part('payload-polymer', 'insulators', 4.5, 4.5, { material: 'alumina', area: 50, volume: 0.05, portFlange: 'CF100' }, 90);

  b.part('gate-CF100', 'gate', 13, 3.4);
  b.part('pump-turbo-300', 'turbo', 16, 2.5);
  b.part('flex-KF25', 'backhose', 20, 4.5, { length: 600 });
  b.part('tee-KF25', 'tee', 22.5, 4.25);
  b.part('pump-scroll-10', 'scroll', 25, 5.5);
  // all-metal roughing valve on the chamber side: every elastomer joint
  // lives BEYOND it, or its He permeation would haunt the ion pump forever
  b.part('adapter', 'adap-rough', 10, 6.5, { flangeA: 'CF100', flangeB: 'CF16' }, 90);
  b.part('angle-CF16', 'roughvalve', 12, 7.5);
  b.part('adapter', 'adap-rough2', 13.5, 8.6, { flangeA: 'CF16', flangeB: 'KF25' });
  b.part('flex-KF25', 'roughhose', 15.5, 8.6, { length: 1200 });

  b.part('adapter', 'adap-ion', 7.5, 7, { flangeA: 'CF100', flangeB: 'CF160' }, 90);
  b.part('pump-ion-150', 'ion', 6.5, 9);
  b.part('adapter', 'adap-neg', 3.5, 5.8, { flangeA: 'CF100', flangeB: 'CF40' });
  b.part('pump-neg-100', 'neg', 1, 6.5);

  b.join('chamber', 0, 'ba', 0);
  b.join('chamber', 6, 'frg', 0);
  b.join('chamber', 5, 'holder', 0);
  b.join('chamber', 4, 'insulators', 0);
  b.join('chamber', 1, 'gate', 0);
  b.join('gate', 1, 'turbo', 0);
  b.join('turbo', 1, 'backhose', 0);
  b.join('backhose', 1, 'tee', 0);
  b.join('tee', 2, 'scroll', 0);
  b.join('chamber', 2, 'adap-rough', 0);
  b.join('adap-rough', 1, 'roughvalve', 1);
  b.join('roughvalve', 0, 'adap-rough2', 0);
  b.join('adap-rough2', 1, 'roughhose', 0);
  b.join('roughhose', 1, 'tee', 1);
  b.join('chamber', 3, 'adap-ion', 0);
  b.join('adap-ion', 1, 'ion', 0);
  b.join('chamber', 7, 'adap-neg', 0);
  b.join('adap-neg', 1, 'neg', 0);

  const bakeEnd = 1800 + 24 * 3600;
  b.at(0, { type: 'pump', pumpId: 'scroll', on: true });
  b.at(2, { type: 'valve', edgeId: 'roughvalve', open: 1 });
  b.at(240, { type: 'valve', edgeId: 'roughvalve', open: 0 });
  b.at(245, { type: 'pump', pumpId: 'turbo', on: true });
  b.at(600, { type: 'valve', edgeId: 'gate', open: 1 });
  b.at(1800, { type: 'bakeStart', nodeIds: 'all', temperatureC: 150 });
  b.at(bakeEnd, { type: 'bakeEnd', nodeIds: 'all' });
  b.at(bakeEnd + 600, { type: 'gauge', gaugeId: 'ba', enabled: true });
  b.at(bakeEnd + 7200, { type: 'pump', pumpId: 'ion', on: true });
  b.at(bakeEnd + 7260, { type: 'pump', pumpId: 'neg', on: true });
  // the endgame: close the gate and let ion + NEG hold the chamber alone
  b.at(bakeEnd + 14400, { type: 'valve', edgeId: 'gate', open: 0 });
  b.at(bakeEnd + 14460, { type: 'pump', pumpId: 'turbo', on: false });
  return b.build('Surface science — UHV bake, then ion+NEG hold with the gate closed');
}

export const EXAMPLES: { id: string; name: string; system: SystemDefinition }[] = [
  { id: 'starter', name: 'Starter · first pump-down', system: starter() },
  { id: 'coater', name: 'Coating station · high vacuum (complex)', system: coater() },
  { id: 'uhvlab', name: 'Surface science · UHV (complex)', system: uhvLab() },
  { id: 'ex1', name: '1 · RV rough-down (50 L)', system: example1() },
  { id: 'ex2', name: '2 · Scroll + turbo crossover', system: example2() },
  { id: 'ex3', name: '3 · Bell jar + diffusion (permeation floor)', system: example3() },
  { id: 'ex4', name: '4 · UHV bakeout → 1e-10', system: example4() },
  { id: 'ex6', name: '6 · Virtual leak demo', system: example6() },
];
