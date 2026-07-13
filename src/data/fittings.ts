import type { GaugeType } from '../types';
import { FLANGES, FLANGE_BY_ID } from './flanges';
import { PUMP_CATALOG } from './pumps';
import { GAUGE_SPECS } from './gaugespecs';

/**
 * Part catalog (§2): parametric templates × flange-size catalogs, generated
 * programmatically. Every part: ports (position + flange), footprint,
 * inspector params, and the data the compiler (src/compile.ts) needs to emit
 * engine nodes/edges/pumps/gauges. Geometry is in grid units (1 unit = one
 * canvas cell); physics lengths are in mm (converted to cm at compile).
 */

export type PartKind =
  | 'chamber' | 'tube' | 'flex' | 'bellows' | 'elbow' | 'tee' | 'cross'
  | 'adapter' | 'blank' | 'viewport' | 'feedthrough'
  | 'valve' | 'valve-butterfly' | 'valve-metering' | 'valve-vent' | 'valve-gas'
  | 'pump' | 'gauge' | 'leak' | 'vleak' | 'leakdetector'
  | 'payload' | 'coldtrap-meissner' | 'coldtrap-inline';

export interface ParamDef {
  key: string;
  label: string;
  kind: 'number' | 'log' | 'select' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string | number; label: string }[];
}

export interface PortDef {
  x: number;
  y: number;
  /** flange size id, or the name of a select param that holds one */
  flange: string;
  dynamic?: boolean;
}

export interface PartDef {
  id: string;
  name: string;
  category: string;
  kind: PartKind;
  w: number;
  h: number;
  ports: PortDef[];
  params: ParamDef[];
  defaults: Record<string, number | string | boolean>;
  data: Record<string, unknown>;
  fidelity?: string;
}

const MATERIAL_OPTIONS = [
  { value: 'ss304', label: 'SS304/316' },
  { value: 'ss-ep', label: 'SS electropolished' },
  { value: 'al6061', label: 'Aluminum 6061' },
  { value: 'mild-steel', label: 'Mild steel' },
  { value: 'copper-ofhc', label: 'Copper OFHC' },
  { value: 'borosilicate', label: 'Borosilicate' },
];

const boreCm = (flangeId: string) => FLANGE_BY_ID[flangeId].boreMm / 10;

export const PARTS: PartDef[] = [];
const add = (p: PartDef) => PARTS.push(p);

// --------------------------------------------------------------- chambers ----

const chamberParams = (extra: ParamDef[] = []): ParamDef[] => [
  ...extra,
  { key: 'material', label: 'Material', kind: 'select', options: MATERIAL_OPTIONS },
  { key: 'portFlange', label: 'Port flange', kind: 'select', options: FLANGES.map((f) => ({ value: f.id, label: f.name })) },
  { key: 'baked', label: 'Pre-baked', kind: 'boolean' },
];

/** 8 ports around a rectangular footprint */
const ringPorts = (w: number, h: number): PortDef[] => [
  { x: w / 2, y: 0, flange: 'portFlange', dynamic: true },
  { x: w, y: h / 4, flange: 'portFlange', dynamic: true },
  { x: w, y: (3 * h) / 4, flange: 'portFlange', dynamic: true },
  { x: w / 2, y: h, flange: 'portFlange', dynamic: true },
  { x: 0, y: (3 * h) / 4, flange: 'portFlange', dynamic: true },
  { x: 0, y: h / 4, flange: 'portFlange', dynamic: true },
  { x: w / 4, y: 0, flange: 'portFlange', dynamic: true },
  { x: (3 * w) / 4, y: h, flange: 'portFlange', dynamic: true },
];

