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
  | 'pump' | 'gauge' | 'rga' | 'leak' | 'vleak' | 'leakdetector'
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
  /** second hierarchy level in the palette (flange size, pump class, ...) */
  sub?: string;
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
  const sub = f.name;

  add({
    id: `nipple-${fid}`, name: `Nipple ${f.name}`, category: stdCats, sub, kind: 'tube',
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
    id: `flex-${fid}`, name: `Flex hose ${f.name}`, category: stdCats, sub, kind: 'flex',
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
    id: `bellows-${fid}`, name: `Bellows ${f.name}`, category: stdCats, sub, kind: 'bellows',
    w: 2, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }],
    params: [{ key: 'length', label: 'Length', kind: 'number', min: 40, max: 500, step: 10, unit: 'mm' }],
    defaults: { length: 100 },
    data: { d: d * 0.95, lengthFactor: 1.2 },
    fidelity: 'Thin-wall bellows: length factor ×1.2.',
  });

  add({
    id: `elbow90-${fid}`, name: `90° elbow ${f.name}`, category: stdCats, sub, kind: 'elbow',
    w: 2, h: 2,
    ports: [{ x: 0, y: 1.5, flange: fid }, { x: 1.5, y: 0, flange: fid }],
    params: [],
    defaults: {},
    data: { d, bends: 1, lengthMm: 2.2 * f.boreMm + 40 },
    fidelity: 'Radiused elbow: axial length + 1.33·d equivalent length per 90° bend (Dushman).',
  });

  add({
    id: `elbow45-${fid}`, name: `45° elbow ${f.name}`, category: stdCats, sub, kind: 'elbow',
    w: 2, h: 1,
    ports: [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }],
    params: [],
    defaults: {},
    data: { d, bends: 0.5, lengthMm: 1.6 * f.boreMm + 30 },
  });

  add({
    id: `tee-${fid}`, name: `Tee ${f.name}`, category: stdCats, sub, kind: 'tee',
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
      id: `cross${n}-${fid}`, name: `${name} ${f.name}`, category: stdCats, sub, kind: 'cross',
      w: 3, h: 2, ports,
      params: [],
      defaults: {},
      data: { d, nPorts: n },
    });
  }

  add({
    id: `blank-${fid}`, name: `Blank flange ${f.name}`, category: 'Accessories', sub, kind: 'blank',
    w: 1, h: 1, ports: [{ x: 0, y: 0.5, flange: fid }],
    params: [], defaults: {}, data: { d },
  });
  add({
    id: `viewport-${fid}`, name: `Viewport ${f.name}`, category: 'Accessories', sub, kind: 'viewport',
    w: 1, h: 1, ports: [{ x: 0, y: 0.5, flange: fid }],
    params: [], defaults: {},
    data: { d, glassArea: Math.PI * (d / 2) ** 2 * 1.2 },
    fidelity: 'Viewport adds borosilicate glass outgassing area.',
  });
  add({
    id: `feedthru-${fid}`, name: `Feedthrough ${f.name}`, category: 'Accessories', sub, kind: 'feedthrough',
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
  const sub = f.name;
  const two: PortDef[] = [{ x: 0, y: 0.5, flange: fid }, { x: 2, y: 0.5, flange: fid }];
  const openParam: ParamDef = { key: 'open', label: 'Open', kind: 'boolean' };

  add({
    id: `gate-${fid}`, name: `Gate valve ${f.name}`, category: 'Valves', sub, kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm * 0.8 + 30, bends: 0, actuateTime: 2 },
  });
  add({
    id: `poppet-${fid}`, name: `Inline poppet ${f.name}`, category: 'Valves', sub, kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d: d * 0.8, lengthMm: f.boreMm * 1.5 + 30, bends: 0.5, actuateTime: 0.5 },
  });
  add({
    id: `angle-${fid}`, name: `Right-angle valve ${f.name}`, category: 'Valves', sub, kind: 'valve',
    w: 2, h: 2,
    ports: [{ x: 0, y: 1.5, flange: fid }, { x: 1.5, y: 0, flange: fid }],
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm * 2 + 40, bends: 1, actuateTime: 1 },
  });
  add({
    id: `ball-${fid}`, name: `Ball valve ${f.name}`, category: 'Valves', sub, kind: 'valve',
    w: 2, h: 1, ports: two,
    params: [openParam], defaults: { open: false },
    data: { d, lengthMm: f.boreMm + 30, bends: 0, actuateTime: 0.5 },
  });
  add({
    id: `butterfly-${fid}`, name: `Butterfly valve ${f.name}`, category: 'Valves', sub, kind: 'valve-butterfly',
    w: 2, h: 1, ports: two,
    params: [{ key: 'open', label: 'Opening', kind: 'number', min: 0, max: 100, step: 1, unit: '%' }],
    defaults: { open: 0 },
    data: { d, lengthMm: f.boreMm * 0.6 + 20 },
    fidelity: 'Butterfly at fraction x: aperture of area x·A_bore in series with the body tube.',
  });
}

