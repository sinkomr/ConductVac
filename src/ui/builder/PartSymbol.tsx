import { memo } from 'react';
import type { PartInstance } from '../../types';
import { PART_BY_ID } from '../../data/fittings';
import { nodePressures, useStore } from '../../store';
import { pressureColor } from '../colormap/colormap';

/**
 * Schematic symbols (ISO-flavored: pump triangles, valve bowties, gauge
 * circles), painted by the live pressure colormap. Region → engine-node
 * mapping comes from the compiler; while un-compiled everything renders in
 * neutral gray.
 */

export const CELL = 26; // px per grid unit

function fill(instId: string, region: number): string {
  const compiled = useStore.getState().compiled;
  const node = compiled?.regionNode[`${instId}:${region}`];
  const p = node ? nodePressures.get(node) : undefined;
  return p !== undefined ? pressureColor(p) : '#3a3f4a';
}

const STROKE = '#c8cdd8';

export const PartSymbol = memo(function PartSymbol({ inst, selected }: { inst: PartInstance; selected: boolean }) {
  // subscribe to snapshot updates so colors repaint
  useStore((s) => s.chartTick);
  useStore((s) => s.compiled);
  const def = PART_BY_ID[inst.def];
  if (!def) return null;
  const w = def.w * CELL;
  const h = def.h * CELL;
  const sel = selected ? { stroke: '#6ab0ff', strokeWidth: 2.5 } : { stroke: STROKE, strokeWidth: 1.4 };
  const label = (inst.params.on !== undefined && def.kind === 'pump' && !inst.params.on) ? `${inst.id} (off)` : inst.id;

  let body: JSX.Element;
  switch (def.kind) {
    case 'chamber': {
      const shape = def.data.shape;
      body = shape === 'sphere' ? (
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 3} fill={fill(inst.id, 0)} {...sel} />
      ) : (
        <rect x={3} y={3} width={w - 6} height={h - 6} rx={10} fill={fill(inst.id, 0)} {...sel} />
      );
      break;
    }
    case 'tube':
    case 'flex':
    case 'bellows': {
      const L = Math.max(1, Number(inst.params.length ?? 100) / 10);
      const nSeg = L <= 15 ? 1 : Math.ceil(L / 10);
      const spans = [];
      for (let k = 0; k < nSeg; k++) {
        spans.push(
          <rect key={k} x={(w * k) / nSeg} y={h / 2 - 6} width={w / nSeg + 0.6} height={12}
            fill={fill(inst.id, k)} stroke="none" />,
        );
      }
      body = (
        <g>
          {spans}
          <rect x={0} y={h / 2 - 6} width={w} height={12} fill="none" {...sel}
            strokeDasharray={def.kind === 'flex' ? '4 3' : def.kind === 'bellows' ? '2 2' : undefined} />
        </g>
      );
      break;
    }
    case 'elbow': {
      if (def.h === 2) {
        body = (
          <g>
            <path d={`M0 ${h * 0.75} H ${w * 0.55} a8 8 0 0 0 8 -8 V 0`} fill="none" stroke={fill(inst.id, 0)} strokeWidth={12} />
            <path d={`M0 ${h * 0.75} H ${w * 0.55} a8 8 0 0 0 8 -8 V 0`} fill="none" {...sel} strokeWidth={sel.strokeWidth} opacity={0.9} />
          </g>
        );
      } else {
        body = (
          <g>
            <path d={`M0 ${h / 2} L ${w} ${h / 2}`} stroke={fill(inst.id, 0)} strokeWidth={12} />
            <path d={`M0 ${h / 2} L ${w} ${h / 2}`} {...sel} fill="none" />
          </g>
        );
      }
      break;
    }
    case 'tee':
    case 'cross': {
      body = (
        <g>
          <path d={`M0 ${h * 0.375} H${w} M${w / 2} ${h * 0.375} V${h}`} stroke={fill(inst.id, 0)} strokeWidth={12} fill="none" />
          {def.ports.length >= 4 && <path d={`M${w / 2} 0 V${h * 0.375}`} stroke={fill(inst.id, 0)} strokeWidth={12} />}
          <path d={`M0 ${h * 0.375} H${w}`} {...sel} fill="none" />
        </g>
      );
      break;
    }
    case 'adapter':
      body = (
        <g>
          <path d={`M0 ${h / 2 - 8} L${w} ${h / 2 - 4} L${w} ${h / 2 + 4} L0 ${h / 2 + 8} Z`}
            fill={fill(inst.id, 0)} {...sel} />
        </g>
      );
      break;
    case 'valve':
    case 'valve-butterfly':
    case 'valve-metering': {
      const open = def.kind === 'valve-butterfly' ? Number(inst.params.open ?? 0) > 2 : Boolean(inst.params.open);
      const cx = w / 2;
      const cy = def.h === 2 ? h * 0.75 : h / 2;
      body = (
        <g>
          <path d={`M${cx - 14} ${cy - 9} L${cx} ${cy} L${cx - 14} ${cy + 9} Z`} fill={fill(inst.id, 0)} {...sel} />
          <path d={`M${cx + 14} ${cy - 9} L${cx} ${cy} L${cx + 14} ${cy + 9} Z`} fill={fill(inst.id, 1)} {...sel} />
          {!open && <line x1={cx} y1={cy - 12} x2={cx} y2={cy + 12} stroke="#ff7070" strokeWidth={3} />}
          {def.kind === 'valve-butterfly' && (
            <text x={cx} y={cy - 14} textAnchor="middle" className="tiny">{Number(inst.params.open ?? 0)}%</text>
          )}
        </g>
      );
      break;
    }
    case 'valve-vent':
    case 'valve-gas': {
      const open = Boolean(inst.params.open);
      body = (
        <g>
          <circle cx={w / 2} cy={h / 2} r={9} fill={fill(inst.id, 0)} {...sel} />
          <text x={w / 2} y={h / 2 + 3.5} textAnchor="middle" className="tiny">
            {def.kind === 'valve-vent' ? 'V' : String(inst.params.gas ?? 'N2')}
          </text>
          {!open && <line x1={w / 2 - 11} y1={h / 2 + 11} x2={w / 2 + 11} y2={h / 2 - 11} stroke="#ff7070" strokeWidth={2.5} />}
        </g>
      );
      break;
    }
    case 'pump': {
      const on = Boolean(inst.params.on);
      body = (
        <g>
          <circle cx={w / 2} cy={h / 2} r={w / 2 - 5} fill={fill(inst.id, 0)} {...sel} />
          <path d={`M${w / 2 - 13} ${h / 2 + 12} L${w / 2} ${h / 2 - 15} L${w / 2 + 13} ${h / 2 + 12} Z`}
            fill={on ? '#e8f0ff' : '#666c78'} stroke="none" opacity={0.9} />
        </g>
      );
      break;
    }
    case 'gauge': {
      body = (
        <g>
          <circle cx={w / 2} cy={h / 2 - 3} r={10} fill={fill(inst.id, 0)} {...sel} />
          <text x={w / 2} y={h / 2} textAnchor="middle" className="tiny">
            {String(def.data.gaugeType).slice(0, 2).toUpperCase()}
          </text>
        </g>
      );
      break;
    }
    case 'leak':
      body = (
        <g>
          <circle cx={w / 2} cy={h / 2} r={8} fill={fill(inst.id, 0)} {...sel} />
          <path d={`M${w / 2 - 4} ${h / 2 - 12} l3 -5 l3 5 M${w / 2 + 2} ${h / 2 - 12} l3 -5`} stroke="#ffb14e" strokeWidth={1.6} fill="none" />
        </g>
      );
      break;
    case 'vleak':
      body = (
        <g>
          <rect x={w / 2 - 9} y={h / 2 - 9} width={18} height={18} rx={4} fill={fill(inst.id, 0)} {...sel} strokeDasharray="3 2" />
          <circle cx={w / 2} cy={h / 2} r={3} fill="#ffb14e" />
        </g>
      );
      break;
    case 'leakdetector':
      body = (
        <g>
          <rect x={4} y={6} width={w - 8} height={h - 12} rx={8} fill={fill(inst.id, 0)} {...sel} />
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" className="tiny">He LD</text>
        </g>
      );
      break;
    case 'payload':
      body = (
        <g>
          <rect x={w / 2 - 10} y={h / 2 - 10} width={20} height={20} rx={3} fill={fill(inst.id, 0)} {...sel} />
          <path d={`M${w / 2 - 8} ${h / 2 + 8} l16 -16 M${w / 2 - 8} ${h / 2} l8 -8 M${w / 2} ${h / 2 + 8} l8 -8`}
            stroke="#9aa2b1" strokeWidth={1.2} />
        </g>
      );
      break;
    case 'coldtrap-meissner': {
      const on = Boolean(inst.params.on);
      body = (
        <g>
          <rect x={4} y={h / 2 - 9} width={w - 8} height={18} rx={9} fill={fill(inst.id, 0)} {...sel} />
          <path d={`M10 ${h / 2} q6 -7 12 0 t12 0 t12 0`} fill="none"
            stroke={on ? '#9fd7ff' : '#666c78'} strokeWidth={2.2} />
        </g>
      );
      break;
    }
    case 'coldtrap-inline': {
      const on = Boolean(inst.params.on);
      body = (
        <g>
          <path d={`M0 ${h * 0.75} H ${w * 0.5} a10 10 0 0 0 10 -10 V 0`} fill="none" stroke={fill(inst.id, 1)} strokeWidth={14} />
          <path d={`M0 ${h * 0.75} H ${w * 0.5} a10 10 0 0 0 10 -10 V 0`} fill="none" {...sel} opacity={0.9} />
          <text x={w * 0.5} y={h * 0.75 + 5} textAnchor="middle" className="tiny"
            fill={on ? '#9fd7ff' : '#666c78'}>❄</text>
        </g>
      );
      break;
    }
    default:
      // blank, viewport, feedthrough
      body = (
        <g>
          <rect x={w / 2 - 8} y={h / 2 - 10} width={10} height={20} rx={2} fill={fill(inst.id, 0)} {...sel} />
          {def.kind === 'viewport' && <circle cx={w / 2 - 3} cy={h / 2} r={4} fill="none" stroke="#9fd7ff" strokeWidth={1.4} />}
          {def.kind === 'feedthrough' && <path d={`M${w / 2 + 2} ${h / 2 - 6} h8 M${w / 2 + 2} ${h / 2} h8 M${w / 2 + 2} ${h / 2 + 6} h8`} stroke="#e0c46c" strokeWidth={1.4} />}
        </g>
      );
  }

  // counter-rotate text so labels stay upright regardless of part rotation
  const unrot = `rotate(${-inst.rot} ${w / 2} ${-10})`;
  const unrotLen = `rotate(${-inst.rot} ${w / 2} ${h / 2 + 16})`;
  return (
    <g>
      {body}
      <text x={w / 2} y={-4} textAnchor="middle" className="plabel" transform={unrot}>{label}</text>
      {(def.kind === 'tube' || def.kind === 'flex' || def.kind === 'bellows') && (
        <text x={w / 2} y={h / 2 + 20} textAnchor="middle" className="tiny" transform={unrotLen}>
          {Number(inst.params.length ?? 100)} mm
        </text>
      )}
    </g>
  );
});