add({
  id: 'chamber-cyl', name: 'Cylindrical chamber', category: 'Chambers', kind: 'chamber',
  w: 5, h: 4, ports: ringPorts(5, 4),
  params: chamberParams([
    { key: 'D', label: 'Diameter', kind: 'number', min: 20, max: 2000, unit: 'mm' },
    { key: 'L', label: 'Length', kind: 'number', min: 20, max: 3000, unit: 'mm' },
  ]),
  defaults: { D: 300, L: 400, material: 'ss304', portFlange: 'CF40', baked: false },
  data: { shape: 'cyl' },
});
add({
  id: 'chamber-sphere', name: 'Spherical chamber', category: 'Chambers', kind: 'chamber',
  w: 4, h: 4, ports: ringPorts(4, 4),
  params: chamberParams([{ key: 'D', label: 'Diameter', kind: 'number', min: 20, max: 2000, unit: 'mm' }]),
  defaults: { D: 300, material: 'ss304', portFlange: 'CF40', baked: false },
  data: { shape: 'sphere' },
});
add({
  id: 'chamber-box', name: 'Box chamber', category: 'Chambers', kind: 'chamber',
  w: 5, h: 4, ports: ringPorts(5, 4),
  params: chamberParams([
    { key: 'W', label: 'Width', kind: 'number', min: 20, max: 3000, unit: 'mm' },
    { key: 'H', label: 'Height', kind: 'number', min: 20, max: 3000, unit: 'mm' },
    { key: 'D', label: 'Depth', kind: 'number', min: 20, max: 3000, unit: 'mm' },
  ]),
  defaults: { W: 1000, H: 1000, D: 1000, material: 'ss304', portFlange: 'ISO160', baked: false },
  data: { shape: 'box' },
});
add({
  id: 'chamber-bell', name: 'Bell jar 12"', category: 'Chambers', kind: 'chamber',
  w: 4, h: 4, ports: ringPorts(4, 4),
  params: chamberParams([
    { key: 'D', label: 'Diameter', kind: 'number', min: 100, max: 1000, unit: 'mm' },
    { key: 'L', label: 'Height', kind: 'number', min: 100, max: 1500, unit: 'mm' },
  ]),
  defaults: { D: 305, L: 450, material: 'borosilicate', portFlange: 'ISO100', baked: false },
  data: { shape: 'cyl', elastomerBase: true },
  fidelity: 'Bell jar seals on a large elastomer L-gasket: adds ~40 cm² Viton wetted area (outgassing + He/H2O permeation).',
});
add({
  id: 'chamber-cell', name: 'Small test cell 1 L', category: 'Chambers', kind: 'chamber',
  w: 3, h: 2,
  ports: [
    { x: 1.5, y: 0, flange: 'portFlange', dynamic: true },
    { x: 3, y: 1, flange: 'portFlange', dynamic: true },
    { x: 1.5, y: 2, flange: 'portFlange', dynamic: true },
    { x: 0, y: 1, flange: 'portFlange', dynamic: true },
  ],
  params: chamberParams([
    { key: 'D', label: 'Diameter', kind: 'number', min: 20, max: 400, unit: 'mm' },
    { key: 'L', label: 'Length', kind: 'number', min: 20, max: 600, unit: 'mm' },
  ]),
  defaults: { D: 100, L: 127, material: 'ss304', portFlange: 'CF40', baked: false },
  data: { shape: 'cyl' },
});

// ------------------------------------------------------- tubes & fittings ----

