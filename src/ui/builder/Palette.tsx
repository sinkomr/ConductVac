import { useMemo, useState } from 'react';
import { PARTS, type PartDef } from '../../data/fittings';
import { useStore } from '../../store';

/**
 * Two-level palette: category → subcategory (flange size, pump class, …) →
 * parts. Categories without subcategories render flat. Search is flat across
 * everything.
 */

const CATEGORY_ORDER = [
  'Chambers', 'Chamber payloads', 'Tubes & fittings', 'Valves', 'Pumps',
  'Cold traps', 'Gauges', 'Sources', 'Accessories', 'Gas lines',
];

export function Palette() {
  const placing = useStore((s) => s.placing);
  const setPlacing = useStore((s) => s.setPlacing);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const [search, setSearch] = useState('');
  const [openCat, setOpenCat] = useState<string | null>('Chambers');
  const [openSub, setOpenSub] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const map = new Map<string, { flat: PartDef[]; subs: Map<string, PartDef[]> }>();
    for (const p of PARTS) {
      let cat = map.get(p.category);
      if (!cat) {
        cat = { flat: [], subs: new Map() };
        map.set(p.category, cat);
      }
      if (p.sub) {
        const list = cat.subs.get(p.sub) ?? [];
        list.push(p);
        cat.subs.set(p.sub, list);
      } else {
        cat.flat.push(p);
      }
    }
    return map;
  }, []);

  const categories = useMemo(() => {
    const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
    const rest = [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c));
    return [...known, ...rest];
  }, [byCategory]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return PARTS.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)).slice(0, 80);
  }, [search]);

  const partBtn = (p: PartDef) => (
    <button
      key={p.id}
      className={`part-btn ${placing === p.id ? 'placing' : ''}`}
      onClick={() => setPlacing(placing === p.id ? null : p.id)}
      title={p.fidelity}
    >
      {p.name}
    </button>
  );

  return (
    <aside className={`palette ${paletteOpen ? 'open' : ''}`}>
      <button className="btn mobile-only drawer-close" onClick={() => setPaletteOpen(false)}>✕ close</button>
      <input
        className="search"
        placeholder="Search parts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered ? (
        <div className="cat-list">{filtered.map(partBtn)}</div>
      ) : (
        categories.map((cat) => {
          const entry = byCategory.get(cat)!;
          const open = openCat === cat;
          return (
            <div key={cat}>
              <button className="cat-header" onClick={() => setOpenCat(open ? null : cat)}>
                {open ? '▾' : '▸'} {cat}
              </button>
              {open && (
                <div className="cat-list">
                  {entry.flat.map(partBtn)}
                  {[...entry.subs.entries()].map(([sub, parts]) => {
                    const subKey = `${cat}:${sub}`;
                    const subOpen = openSub === subKey;
                    return (
                      <div key={subKey} className="sub-group">
                        <button
                          className="sub-header"
                          onClick={() => setOpenSub(subOpen ? null : subKey)}
                        >
                          {subOpen ? '▾' : '▸'} {sub}
                          <span className="sub-count">{parts.length}</span>
                        </button>
                        {subOpen && <div className="cat-list sub-list">{parts.map(partBtn)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
      <div className="hint">
        Click a part, then click the canvas to place (shift-click = place more). Click two ports to
        connect. Double-click valves/pumps/traps to toggle. R rotates, Del deletes.
      </div>
    </aside>
  );
}
