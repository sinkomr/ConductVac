import { useCallback, useEffect, useRef, useState } from 'react';
import type { PartInstance } from '../../types';
import { PART_BY_ID, portFlange } from '../../data/fittings';
import { formatPressure, nodePartials, nodePressures, useStore } from '../../store';
import { CELL, PartSymbol } from './PartSymbol';
import { Colorbar } from '../colormap/Colorbar';

/** transformed port position (px, canvas space) */
export function portPos(inst: PartInstance, portIdx: number): { x: number; y: number } {
  const def = PART_BY_ID[inst.def];
  const p = def.ports[portIdx];
  const cx = def.w / 2;
  const cy = def.h / 2;
  let dx = p.x - cx;
  let dy = p.y - cy;
  const r = inst.rot;
  if (r === 90) [dx, dy] = [-dy, dx];
  else if (r === 180) [dx, dy] = [-dx, -dy];
  else if (r === 270) [dx, dy] = [dy, -dx];
  return { x: (inst.x + cx + dx) * CELL, y: (inst.y + cy + dy) * CELL };
}

interface Hover {
  x: number;
  y: number;
  inst: PartInstance;
}

export function Canvas() {
  const system = useStore((s) => s.system);
  const selection = useStore((s) => s.selection);
  const connectFrom = useStore((s) => s.connectFrom);
  const placing = useStore((s) => s.placing);
  const compiled = useStore((s) => s.compiled);
  const unit = useStore((s) => s.unit);
  const species = useStore((s) => s.snapshot?.species);
  const st = useStore.getState;

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: -60, y: -60, scale: 1 });
  const [drag, setDrag] = useState<null | { id: string; ox: number; oy: number }>(null);
  const [pan, setPan] = useState<null | { sx: number; sy: number; vx: number; vy: number }>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  useStore((s) => s.chartTick); // repaint tooltip pressures
  const fitTick = useStore((s) => s.fitTick);

  // touch pinch-zoom state: active pointers + gesture baseline
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<null | { d0: number; scale0: number; wx: number; wy: number }>(null);

  // fit the whole system into view (on load, on the Fit button, on mount)
  useEffect(() => {
    const parts = useStore.getState().system.parts;
    if (!svgRef.current || parts.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of parts) {
      const def = PART_BY_ID[p.def];
      if (!def) continue;
      minX = Math.min(minX, p.x - 0.5);
      minY = Math.min(minY, p.y - 1);
      maxX = Math.max(maxX, p.x + def.w + 0.5);
      maxY = Math.max(maxY, p.y + def.h + 1);
    }
    if (!Number.isFinite(minX)) return;
    const bw = (maxX - minX) * CELL;
    const bh = (maxY - minY) * CELL;
    const rect = svgRef.current.getBoundingClientRect();
    const margin = 30;
    const scale = Math.max(0.25, Math.min(1.25,
      Math.min((rect.width - 2 * margin) / bw, (rect.height - 2 * margin) / bh)));
    setView({
      scale,
      x: minX * CELL + bw / 2 - rect.width / (2 * scale),
      y: minY * CELL + bh / 2 - rect.height / (2 * scale),
    });
  }, [fitTick]);

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / view.scale + view.x,
        y: (clientY - rect.top) / view.scale + view.y,
      };
    },
    [view],
  );

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      const s = st();
      if (e.key === 'Escape') {
        s.setPlacing(null);
        s.select(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        s.deletePart(s.selection);
      } else if ((e.key === 'r' || e.key === 'R') && s.selection) {
        s.rotatePart(s.selection);
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st]);

  const onWheel = (e: React.WheelEvent) => {
    const pt = toCanvas(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.max(0.25, Math.min(3, view.scale * factor));
    setView({
      scale,
      x: pt.x - (pt.x - view.x) * (view.scale / scale),
      y: pt.y - (pt.y - view.y) * (view.scale / scale),
    });
  };

  const onBgDown = (e: React.PointerEvent) => {
    if (pointersRef.current.size >= 2) return; // pinch in progress
    if (placing) {
      const pt = toCanvas(e.clientX, e.clientY);
      const def = PART_BY_ID[placing];
      st().addPart(placing, Math.round(pt.x / CELL - def.w / 2), Math.round(pt.y / CELL - def.h / 2));
      if (!e.shiftKey) st().setPlacing(null);
      return;
    }
    st().select(null);
    setPan({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
  };

  const onMove = (e: React.PointerEvent) => {
    // two-finger pinch: zoom around the gesture's anchor point
    const ptr = pointersRef.current;
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = svgRef.current!.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      if (!pinchRef.current) {
        pinchRef.current = {
          d0: d,
          scale0: view.scale,
          wx: mx / view.scale + view.x,
          wy: my / view.scale + view.y,
        };
        setPan(null);
        setDrag(null);
      } else {
        const g = pinchRef.current;
        const scale = Math.max(0.25, Math.min(3, g.scale0 * (d / g.d0)));
        setView({ scale, x: g.wx - mx / scale, y: g.wy - my / scale });
      }
      return;
    }
    const pt = toCanvas(e.clientX, e.clientY);
    setMouse(pt);
    if (pan) {
      setView({
        ...view,
        x: pan.vx - (e.clientX - pan.sx) / view.scale,
        y: pan.vy - (e.clientY - pan.sy) / view.scale,
      });
    } else if (drag) {
      st().movePart(drag.id, Math.round((pt.x / CELL - drag.ox) * 2) / 2, Math.round((pt.y / CELL - drag.oy) * 2) / 2);
    }
  };

  const onUp = () => {
    setPan(null);
    if (drag) {
      // snap-connect: if a free port of the dragged part lands near a free compatible port
      const s = st();
      const inst = s.system.parts.find((p) => p.id === drag.id);
      if (inst) trySnapConnect(inst);
      setDrag(null);
    }
  };

  const trySnapConnect = (inst: PartInstance) => {
    const s = st();
    const used = (p: string, i: number) =>
      s.system.connections.some((c) => (c.a.part === p && c.a.port === i) || (c.b.part === p && c.b.port === i));
    const def = PART_BY_ID[inst.def];
    for (let i = 0; i < def.ports.length; i++) {
      if (used(inst.id, i)) continue;
      const a = portPos(inst, i);
      for (const other of s.system.parts) {
        if (other.id === inst.id) continue;
        const odef = PART_BY_ID[other.def];
        for (let j = 0; j < odef.ports.length; j++) {
          if (used(other.id, j)) continue;
          const b = portPos(other, j);
          if (Math.hypot(a.x - b.x, a.y - b.y) < CELL * 0.7) {
            s.beginConnect(inst.id, i);
            s.completeConnect(other.id, j);
            return;
          }
        }
      }
    }
  };

  const w = svgRef.current?.clientWidth ?? 800;
  const h = svgRef.current?.clientHeight ?? 600;

  const portIsUsed = (p: string, i: number) =>
    system.connections.some((c) => (c.a.part === p && c.a.port === i) || (c.b.part === p && c.b.port === i));

  const tooltipNode = hover ? compiled?.regionNode[`${hover.inst.id}:0`] ?? compiled?.portNode[`${hover.inst.id}:0`] : undefined;
  const tooltipP = tooltipNode ? nodePressures.get(tooltipNode) : undefined;
  const tooltipPartials = tooltipNode ? nodePartials.get(tooltipNode) : undefined;

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        onWheel={onWheel}
        onPointerDownCapture={(e) => {
          if (e.pointerType === 'touch') pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }}
        onPointerUpCapture={(e) => {
          pointersRef.current.delete(e.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
        }}
        onPointerCancelCapture={(e) => {
          pointersRef.current.delete(e.pointerId);
          if (pointersRef.current.size < 2) pinchRef.current = null;
        }}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { setHover(null); onUp(); }}
      >
        <defs>
          <pattern id="grid" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} fill="#2c3038" />
          </pattern>
        </defs>
        <g transform={`scale(${view.scale}) translate(${-view.x} ${-view.y})`}>
          <rect
            x={view.x - 10} y={view.y - 10}
            width={w / view.scale + 20} height={h / view.scale + 20}
            fill="url(#grid)"
            pointerEvents="none"
          />
          {/* connections */}
          {system.connections.map((c) => {
            const pa = system.parts.find((p) => p.id === c.a.part);
            const pb = system.parts.find((p) => p.id === c.b.part);
            if (!pa || !pb) return null;
            const A = portPos(pa, c.a.port);
            const B = portPos(pb, c.b.port);
            return (
              <g key={c.id}>
                <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="#8f97a8" strokeWidth={5} opacity={0.85} />
                <circle
                  cx={(A.x + B.x) / 2} cy={(A.y + B.y) / 2} r={5}
                  fill={c.mesh ? '#caa9ff' : '#8f97a8'}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey) st().disconnect(c.id);
                    else st().toggleMesh(c.id);
                  }}
                >
                  <title>{c.mesh ? 'mesh screen (×0.7) — click to remove screen' : 'joint — click to add mesh screen, shift-click to disconnect'}</title>
                </circle>
              </g>
            );
          })}
          {/* parts */}
          {system.parts.map((inst) => {
            const def = PART_BY_ID[inst.def];
            if (!def) return null;
            return (
              <g
                key={inst.id}
                transform={`translate(${inst.x * CELL} ${inst.y * CELL}) rotate(${inst.rot} ${(def.w * CELL) / 2} ${(def.h * CELL) / 2})`}
                className="part"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  st().select(inst.id);
                  const pt = toCanvas(e.clientX, e.clientY);
                  setDrag({ id: inst.id, ox: pt.x / CELL - inst.x, oy: pt.y / CELL - inst.y });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const kind = def.kind;
                  if (kind.startsWith('valve') && kind !== 'valve-butterfly') {
                    st().setParam(inst.id, 'open', !inst.params.open);
                  } else if (kind === 'pump' || kind.startsWith('coldtrap')) {
                    st().setParam(inst.id, 'on', !inst.params.on);
                  } else if (kind === 'gauge') {
                    st().setParam(inst.id, 'enabled', !inst.params.enabled);
                  }
                }}
                onPointerEnter={(e) => setHover({ x: e.clientX, y: e.clientY, inst })}
                onPointerMove={(e) => setHover({ x: e.clientX, y: e.clientY, inst })}
                onPointerLeave={() => setHover(null)}
              >
                <PartSymbol inst={inst} selected={selection === inst.id} />
              </g>
            );
          })}
          {/* ports (drawn untransformed, on top) */}
          {system.parts.map((inst) => {
            const def = PART_BY_ID[inst.def];
            if (!def) return null;
            return def.ports.map((_, i) => {
              const pos = portPos(inst, i);
              const used = portIsUsed(inst.id, i);
              const active = connectFrom?.part === inst.id && connectFrom.port === i;
              let compatible = true;
              if (connectFrom && !used) {
                const fromInst = system.parts.find((p) => p.id === connectFrom.part)!;
                const fromDef = PART_BY_ID[fromInst.def];
                const fa = portFlange(fromDef, connectFrom.port, { ...fromDef.defaults, ...fromInst.params });
                const fb = portFlange(def, i, { ...def.defaults, ...inst.params });
                compatible = fa === fb;
              }
              return (
                <circle
                  key={`${inst.id}:${i}`}
                  cx={pos.x} cy={pos.y} r={used ? 4 : 6}
                  className={`port ${used ? 'used' : 'free'} ${active ? 'active' : ''} ${connectFrom && !used && !active ? (compatible ? 'target' : 'mismatch') : ''}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (used) return;
                    if (connectFrom) st().completeConnect(inst.id, i);
                    else st().beginConnect(inst.id, i);
                  }}
                >
                  <title>{portFlange(def, i, { ...def.defaults, ...inst.params })}</title>
                </circle>
              );
            });
          })}
          {/* rubber band while connecting */}
          {connectFrom && (() => {
            const inst = system.parts.find((p) => p.id === connectFrom.part);
            if (!inst) return null;
            const A = portPos(inst, connectFrom.port);
            return <line x1={A.x} y1={A.y} x2={mouse.x} y2={mouse.y} stroke="#6ab0ff" strokeDasharray="5 4" strokeWidth={2} />;
          })()}
          {/* ghost while placing */}
          {placing && (() => {
            const def = PART_BY_ID[placing];
            return (
              <rect
                x={(Math.round(mouse.x / CELL - def.w / 2)) * CELL}
                y={(Math.round(mouse.y / CELL - def.h / 2)) * CELL}
                width={def.w * CELL} height={def.h * CELL}
                fill="#6ab0ff22" stroke="#6ab0ff" strokeDasharray="4 4" rx={6}
                pointerEvents="none"
              />
            );
          })()}
        </g>
      </svg>
      <Colorbar />
      {hover && tooltipP !== undefined && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <b>{hover.inst.id}</b> — {formatPressure(tooltipP, unit)}
          {tooltipPartials && species && (
            <table>
              <tbody>
                {species.map((g, i) => (
                  <tr key={g}>
                    <td>{g}</td>
                    <td>{formatPressure(tooltipPartials[i], unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