for (const f of FLANGES) {
  const fid = f.id;
  const d = boreCm(fid);
  const stdCats = f.standard === 'SWG' ? 'Gas lines' : 'Tubes & fittings';

  add({
    id: `nipple-${fid}`, name: `Nipple ${f.name}`, category: stdCats, kind: 'tube',
    w: 3, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 3, y: 0.5, flange: fid }],
    params: [
      { key: 'length', label: 'Length', kind: 'number', min: 20, max: 5000, step: 10, unit: 'mm' },
      { key: 'material', label: 'Material', kind: 'select', options: MATERIAL_OPTIONS },
    ],
    defaults: { length: 100, material: 'ss304' },
    data: { d },
  });

  add({
    id: `flex-${fid}`, name: `Flex hose ${f.name}`, category: stdCats, kind: 'flex',
    w: 3, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 3, y: 0.5, flange: fid }],
    params: [
      { key: 'length', label: 'Length', kind: 'number', min: 100, max: 5000, step: 10, unit: 'mm' },
    ],
    defaults: { length: 500 },
    data: { d: d * 0.9, lengthFactor: 1.4 },
    fidelity: 'Corrugated hose: geometric length ×1.4, corrugation-root ID (0.9× nominal) as effective diameter.',
  });

  add({
    id: `bellows-${fid}`, name: `Bellows ${f.name}`, category: stdCats, kind: 'bellows',
    w: 2, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }],
    params: [{ key: 'length', label: 'Length', kind: 'number', min: 40, max: 500, step: 10, unit: 'mm' }],
    defaults: { length: 100 },
    data: { d: d * 0.95, lengthFactor: 1.2 },
    fidelity: 'Thin-wall bellows: length factor ×1.2.',
  });

  add({
    id: `elbow90-${fid}`, name: `90° elbow ${f.name}`, category: stdCats, kind: 'elbow',
    w: 2, h: 2,
    ports: [{ x: 0, y: 1.5, flange: fid }, { x: 1.5, y: 0, flange: fid }],
    params: [],
    defaults: {},
    data: { d, bends: 1, lengthMm: 2.2 * f.boreMm + 40 },
    fidelity: 'Radiused elbow: axial length + 1.33·d equivalent length per 90° bend (Dushman).',
  });

  add({
    id: `elbow45-${fid}`, name: `45° elbow ${f.name}`, category: stdCats, kind: 'elbow',
    w: 2, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }],
    params: [],
    defaults: {},
    data: { d, bends: 0.5, lengthMm: 1.6 * f.boreMm + 30 },
  });

  add({
    id: `tee-${fid}`, name: `Tee ${f.name}`, category: stdCats, kind: 'tee',
    w: 3, h: 2,
    ports: [
      { x: 0, y: 0.75, flange: fid },
      { x: 3, y: 0.75, flange: fid },
      { x: 1.5, y: 2, flange: fid },
    ],
    params: [],
    defaults: {},
    data: { d, nPorts: 3 },
  });

  for (const [n, name] of [[4, '4-way cross'], [5, '5-way cross'], [6, '6-way cross']] as const) {
    const ports: PortDef[] = [
      { x: 0, y: 1, flange: fid },
      { x: 3, y: 1, flange: fid },
      { x: 1.5, y: 0, flange: fid },
      { x: 1.5, y: 2, flange: fid },
    ];
    if (n >= 5) ports.push({ x: 3, y: 0, flange: fid });
    if (n >= 6) ports.push({ x: 0, y: 0, flange: fid });
    add({
      id: `cross${n}-${fid}`, name: `${name} ${f.name}`, category: stdCats, kind: 'cross',
      w: 3, h: 2, ports,
      params: [],
      defaults: {},
      data: { d, nPorts: n },
    });
  }

  add({
    id: `blank-${fid}`, name: `Blank flange ${f.name}`, category: 'Accessories', kind: 'blank',
    w: 1, h: 1, ports: [{ x: 0, y: 0.5, flange: fid }],
    params: [], defaults: {}, data: { d },
  });
  add({
    id: `viewport-${fid}`, name: `Viewport ${f.name}`, category: 'Accessories', kind: 'viewport',
    w: 1, h: 1, ports: [{ x: 0, y: 0.5, flange: fid }],
    params: [], defaults: {},
    data: { d, glassArea: Math.PI * (d / 2) ** 2 * 1.2 },
    fidelity: 'Viewport adds borosilicate glass outgassing area.',
  });
  add({
    id: `feedthru-${fid}`, name: `Feedthrough ${f.name}`, category: 'Accessories', kind: 'feedthrough',
    w: 1, h: 1, ports: [{ x: 0, y: 0.5, flange: fid }],
    params: [], defaults: {},
    data: { d, ceramicArea: 3 },
    fidelity: 'Multi-pin feedthrough: small alumina ceramic outgassing area.',
  });
}

