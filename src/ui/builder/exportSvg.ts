import type { SystemDefinition } from '../../types';
import { PART_BY_ID } from '../../data/fittings';
import { CELL } from './geometry';

/**
 * Standalone schematic export. The live canvas SVG is CSS-sized, pan/zoomed
 * and styled by app-level classes; the export clones it, swaps the view
 * transform for a content-bounds fit, strips editor chrome (grid, ghosts),
 * and embeds the handful of theme rules that apply inside the SVG so the
 * file renders identically outside the app.
 */

/** the live canvas element, registered by Canvas on mount */
export const canvasSvg: { el: SVGSVGElement | null } = { el: null };

const BG = '#16181d';
const PAD = 20;

// the only theme.css rules that style SVG content (keep in sync with theme.css)
const EXPORT_CSS = `
  svg { font: 13px/1.45 system-ui, 'Segoe UI', Roboto, sans-serif; }
  .plabel { fill: #9aa2b1; font-size: 10px; }
  .tiny { fill: #e8ecf3; font-size: 9px; }
  .pvalue { fill: #9fd7ff; font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .port { fill: #14161b; stroke: #8f97a8; stroke-width: 1.6; }
  .port.used { fill: #8f97a8; }
`;

function contentBounds(system: SystemDefinition): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of system.parts) {
    const def = PART_BY_ID[p.def];
    if (!def) continue;
    minX = Math.min(minX, p.x - 0.5);
    minY = Math.min(minY, p.y - 1);
    maxX = Math.max(maxX, p.x + def.w + 0.5);
    maxY = Math.max(maxY, p.y + def.h + 1);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX * CELL, y: minY * CELL, w: (maxX - minX) * CELL, h: (maxY - minY) * CELL };
}

export function exportSchematicSvg(system: SystemDefinition): Blob | null {
  const src = canvasSvg.el;
  const bounds = contentBounds(system);
  if (!src || !bounds) return null;

  const svg = src.cloneNode(true) as SVGSVGElement;
  const W = bounds.w + 2 * PAD;
  const H = bounds.h + 2 * PAD;
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.removeAttribute('class');
  svg.removeAttribute('style');

  // strip editor chrome: grid pattern + its rect, rubber band / ghost /
  // marquee (present only mid-gesture, but be defensive)
  svg.querySelector('defs')?.remove();
  for (const el of [...svg.querySelectorAll('[fill^="url(#"], .marquee')]) el.remove();

  // replace pan/zoom with a content fit
  const g = svg.querySelector('g');
  if (!g) return null;
  g.setAttribute('transform', `translate(${PAD - bounds.x} ${PAD - bounds.y})`);

  // background + embedded styles
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = EXPORT_CSS;
  svg.insertBefore(style, svg.firstChild);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', String(W));
  bg.setAttribute('height', String(H));
  bg.setAttribute('fill', BG);
  svg.insertBefore(bg, style.nextSibling);

  return new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
}

export function exportSchematicPng(system: SystemDefinition): Promise<Blob | null> {
  const blob = exportSchematicSvg(system);
  const bounds = contentBounds(system);
  if (!blob || !bounds) return Promise.resolve(null);
  const W = Math.round(bounds.w + 2 * PAD);
  const H = Math.round(bounds.h + 2 * PAD);
  return blob.text().then((svgText) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W * 2; // 2× for crisp text
      canvas.height = H * 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b));
    };
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  }));
}