add({
  id: 'metering', name: 'Metering / leak valve', category: 'Valves', sub: 'Special', kind: 'valve-metering',
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
  id: 'vent', name: 'Vent valve', category: 'Valves', sub: 'Special', kind: 'valve-vent',
  w: 1, h: 1,
  ports: [{ x: 0, y: 0.5, flange: 'ventFlange', dynamic: true }],
  params: [
    { key: 'open', label: 'Open', kind: 'boolean' },
    { key: 'ventFlange', label: 'Flange', kind: 'select', options: FLANGES.map((f) => ({ value: f.id, label: f.name })) },
  ],
  defaults: { open: false, ventFlange: 'KF16' },
  data: { d: 0.4, lengthMm: 50 },
});
add({
  id: 'gasadmit', name: 'Gas admittance valve', category: 'Valves', sub: 'Special', kind: 'valve-gas',
  w: 1, h: 1,
  ports: [{ x: 0, y: 0.5, flange: 'gasFlange', dynamic: true }],
  params: [
    { key: 'gas', label: 'Gas', kind: 'select', options: [
      { value: 'He', label: 'Helium' }, { value: 'Ar', label: 'Argon' }, { value: 'N2', label: 'N2 (dry)' },
    ] },
    { key: 'C', label: 'Conductance', kind: 'log', min: 1e-9, max: 1e-1, unit: 'L/s' },
    { key: 'open', label: 'Open', kind: 'boolean' },
    { key: 'gasFlange', label: 'Flange', kind: 'select', options: FLANGES.map((f) => ({ value: f.id, label: f.name })) },
  ],
  defaults: { gas: 'N2', C: 1e-3, open: false, gasFlange: 'KF16' },
  data: {},
});

// ------------------------------------------------------------------ pumps ----

const flangeSelect = (key: string, label: string): ParamDef => ({
  key, label, kind: 'select',
  options: FLANGES.map((f) => ({ value: f.id, label: f.name })),
});

for (const p of PUMP_CATALOG) {
  const backed = p.model.kind === 'turbo' || p.model.kind === 'diffusion' || p.model.kind === 'roots';
  // dynamic flanges: the catalog value is only the default — real pumps ship
  // with adapter options, and an editable flange feeds joint matching and the
  // elastomer seal-area bookkeeping exactly like the gauges already do
  const ports: PortDef[] = [{ x: 1.5, y: 0, flange: 'inletFlange', dynamic: true }];
  if (backed) ports.push({ x: 3, y: 1.5, flange: 'backingFlange', dynamic: true });
  const params: ParamDef[] = [{ key: 'on', label: 'Running', kind: 'boolean' }];
  if (p.model.kind === 'displacement' && p.model.hasBallast) {
    params.push({ key: 'ballast', label: 'Gas ballast', kind: 'boolean' });
  }
  // per-instance editable specs: catalog values are only the defaults, so a
  // generic pump can be dialed to any real datasheet (e.g. the 300 L/s
  // diffusion pump re-speced as a 3650 L/s VHS-10)
  const defaults: Record<string, number | boolean | string> = { on: false, ballast: false };
  const scalarSpeed = typeof (p.model as { sPeak: unknown }).sPeak === 'number';
  if (scalarSpeed) {
    const s = (p.model as { sPeak: number }).sPeak;
    params.push({ key: 'sPeak', label: 'Pumping speed', kind: 'number', unit: 'L/s', min: 0.01, max: 50000, step: s >= 50 ? 5 : 0.1 });
    defaults.sPeak = s;
  }
  if (p.model.kind === 'displacement' || p.model.kind === 'sorption') {
    params.push({ key: 'pUlt', label: 'Ultimate pressure', kind: 'log', unit: 'Torr', min: 1e-6, max: 20 });
    defaults.pUlt = p.model.pUlt;
  }
  if (p.model.kind === 'cryo' || p.model.kind === 'neg') {
    params.push({ key: 'scale', label: 'Size scale', kind: 'number', unit: '×', min: 0.05, max: 20, step: 0.05 });
    defaults.scale = 1;
  }
  params.push(flangeSelect('inletFlange', 'Inlet flange'));
  defaults.inletFlange = p.inletFlange;
  if (backed) {
    params.push(flangeSelect('backingFlange', 'Backing flange'));
    defaults.backingFlange = p.backingFlange ?? 'KF25';
  }
  add({
    id: `pump-${p.id}`, name: p.name, category: 'Pumps', sub: p.class, kind: 'pump',
    w: 3, h: 3, ports,
    params, defaults,
    data: { pumpId: p.id, backed },
    fidelity: p.brand
      ? `${p.notes} Nominal values from public datasheets (no affiliation) — verify against current manufacturer data. Speed/ultimate are editable per instance.`
      : `${p.notes} Values are class-representative approximations; speed/ultimate are editable per instance.`,
  });
}