// universal adapter (any flange ↔ any flange; smaller bore governs)
add({
  id: 'adapter', name: 'Adapter / reducer', category: 'Tubes & fittings', kind: 'adapter',
  w: 2, h: 1,
  ports: [
    { x: 0, y: 0.5, flange: 'flangeA', dynamic: true },
    { x: 2, y: 0.5, flange: 'flangeB', dynamic: true },
  ],
  params: [
    { key: 'flangeA', label: 'Side A', kind: 'select', options: FLANGES.map((f) => ({ value: f.id, label: f.name })) },
    { key: 'flangeB', label: 'Side B', kind: 'select', options: FLANGES.map((f) => ({ value: f.id, label: f.name })) },
  ],
  defaults: { flangeA: 'KF25', flangeB: 'CF40' },
  data: { lengthMm: 40 },
  fidelity: 'Conical/straight reducer: short tube at the smaller bore governs conductance.',
});

// ----------------------------------------------------------------- valves ----

const valveSizes = FLANGES.filter((f) => f.standard !== 'SWG');
for (const f of valveSizes) {
  const fid = f.id;
  const d = boreCm(fid);
  const two: PortDef[] = [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }];
  const openParam: ParamDef = { key: 'open', label: 'Open', kind: 'boolean' };

  add({
    id: `gate-${fid}`, name: `Gate valve ${f.name}`, category: 'Valves', kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm * 0.8 + 30, bends: 0, actuateTime: 2 },
  });
  add({
    id: `poppet-${fid}`, name: `Inline poppet ${f.name}`, category: 'Valves', kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d: d * 0.8, lengthMm: f.boreMm * 1.5 + 30, bends: 0.5, actuateTime: 0.5 },
  });
  add({
    id: `angle-${fid}`, name: `Right-angle valve ${f.name}`, category: 'Valves', kind: 'valve',
    w: 2, h: 2,
    ports: [{ x: 0, y: 1.5, flange: fid }, { x: 1.5, y: 0, flange: fid }],
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm * 2 + 40, bends: 1, actuateTime: 1 },
  });
  add({
    id: `ball-${fid}`, name: `Ball valve ${f.name}`, category: 'Valves', kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm + 30, bends: 0, actuateTime: 0.5 },
  });
  add({
    id: `butterfly-${fid}`, name: `Butterfly valve ${f.name}`, category: 'Valves', kind: 'valve-butterfly',
    w: 2, h: 1, ports: two,
    params: [{ key: 'open', label: 'Opening', kind: 'number', min: 0, max: 100, step: 1, unit: '%' }],
    defaults: { open: 0 },
    data: { d, lengthMm: f.boreMm * 0.6 + 20 },
    fidelity: 'Butterfly at fraction x: aperture of area x·A_bore in series with the body tube.',
  });
}

add({
  id: 'metering', name: 'Metering / leak valve', category: 'Valves', kind: 'valve-metering',
  w: 2, h: 1,
  ports: [{ x: 0, y: 0.5, flange: 'KF16' }, { x: 2, y: 0.5, flange: 'KF16' }],
  params: [
    { key: 'C', label: 'Conductance', kind: 'log', min: 1e-9, max: 1e-1, unit: 'L/s' },
    { key: 'open', label: 'Open', kind: 'boolean' },
  ],
  defaults: { C: 1e-4, open: true },
  data: {},
});
add({
  id: 'vent', name: 'Vent valve', category: 'Valves', kind: 'valve-vent',
  w: 1, h: 1,
  ports: [{ x: 0, y: 0.5, flange: 'KF16' }],
  params: [{ key: 'open', label: 'Open', kind: 'boolean' }],
  defaults: { open: false },
  data: { d: 0.4, lengthMm: 50 },
});
add({
  id: 'gasadmit', name: 'Gas admittance valve', category: 'Valves', kind: 'valve-gas',
  w: 1, h: 1,
  ports: [{ x: 0, y: 0.5, flange: 'KF16' }],
  params: [
    { key: 'gas', label: 'Gas', kind: 'select', options: [
      { value: 'He', label: 'Helium' }, { value: 'Ar', label: 'Argon' }, { value: 'N2', label: 'N2 (dry)' },
    ] },
    { key: 'C', label: 'Conductance', kind: 'log', min: 1e-9, max: 1e-1, unit: 'L/s' },
    { key: 'open', label: 'Open', kind: 'boolean' },
  ],
  defaults: { gas: 'N2', C: 1e-3, open: false },
  data: {},
});

