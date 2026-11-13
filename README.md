# ConductVac — Vacuum System Builder & Pump-Down Simulator

Build an arbitrary vacuum system from a parts library (chambers, tubes, fittings, valves, pumps, gauges, leaks) and simulate its pressure evolution from atmosphere to UHV with physically correct, regime-aware gas dynamics — fully client-side, in your browser.

- **Live pressure colormap** over the schematic (12 decades, viridis), including gradients *along* plumbing (tubes auto-segment internally).
- **Gauges that lie realistically**: gas-species sensitivity, response lag, noise, Pirani flatline, cold-cathode strike failures, hot-cathode filament trips, X-ray limit.
- **Strip charts** (log-p vs t or log-t) with a dashed *true pressure* overlay — watch your gauges deceive you.
- **Gas-load flow view**: sources (leaks, outgassing, permeation) → network → pumps, in Torr·L/s. Answers "what limits my base pressure."
- **Timeline event scripting** plus live interaction (double-click valves, pumps and cold traps while running).
- Multi-species (air, H₂O, H₂, He by default; gas-admittance valves auto-activate their gas, e.g. N₂/Ar backfill), He spray on leaks, bakeout (global or per-part), gas ballast, capacity-limited capture pumps.
- **Chamber payloads**: metal masses, porous graphite blocks, cable bundles (length × Ø × insulation), polymer/ceramic parts. Surface area drives outgassing; volume is subtracted from the chamber's free volume (gas displacement) — a big copper block pumps down faster but a graphite block outgasses for hours.
- **LN₂ cold traps**: in-chamber Meissner coil (pumps H₂O near the impingement rate, CO₂ slower, nothing with a high 77 K vapor pressure) and a right-angle foreline trap (elbow ×0.4 conductance + cold H₂O pumping).

Everything runs in a Web Worker; nothing leaves your machine. Save/load systems as JSON.

![Builder with live pressure colormap just after a scripted turbo crossover](docs/screenshot-builder.png)

![Per-chamber diagnosis naming and highlighting the 2 m KF25 hose as the bottleneck](docs/screenshot-sankey.png)

## Quick start

```bash
npm install
npm run dev        # development server
npm test           # engine validation suite (§ Physics below)
npm run build      # static production build in dist/
npm run smoke      # headless browser pass over dist/: every example must render clean
npm run lint       # ESLint (TypeScript + React hooks rules)
```

Load an example from the header dropdown (the scroll + turbo crossover is a good first tour), press **Run**, and raise the speed. The examples narrate themselves — a lesson line appears above the tabs as the script reaches each teaching moment. Double-click the gate valve mid-rough-down to see why crossover discipline matters.

## Building systems

- Click a part in the palette, then click the canvas to place it (shift-click keeps placing).
- **Wires route themselves** around parts and around each other: orthogonal runs with rounded corners, a smooth S-bend where two facing ports are up to a cell out of line. Lining ports up (parts snap to the grid) gives straight runs; **⌗ Tidy** re-assigns joints among equivalent ports to uncross them.
- **Splice**: while placing a 2-port part (valve, nipple, trap…), hover an existing wire — it highlights green and a click cuts the part into the line.
- Click two ports to connect them (or drop a part so its port lands on a compatible one). Port tooltips show the flange standard; mismatched flanges still join with a warning — insert an **Adapter/reducer** part for a proper joint.
- Click a joint dot to add a KF mesh-screen centering ring (×0.7 transmission); shift-click disconnects.
- Select a part to edit its parameters; `R` rotates, `Delete` removes, `Ctrl+Z` undoes.
- **Multi-select**: shift-click parts to toggle them in and out of the selection, or shift-drag on empty canvas for a marquee; drag any member to move the group. `Ctrl+A` selects all, `Ctrl+C`/`Ctrl+V` copy/paste (internal wiring included), `Ctrl+D` duplicates.
- Elastomer-sealed joints automatically contribute their wetted Viton area (outgassing **and** He/H₂O permeation).
- Tube physics follows the *length property*, not the drawn length.
- **Real hardware**: alongside the generic class-representative pumps and gauges, the catalog carries ~80 named commercial pumps and ~17 named gauges (Agilent VHS/TwisTorr/VacIon/IDP, Pfeiffer HiPace/Duo/Okta/MVP/PKR, Edwards nXDS/nEXT/EXT/RV/E2M/EH/Diffstak, Leybold TRIVAC/TURBOVAC/SCROLLVAC/COOLVAC/RUVAC, CTI Cryo-Torr, SAES CapaciTorr/NEXTorr, Welch, Vacuubrand, Gamma Vacuum, MKS Baratron, Granville-Phillips Convectron/Stabil-Ion/Micro-Ion, KJLC, InstruTech, …) with **nominal datasheet values** — no affiliation, and always verify against current manufacturer data before real design work.
- **Every pump is re-specable**: pumping speed (plus ultimate pressure for displacement pumps, or an overall size scale for cryo/NEG) is an editable parameter on each placed instance — the catalog value is just the default. Dial the generic 300 L/s diffusion pump up to a 3650 L/s VHS-10, or place the real one.
- **Editable fittings**: every pump's inlet (and backing) flange and every gauge's port flange are dropdown parameters on the placed part — swap a KF25 for an ISO100 without replacing the part; connections and mismatch warnings follow the new flange.