// ----------------------------------------------------------------- gauges ----

interface GaugePartEntry {
  /** part id suffix; generic entries use the type itself for back-compat */
  id: string;
  type: GaugeType;
  name: string;
  /** manufacturer for real-hardware entries (nominal datasheet specs) */
  brand?: string;
  notes?: string;
}

const GAUGE_PARTS: GaugePartEntry[] = [
  { id: 'bourdon', type: 'bourdon', name: 'Bourdon / piezo' },
  { id: 'capacitance', type: 'capacitance', name: 'Capacitance manometer' },
  { id: 'thermocouple', type: 'thermocouple', name: 'Thermocouple gauge' },
  { id: 'pirani', type: 'pirani', name: 'Pirani gauge' },
  { id: 'coldcathode', type: 'coldcathode', name: 'Cold cathode gauge' },
  { id: 'hotcathode', type: 'hotcathode', name: 'Hot cathode (BA) gauge' },
  { id: 'fullrange', type: 'fullrange', name: 'Full-range gauge' },

  // real hardware (nominal datasheet ranges; the engine models the physics class)
  {
    id: 'gp275', type: 'pirani', name: 'Granville-Phillips 275 Convectron', brand: 'Granville-Phillips',
    notes: 'Convection-enhanced Pirani, 1e-4…990 Torr. The de-facto roughing gauge of US labs.',
  },
  {
    id: 'apg100', type: 'pirani', name: 'Edwards APG100-XM', brand: 'Edwards',
    notes: 'Active Pirani transmitter, ~1e-4 mbar…atmosphere.',
  },
  {
    id: 'gp531', type: 'thermocouple', name: 'Granville-Phillips 531', brand: 'Granville-Phillips',
    notes: 'Classic thermocouple tube, ~1e-3…2 Torr.',
  },
  {
    id: 'baratron626', type: 'capacitance', name: 'MKS Baratron 626C', brand: 'MKS',
    notes: 'Gas-independent capacitance manometer; pick the decade full scale. Reads true total pressure — the reference everything else is checked against.',
  },
  {
    id: 'baratron627', type: 'capacitance', name: 'MKS Baratron 627F (heated)', brand: 'MKS',
    notes: 'Heated head keeps condensables out of the diaphragm cavity; same decades. Zero-drift knob applies as on any capacitance head.',
  },
  {
    id: 'pkr251', type: 'fullrange', name: 'Pfeiffer PKR 251', brand: 'Pfeiffer',
    notes: 'Pirani + cold-cathode combination, 5e-9…1000 mbar — exactly the full-range model simulated here, hand-off and all.',
  },
  {
    id: 'ikr251', type: 'coldcathode', name: 'Pfeiffer IKR 251', brand: 'Pfeiffer',
    notes: 'Inverted magnetron, ~2e-9…1e-2 mbar. Strike delay and ×2-class accuracy modeled.',
  },
  {
    id: 'uhv24', type: 'hotcathode', name: 'Agilent UHV-24p (nude BA)', brand: 'Agilent',
    notes: 'Nude Bayard-Alpert; real X-ray limit ~5e-12 Torr (the engine floors at the 3e-11 class value).',
  },
  {
    id: 'gp360', type: 'hotcathode', name: 'Granville-Phillips 360 Stabil-Ion', brand: 'Granville-Phillips',
    notes: 'Stabilized BA package with tighter calibration than a bare tube.',
  },
  {
    id: 'gp355', type: 'hotcathode', name: 'Granville-Phillips 355 Micro-Ion', brand: 'Granville-Phillips',
    notes: 'Miniature BA module, ~2e-9…5e-2 Torr.',
  },
  {
    id: 'kjlc354', type: 'hotcathode', name: 'KJLC 354 Series ion gauge', brand: 'Kurt J. Lesker',
    notes: 'Hot-cathode BA module with integrated electronics.',
  },
  {
    id: 'mks925', type: 'pirani', name: 'MKS 925 MicroPirani', brand: 'MKS',
    notes: 'MEMS Pirani transducer, ~1e-5…1000 Torr nominal span.',
  },
  {
    id: 'mks972b', type: 'fullrange', name: 'MKS 972B DualMag', brand: 'MKS',
    notes: 'Cold-cathode + MicroPirani combination, ~1e-8 Torr…atmosphere.',
  },
  {
    id: 'edwards-wrg', type: 'fullrange', name: 'Edwards WRG-S', brand: 'Edwards',
    notes: 'Wide-range gauge: inverted magnetron + Pirani in one head.',
  },
  {
    id: 'leybold-ttr101', type: 'pirani', name: 'Leybold THERMOVAC TTR 101 N', brand: 'Leybold',
    notes: 'Active Pirani transmitter, ~5e-5…1000 mbar.',
  },
  {
    id: 'leybold-ptr90', type: 'fullrange', name: 'Leybold PENNINGVAC PTR 90 N', brand: 'Leybold',
    notes: 'Penning + Pirani combination, ~5e-9…1000 mbar.',
  },
  {
    id: 'instrutech-cvg101', type: 'pirani', name: 'InstruTech CVG101 Worker Bee', brand: 'InstruTech',
    notes: 'Convection-enhanced Pirani transmitter, 1e-4…1000 Torr.',
  },
];
const FLANGE_SELECT: ParamDef = flangeSelect('portFlange', 'Flange');