// ------------------------------------------------------------------ pumps ----

for (const p of PUMP_CATALOG) {
  const backed = p.model.kind === 'turbo' || p.model.kind === 'diffusion' || p.model.kind === 'roots';
  const ports: PortDef[] = [{ x: 1.5, y: 0, flange: p.inletFlange }];
  if (backed) ports.push({ x: 3, y: 1.5, flange: p.backingFlange ?? 'KF25' });
  const params: ParamDef[] = [{ key: 'on', label: 'Running', kind: 'boolean' }];
  if (p.model.kind === 'displacement' && p.model.hasBallast) {
    params.push({ key: 'ballast', label: 'Gas ballast', kind: 'boolean' });
  }
  add({
    id: `pump-${p.id}`, name: p.name, category: `Pumps: ${p.class}`, kind: 'pump',
    w: 3, h: 3, ports,
    params, defaults: { on: false, ballast: false },
    data: { pumpId: p.id, backed },
    fidelity: `${p.notes} Values are class-representative approximations.`,
  });
}

// ----------------------------------------------------------------- gauges ----

const GAUGE_PARTS: { type: GaugeType; name: string }[] = [
  { type: 'bourdon', name: 'Bourdon / piezo' },
  { type: 'capacitance', name: 'Capacitance manometer' },
  { type: 'thermocouple', name: 'Thermocouple gauge' },
  { type: 'pirani', name: 'Pirani gauge' },
  { type: 'coldcathode', name: 'Cold cathode gauge' },
  { type: 'hotcathode', name: 'Hot cathode (BA) gauge' },
  { type: 'fullrange', name: 'Full-range gauge' },
];
const FLANGE_SELECT: ParamDef = {
  key: 'portFlange', label: 'Flange', kind: 'select',
  options: FLANGES.map((f) => ({ value: f.id, label: f.name })),
};

for (const g of GAUGE_PARTS) {
  const params: ParamDef[] = [{ key: 'enabled', label: 'Enabled', kind: 'boolean' }, FLANGE_SELECT];
  if (g.type === 'capacitance') {
    params.push({
      key: 'fullScale', label: 'Full scale', kind: 'select',
      options: [1000, 100, 1, 0.1].map((v) => ({ value: v, label: `${v} Torr` })),
    });
  }
  add({
    id: `gauge-${g.type}`, name: g.name, category: 'Gauges', kind: 'gauge',
    w: 1, h: 1,
    ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
    params, defaults: { enabled: true, fullScale: 1000, portFlange: 'KF16' },
    data: { gaugeType: g.type },
    fidelity: GAUGE_SPECS[g.type].notes,
  });
}

// ---------------------------------------------------------------- sources ----

add({
  id: 'leak', name: 'Leak (orifice)', category: 'Sources', kind: 'leak',
  w: 1, h: 1,
  ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'qStd', label: 'Leak rate', kind: 'log', min: 1e-12, max: 1e-2, unit: 'Torr·L/s' },
    FLANGE_SELECT,
  ],
  defaults: { qStd: 1e-6, portFlange: 'KF16' },
  data: {},
  fidelity: 'Fixed-conductance orifice from atmosphere; species arrive ∝ atmospheric partials × sqrt(28.97/M). Sprayable with He.',
});
add({
  id: 'vleak', name: 'Trapped volume (virtual leak)', category: 'Sources', kind: 'vleak',
  w: 1, h: 1,
  ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'volume', label: 'Trapped volume', kind: 'log', min: 0.01, max: 100, unit: 'cm³' },
    { key: 'C', label: 'Bleed conductance', kind: 'log', min: 1e-9, max: 1e-3, unit: 'L/s' },
    FLANGE_SELECT,
  ],
  defaults: { volume: 1, C: 1e-6, portFlange: 'KF16' },
  data: {},
  fidelity: 'Hidden gas pocket (e.g. unvented screw hole) bleeding through a tiny conductance — the classic slow-leak signature that He spraying cannot find.',
});