## Instruments & diagnosis

- **RGA tab**: place an *RGA head* (Gauges palette) on any port and watch a live m/z spectrum — standard cracking patterns (H₂O → 18/17/16, N₂ → 28/14, CO₂ → 44/28/16/12), ionization-sensitivity weighting, filament interlock above 1e-4 Torr.
- **Gas flow tab** now opens with a per-chamber diagnosis: *conductance-limited* (names the worst-drop element and its pressure ratio), *pump-limited*, *gas-load-limited* or *leak-limited*, with one-click culprit highlighting on the schematic. Permeation is split from outgassing in the Sankey.
- Capture pumps (cryo, NEG, sorption, LN₂ traps) show **capacity fill bars** on their symbols and per-species sorbed inventory in the inspector.
- **Lesson notes**: example scripts carry commentary that surfaces above the tab bar as the sim reaches each event; add your own in the Event script editor's note field.
- **📌 Pin a run** (strip-chart toolbar): freeze the current curves as a dashed ghost, change one thing — a hose, a pump, a bake — Reset, Run again, and read exactly what the change bought you.
- **⧉ Pump catalog browser** (Pumps palette, or any placed pump's inspector): honest S(p) curves sampled from the simulation's own pump models — rolloff knees, ultimate pressures, ion bells, critical backing — with one-click placement.

![RGA water ladder (18/17/16) hours into a 150 °C bake](docs/screenshot-rga.png)

## Temperature & failure drills

- **Every part has a live temperature**: select a chamber/tube/payload and set a setpoint (heats with τ ≈ 10 min, cools slower). Sealed volumes obey the gas law (p ∝ T exactly), molecular conductance scales √T, and outgassing follows ×10 per 60 °C — *bake* is now just "set 150 °C": hold it long enough (≈ 17 h-equivalent at 150 °C) and the surfaces flip to baked on their own. Script it with the *set temperature* action; the old bake events still work.
- **Gauges on hot zones lie**: ionization and thermal gauges under-read by √(T₀/T) in the molecular regime (thermal transpiration).
- **⚡ Power fail**: one button cuts the site — pumps coast down on their real time constants (a turbo freewheels on bearing friction for tens of minutes — far slower than its powered spin-up — until the flood itself windage-brakes the rotor; its compression collapses as K₀^spin, so the foreline creeps back through it), electronic gauges go dark (the bourdon survives), and restoring power replays the consequences: cold cathodes re-strike, hot cathodes trip if the pressure ran away, ion pumps refuse above their start limit. Scriptable with optional auto-restore.
- **Water saturates**: no node can hold H₂O vapor above psat(T) (Clausius-Clapeyron). The excess condenses on the walls (visible in the inspector), and re-evaporates when the walls warm or the vapor is pumped away.
- **Warming cryo surfaces re-release their ice**: switch off a cryopump or LN₂ trap and its sorbed inventory comes back, species by species as the head crosses each release temperature — but the gas phase pins at saturation and the rest sits as "regen dew" on the chamber walls, mass-balanced.
- **Vent gas matters**: the walls remember the humidity of the last gas that flooded them. Vent to air and the re-pumpdown fights re-adsorbed water; vent through a **gas admit valve** on dry N₂ and it carries ~50× less — the classic discipline, now simulated.

![Power-fail drill: the site goes dark and the turbo coasts while the chamber floods](docs/screenshot-powerfail.png)

## Run it anywhere (offline)

`npm run build:portable` produces **`dist-portable/conductvac.html`** (and `npm run smoke:portable` opens it from `file://` in a headless browser to confirm the engine runs there) — the whole app in one self-contained file (plus a ready-to-email zip). Double-click it and it runs entirely locally in any modern browser: no server, no install, no network access at any point. Everything is inlined, and the engine worker is spawned from a Blob URL — which is what lets it run from `file://`, where browsers refuse to load module and worker *files*. Only differences from the website: the Share button shows a copy-me prompt instead of silently reaching the clipboard (clipboard needs https), and autosave lives in that browser's localStorage.

## Sharing & files

- **🔗 Share** compresses the whole system into the URL (`#s=…`) and copies the link — no server, no account; opening the link restores the exact build.
- Your current system autosaves to the browser (localStorage) and is restored on the next visit; the **File ▾** menu holds Save/Load JSON for real files plus the schematic exports.
- **SVG/PNG** (File ▾) export the schematic as a standalone image, colormap and labels included.

---

## Physics

The system is a lumped-element network: nodes carry volume and per-species pressure; edges carry conductance; pumps and gas loads attach to nodes. For each node *i* and species *g*:

```
V_i · dp_ig/dt = Σ_j C_ij,g(p̄) · (p_jg − p_ig) + Q_leak + Q_outgas(t) + Q_permeation − S_ig(p) · p_ig
```

Units: Torr, liters, L/s, Torr·L/s, seconds (converted only at the display layer).

### Conductance (regime-aware, per edge, per species)

Air at 20 °C through a circular tube (d, L in cm, p̄ in Torr, C in L/s):

| Regime | Formula |
|---|---|
| Viscous (Poiseuille) | C_visc = 180 · d⁴/L · p̄ |
| Molecular (long tube) | C_mol = 12.1 · d³/L |
| Molecular aperture | C_ap = 11.6 · A  (A in cm²) |
| Knudsen interpolation | C = C_visc + Z·C_mol, Z = (1 + 2.507·(d/2λ)) / (1 + 3.095·(d/2λ)) |
| Mean free path | λ [cm] ≈ 5.0×10⁻³ / p̄ [Torr] |

Sources: Roth, *Vacuum Technology*; O'Hanlon, *A User's Guide to Vacuum Technology*; Dushman, *Scientific Foundations of Vacuum Technique*.

- **Short-tube correction** (every fitting): 1/C_mol,short = 1/C_ap + 1/C_mol,long — the Dushman approximation, good to ~10% versus Clausing factors.
- **Bends**: +1.33·d equivalent length per 90° bend. **Corrugated hose**: geometric length ×1.4 at the corrugation-root ID. **Bellows**: ×1.2.
- **Tube auto-segmentation**: anything longer than 15 cm splits into ≤10 cm segments with internal volume and wall area — this is what makes pressure gradients along forelines visible in the colormap (capped ~2000 nodes). The entrance loss is counted **once per tube** (shared by the two end segments), so a segmented tube has exactly the conductance of the unsegmented one.
- **Mixtures flow as mixtures.** Every element has two parts. The *diffusive* part moves each species down its own partial-pressure gradient, × √(28.97/M); it is the whole flow in the molecular regime and fades as 1/(1 + k·d/2λ) toward gas-phase diffusion in the continuum (Bosanquet interpolation). The *bulk* part (Poiseuille + slip) is driven by the total pressure difference and carries the **upstream composition** with it, scaled by the mixture's viscosity and mean molar mass. So viscous roughing does not strip water or enrich helium, and nothing diffuses upstream against a viscous flow faster than gas-phase diffusion allows.
- **Choked flow**: laminar Poiseuille flow has no speed limit, so tubes carry the sonic-orifice cap Q ≤ 20·A·p_upstream (air; O'Hanlon). It is applied as a series resistance that vanishes for small pressure ratios and in molecular flow: a vent valve or a flood through a short fitting is limited to the choked rate, while a line feeding a pump at a few percent of sonic speed keeps ≥ 94% of its Poiseuille conductance.
- The Knudsen number uses the air mean free path at the total mean pressure (mixture approximation).

### Pumps

- **Positive displacement** (diaphragm, rotary vane, scroll): S = S_peak·(1 − p_ult/p)₊ with a smoothed clip; gas ballast raises p_ult ×10 for H₂O and ×2 otherwise.
- **Roots**: compression-ratio-limited against its backing pressure; speed collapses when ΔP exceeds the rating.
- **Turbomolecular / diffusion**: throughput per species Q = A_g·(p_in,g − p_back,g/K0_g)₊ with **datasheet-style per-gas speeds** (turbo: He ≈ 1.0×, H₂ ≈ 0.85×, Ar ≈ 0.98× the N₂ speed — the mean of five commercial datasheets; diffusion: He and H₂ ≈ 1.25×; *not* √(28/M), which would overstate a turbo's H₂ speed about 4×), species-dependent zero-flow compression K0 (K0(N₂) ~ 10⁸–10⁹, K0(H₂) ~ 10³–10⁴), smooth throughput rolloff above ~10⁻² Torr inlet, hard cutoff above the critical backing pressure, and first-order spin-up/warm-up. **H₂ dominating a baked system and turbos stalling on failed backing emerge from the model** rather than being scripted.
- **Ion**: bell-shaped S(p) peaking at 10⁻⁶ Torr (50% at 10⁻⁸/10⁻⁴), refuses to start above 10⁻⁴ Torr, noble-gas speed 5% (diode) / 25% (noble diode), overpressure trip.
- **Cryopump**: per-species speeds (H₂O ≈ 3× N₂), finite per-species capacity in Torr·L with saturation events, early-crossover warning above 50 mTorr.
- **NEG**: pumps H₂/H₂O/N₂/O₂/CO, nothing noble, finite capacity. **Sorption**: capacity-limited roughing.

### Gas loads

- **Leaks**: fixed-conductance orifice from a 760 Torr atmosphere node; species arrive in proportion to their atmospheric partials scaled by √(28.97/M). Sprayable with helium (dwell-limited) for leak checking.
- **Virtual leak**: a trapped cm³ at atmosphere bleeding through ~10⁻⁶ L/s — the classic slow-bleed signature He spraying cannot find.
- **Outgassing**: Q = q₁·A·(t₁/(t+t₀))ⁿ per wetted surface with per-node exposure clocks (venting above 100 Torr resets them), t₁ = 1 h, t₀ = 60 s. Unbaked metals emit mostly H₂O; a completed bake permanently divides the H₂O term by 100 and switches to the material's (constant) H₂ rate. During a bake the rate multiplies by 10^((T−20 °C)/60) — a documented stand-in for Arrhenius behavior.
- **Permeation**: every elastomer *seal* admits each gas in proportion to its partial pressure in the room air outside, Q = K·(A/w)·p with published permeabilities (Peacock 1980; Viton: He 12, N₂ 0.2, O₂ 1.0, H₂O 40 ×10⁻⁸ scc·cm/(s·cm²·atm)) and an effective path w = 0.3 cm. For Viton in 50% RH air that is ≈ 10⁻⁸ Torr·L/s of air plus ≈ 10⁻⁸ of water per cm² of seal — the real floor of O-ring systems, and it scales with the humidity setting. Atmospheric helium (5 ppm) contributes only ~2×10⁻¹² per cm². Published permeabilities scatter by up to ×10; treat the result as order-of-magnitude. An elastomer *inside* the chamber (a payload) outgasses but does not permeate.

**Outgassing rates are order-of-magnitude, surface-history-dependent quantities.** Values follow O'Hanlon, *A User's Guide to Vacuum Technology* (outgassing chapter and appendices); Pfeiffer Vacuum, *The Vacuum Technology Book / Know-How*; Leybold, *Fundamentals of Vacuum Technology*.

### Gauges

| Gauge | Range (Torr) | Modeled behavior |
|---|---|---|
| Bourdon/piezo | 760 → 1 | gas independent, ±1 Torr noise |
| Capacitance manometer | FS → 10⁻⁴·FS | gas independent, 0.25% of reading, zero drift |
| Thermocouple | 2 → 10⁻³ | gas correction factors, sluggish (τ = 2 s) |
| Pirani | 100 → 10⁻⁴ | gas factors, flatlines below 10⁻⁴, pegs at ATM |
| Cold cathode | 10⁻² → 10⁻⁹ | strike delay ≤10 s below 10⁻⁶ (sometimes fails), ×2 accuracy, gas sensitivity |
| Hot cathode (BA) | 10⁻⁴ → 10⁻¹¹ | filament trip above 10⁻⁴, sensitivity (He 0.18, Ar 1.3, H₂ 0.46), X-ray limit 5×10⁻¹² |
| Full-range | 760 → 10⁻⁹ | Pirani+CC stitch with a visible handoff artifact near 10⁻² |

### Numerical method

The ODE system is stiff (time constants from ~0.1 ms to hours). The solver:

- integrates **u = ln p** per node per species (positivity across 12 decades; pure exponential decay is reproduced *exactly* at any step size);
- **backward Euler with Newton iteration**; the Jacobian has graph-Laplacian structure plus 2×2 pump inlet↔backing blocks, assembled banded after reverse Cuthill-McKee ordering and factorized without pivoting (with row equilibration — pressures spanning ~19 decades otherwise overflow the elimination);
- splits each step into **pressure, then composition** wherever gas flows in bulk: one implicit solve for the node *totals* with the composition frozen, then one implicit upwind-transport solve per species using the bulk flows that pressure solve produced (conservative, and identical to the pressure solve for a uniform mixture). Steps with no bulk flow anywhere, and single-gas systems, solve each species' diffusive network directly;
- freezes everything depending on *total* pressure — Knudsen conductances, pump rolloff/critical-backing/ultimate factors — and refreshes it in a damped outer iteration;
- adapts the timestep from 1 ms (after events) by ×1.5 growth / ×4 shrink between a BDF-style local error estimate, capped at 10 s live (1 h in fast-forward);
- stops **exactly** at scripted/interactive events, applies them, and restarts small;
- runs in a Web Worker, posting ~10 Hz snapshots; chart samples are recorded per solver step (decimated), so transients stay resolved at any sim speed.

**Validation suite** (`src/engine/tests/validation.test.ts`, `npm test`):

1. Single volume + fixed-S pump ⇒ p₀·e^(−St/V) within 0.5% over 6 decades
2. Two volumes through a conductance ⇒ analytic two-exponential solution
3. Conductance-limited pumping ⇒ 1/S_eff = 1/S + 1/C
4. Long-tube molecular conductance ⇒ 12.1·d³/L within 1%
5. Viscous rough-down ⇒ quasi-static Poiseuille solution
6. Outgassing-dominated steady state ⇒ p_ss = Q/S_eff
7. Stiffness: 0.05 L node between a 300 L/s pump and 100 L chamber, accurate at dt ≫ V/C

`src/engine/tests/mixture.test.ts` adds what a single-gas suite cannot see: segmented vs unsegmented tube conductance (equal to 9 digits), composition preserved to 1% through 480 s of viscous roughing, no upstream diffusion against a viscous flow with per-species inventories conserved, and vent time against the choked-orifice rate (within 15%).

Plus integration tests on every bundled example (crossover shape, permeation floor, post-bake H₂ dominance at ~10⁻¹⁰, virtual-leak signature, Pirani-vs-full-range divergence).

---

## Model fidelity & limitations

Representative, not manufacturer data — pump curves, gauge factors and outgassing rates are class-typical values for teaching and system-level trend analysis. Known simplifications (also surfaced as ⓘ notes in the inspector):

- Short-tube conductances use the Dushman series approximation (~10% vs Clausing); series chains of *separate* fittings each carry their own entrance loss (10–20% conservative). No beaming corrections.
- Continuum flow is laminar Poiseuille with a sonic-orifice throughput cap: no turbulence, and no Bernoulli entrance loss below the choked rate. Bare apertures use the choked value at every pressure ratio (conservative at small ratios).
- Mixture viscosity and mean molar mass are mole-fraction averages of the upstream gas; the mean free path is air's.
- The integrator works in ln p: exponential decays are exact at any step size, but filling a near-empty volume drops O((Δln p)²) of the inflow per step — sealed gas-transfer inventories are good to ~1–2%, not to round-off.
- Throughput is carried in Torr·L without converting between nodes at different temperatures (a few percent in a bake), and thermal transpiration is applied only at the gauge.
- Turbo/diffusion back-diffusion is clipped at zero net flow per species: the compression limit emerges correctly, but gas cannot travel backwards through a pump at speed (no counterflow leak detection).
- An overloaded (rolled-off) turbo keeps 0.2% of its speed so overload stalls recover once the inlet drops — real pumps trip on temperature/current instead.
- Bakeout is a permanent ×100 H₂O reduction plus the tabulated H₂ rate — real bake quality varies; venting a baked system does not fully restore the unbaked state here.
- Positive-displacement pumps are assumed to hold vacuum when off (check valve); spin-up/down is a first-order lag with S ∝ rotor speed.
- Atmospheric H₂O follows 17.5 Torr saturation at 20 °C × RH; adsorbed-water outgassing scales with RH/50%.
- Temperatures are per-node setpoint ramps (no heat-transfer model); viscosity is held at its 20 °C value. No turbo venting dynamics, no oil vapor transport (backstreaming is an event-log warning).
- Seal permeation is steady-state: no time lag, no temperature dependence, and helium sprayed on an O-ring joint does not produce the delayed permeation signal a real leak check shows.

## Repository layout

```
src/engine     pure TS physics core (zero React imports) + worker + tests
src/data       gases, materials, flanges, fittings/parts, pumps, gauges
src/compile.ts part-graph → engine-network compiler (union-find joints, seals)
src/ui         builder, inspector, controls, charts, colormap, sankey
src/examples   bundled example systems (integration-test fixtures)
scripts        browser smoke test (npm run smoke, after a build) and the portable-build script
```

## Deploy

Pushes to `main` build and publish to GitHub Pages via `.github/workflows/deploy.yml` (Vite `base: './'` keeps the bundle relocatable). Pull requests run lint, the tests, the build, the headless-browser smoke test and the portable build via `.github/workflows/ci.yml` before anything merges. Any static file host works: `npm run build` and serve `dist/`.

## References

- J. F. O'Hanlon, *A User's Guide to Vacuum Technology*, 3rd ed., Wiley.
- Pfeiffer Vacuum, *The Vacuum Technology Book* / *Vacuum Technology Know-How*.
- Leybold, *Fundamentals of Vacuum Technology*.
- A. Roth, *Vacuum Technology*, 3rd ed., North-Holland.
- S. Dushman, *Scientific Foundations of Vacuum Technique*, 2nd ed., Wiley.
- R. N. Peacock, "Practical selection of elastomer materials for vacuum seals", *J. Vac. Sci. Technol.* 17, 330 (1980) — permeabilities, as reproduced in P. Chiggiato, [CERN Accelerator School notes](https://arxiv.org/abs/2006.07124).
