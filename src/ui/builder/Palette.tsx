import { useMemo, useState } from 'react';
import { PART_CATEGORIES, PARTS } from '../../data/fittings';
import { useStore } from '../../store';

export function Palette() {
  const placing = useStore((s) => s.placing);
  const setPlacing = useStore((s) => s.setPlacing);
  const [search, setSearch] = useState('');
  const [openCat, setOpenCat] = useState<string | null>('Chambers');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return PARTS.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q)).slice(0, 60);
  }, [search]);

  return (
    <aside className="palette">
      <input
        className="search"
        placeholder="Search parts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered ? (
        <div className="cat-list">
          {filtered.map((p) => (
            <button
              key={p.id}
              className={`part-btn ${placing === p.id ? 'placing' : ''}`}
              onClick={() => setPlacing(placing === p.id ? null : p.id)}
              title={p.fidelity}
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : (
        PART_CATEGORIES.map((cat) => (
          <div key={cat}>
            <button className="cat-header" onClick={() => setOpenCat(openCat === cat ? null : cat)}>
              {openCat === cat ? '▾' : '▸'} {cat}
            </button>
            {openCat === cat && (
              <div className="cat-list">
                {PARTS.filter((p) => p.category === cat).map((p) => (
                  <button
                    key={p.id}
                    className={`part-btn ${placing === p.id ? 'placing' : ''}`}
                    onClick={() => setPlacing(placing === p.id ? null : p.id)}
                    title={p.fidelity}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      <div className="hint">
        Click a part, then click the canvas to place (shift-click = place more). Click two ports to
        connect. Double-click valves/pumps to toggle. R rotates, Del deletes.
      </div>
    </aside>
  );
}