// ------------------------------------------------------ chamber payloads ----
// Things you put INSIDE the chamber. Surface area drives outgassing;
// volume displaces pumped gas (the chamber's free volume shrinks).

const METAL_PAYLOAD_OPTIONS = [
  { value: 'ss304', label: 'SS304/316' },
  { value: 'ss-ep', label: 'SS electropolished' },
  { value: 'al6061', label: 'Aluminum 6061' },
  { value: 'copper-ofhc', label: 'Copper OFHC' },
  { value: 'mild-steel', label: 'Mild steel' },
];
const POLYMER_PAYLOAD_OPTIONS = [
  { value: 'ptfe', label: 'PTFE' },
  { value: 'peek', label: 'PEEK' },
  { value: 'kapton', label: 'Kapton' },
  { value: 'nylon', label: 'Nylon / polyamide' },
  { value: 'epoxy-fr4', label: 'Epoxy / FR4 board' },
  { value: 'viton', label: 'Viton' },
  { value: 'buna-n', label: 'Buna-N' },
  { value: 'alumina', label: 'Alumina ceramic' },
  { value: 'borosilicate', label: 'Borosilicate glass' },
];
const INSULATION_OPTIONS = [
  { value: 'ptfe', label: 'PTFE' },
  { value: 'kapton', label: 'Kapton' },
  { value: 'peek', label: 'PEEK' },
  { value: 'nylon', label: 'Nylon' },
];

add({
  id: 'payload-metal', name: 'Metal mass (fixture, workpiece)', category: 'Chamber payloads', kind: 'payload',
  w: 1, h: 1, ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'material', label: 'Material', kind: 'select', options: METAL_PAYLOAD_OPTIONS },
    { key: 'area', label: 'Surface area', kind: 'number', min: 1, max: 1e6, step: 10, unit: 'cm²' },
    { key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 1000, step: 0.1, unit: 'L' },
    { key: 'baked', label: 'Pre-baked', kind: 'boolean' },
    FLANGE_SELECT,
  ],
  defaults: { material: 'ss304', area: 600, volume: 1, baked: false, portFlange: 'KF25' },
  data: { payload: 'direct' },
  fidelity: 'Attach to any chamber port: the part lives INSIDE that volume. Area adds outgassing; volume is subtracted from the chamber (gas displacement) — a big block pumps down faster but outgasses longer.',
});
add({
  id: 'payload-graphite', name: 'Graphite block', category: 'Chamber payloads', kind: 'payload',
  w: 1, h: 1, ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'W', label: 'Width', kind: 'number', min: 5, max: 2000, step: 5, unit: 'mm' },
    { key: 'H', label: 'Height', kind: 'number', min: 5, max: 2000, step: 5, unit: 'mm' },
    { key: 'D', label: 'Depth', kind: 'number', min: 5, max: 2000, step: 5, unit: 'mm' },
    { key: 'baked', label: 'Pre-baked', kind: 'boolean' },
    FLANGE_SELECT,
  ],
  defaults: { W: 100, H: 100, D: 100, baked: false, portFlange: 'KF25' },
  data: { payload: 'graphite' },
  fidelity: 'Porous graphite: the tabulated rate is per GEOMETRIC cm² with the internal surface folded in, decaying as t^-0.5 (bulk diffusion). Notorious water sponge — bake it.',
});
add({
  id: 'payload-cable', name: 'Cable bundle', category: 'Chamber payloads', kind: 'payload',
  w: 1, h: 1, ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'length', label: 'Length', kind: 'number', min: 0.1, max: 500, step: 0.1, unit: 'm' },
    { key: 'diameter', label: 'Bundle Ø', kind: 'number', min: 1, max: 100, step: 0.5, unit: 'mm' },
    { key: 'insulation', label: 'Insulation', kind: 'select', options: INSULATION_OPTIONS },
    FLANGE_SELECT,
  ],
  defaults: { length: 5, diameter: 10, insulation: 'ptfe', portFlange: 'KF25' },
  data: { payload: 'cable' },
  fidelity: 'Area = π·Ø·length of insulation surface; volume at 60% fill factor. Polymer insulation outgasses water with a t^-0.5 tail — the classic reason cabled chambers pump slowly.',
});
add({
  id: 'payload-polymer', name: 'Polymer / ceramic part', category: 'Chamber payloads', kind: 'payload',
  w: 1, h: 1, ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'material', label: 'Material', kind: 'select', options: POLYMER_PAYLOAD_OPTIONS },
    { key: 'area', label: 'Surface area', kind: 'number', min: 1, max: 1e6, step: 10, unit: 'cm²' },
    { key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 100, step: 0.05, unit: 'L' },
    FLANGE_SELECT,
  ],
  defaults: { material: 'ptfe', area: 200, volume: 0.2, portFlange: 'KF25' },
  data: { payload: 'direct' },
  fidelity: 'Any tabulated polymer/ceramic: 3D-printed fixtures, PCBs, insulators, seals stock. Most are not bakeable — check the materials table.',
});