for (const g of GAUGE_PARTS) {
  const params: ParamDef[] = [{ key: 'enabled', label: 'Enabled', kind: 'boolean' }, FLANGE_SELECT];
  if (g.type === 'capacitance') {
    params.push({
      key: 'fullScale', label: 'Full scale', kind: 'select',
      options: [1000, 100, 10, 1, 0.1].map((v) => ({ value: v, label: `${v} Torr` })),
    });
  }
  add({
    id: `gauge-${g.id}`, name: g.name, category: 'Gauges', sub: g.brand ?? 'Generic', kind: 'gauge',
    w: 1, h: 1,
    ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
    params, defaults: { enabled: true, fullScale: 1000, portFlange: g.type === 'hotcathode' || g.type === 'coldcathode' ? 'CF40' : 'KF16' },
    data: { gaugeType: g.type },
    fidelity: g.brand
      ? `${g.notes ?? ''} Nominal values from public datasheets (no affiliation); the engine simulates the instrument class: ${GAUGE_SPECS[g.type].notes}`
      : GAUGE_SPECS[g.type].notes,
  });
}

add({
  id: 'rga', name: 'RGA head (quadrupole)', category: 'Gauges', kind: 'rga',
  w: 1, h: 1,
  ports: [{ x: 0.5, y: 1, flange: 'portFlange', dynamic: true }],
  params: [FLANGE_SELECT],
  defaults: { portFlange: 'CF40' },
  data: {},
  fidelity: 'Residual gas analyzer: partial pressures rendered as an m/z bar spectrum with standard electron-impact cracking patterns, weighted by ionization sensitivity (H2 under-reads, Ar/CO2 over-read). Filament interlock blanks the spectrum above 1e-4 Torr. Reads true partials — drift, ESD peaks and mass discrimination are not modeled.',
});

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
  fidelity: 'An in-chamber 77 K surface pumps water at near the impingement rate (~10 L/s/cm², sticking included) and CO₂; it does NOT pump N₂/O₂/H₂/He (their 77 K vapor pressures are far too high). Capacity ≈ ice buildup; switching LN₂ off warms the coil and RE-RELEASES the ice (H₂O above ~165 K) — watch the pressure spike, or regenerate while off to skip it.',
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
  fidelity: 'Foreline trap: conductance of an elbow ×0.4 (baffled path); while cold it pumps H₂O like a small cold surface — stops oil/water migration both ways. Letting it warm re-releases the trapped water into the foreline.',
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