// ------------------------------------------------------------ cold traps ----

add({
  id: 'coldtrap-meissner', name: 'LN₂ cold wall (Meissner coil)', category: 'Cold traps', kind: 'coldtrap-meissner',
  w: 2, h: 1, ports: [{ x: 1, y: 1, flange: 'portFlange', dynamic: true }],
  params: [
    { key: 'area', label: 'Cold area', kind: 'number', min: 10, max: 1e5, step: 10, unit: 'cm²' },
    { key: 'on', label: 'LN₂ flowing', kind: 'boolean' },
    FLANGE_SELECT,
  ],
  defaults: { area: 500, on: false, portFlange: 'KF40' },
  data: {},
  fidelity: 'An in-chamber 77 K surface pumps water at near the impingement rate (~10 L/s/cm², sticking included) and CO₂; it does NOT pump N₂/O₂/H₂/He (their 77 K vapor pressures are far too high). Capacity ≈ ice buildup; warm-up release is not modeled — regenerate while off (fidelity note).',
});
add({
  id: 'coldtrap-inline', name: 'Right-angle LN₂ trap', category: 'Cold traps', kind: 'coldtrap-inline',
  w: 2, h: 2,
  ports: [
    { x: 0, y: 1.5, flange: 'portFlange', dynamic: true },
    { x: 1.5, y: 0, flange: 'portFlange', dynamic: true },
  ],
  params: [
    { key: 'on', label: 'LN₂ filled', kind: 'boolean' },
    FLANGE_SELECT,
  ],
  defaults: { on: false, portFlange: 'KF25' },
  data: {},
  fidelity: 'Foreline trap: conductance of an elbow ×0.4 (baffled path); while cold it pumps H₂O like a small cold surface — stops oil/water migration both ways. Warm-up release not modeled.',
});

add({
  id: 'leakdetector', name: 'He leak detector', category: 'Sources', kind: 'leakdetector',
  w: 3, h: 2,
  ports: [{ x: 0, y: 1, flange: 'KF25' }],
  params: [{ key: 'on', label: 'Running', kind: 'boolean' }],
  defaults: { on: true },
  data: {},
  fidelity: 'Self-contained hybrid turbo + diaphragm backing with a helium mass-flow readout at its inlet (1e-12…1e-4 Torr·L/s). Spray He at a suspect joint (leak inspector or event script) and watch the signal.',
});

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export const PART_CATEGORIES: string[] = [...new Set(PARTS.map((p) => p.category))];

/** resolve a port's flange id, honoring dynamic (param-driven) flanges */
export function portFlange(def: PartDef, portIdx: number, params: Record<string, unknown>): string {
  const pd = def.ports[portIdx];
  return pd.dynamic ? String(params[pd.flange] ?? 'KF25') : pd.flange;
}
