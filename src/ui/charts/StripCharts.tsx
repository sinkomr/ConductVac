import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import { downloadBlob } from '../download';
import { UNIT_FACTOR, chartHistory, getPinnedRun, useStore } from '../../store';
import { mergeAligned } from './ghost';

/**
 * Strip charts (§3.3): every placed gauge auto-added; log-p vs t or log-t;
 * dashed truth overlay; CSV and PNG export; pin-a-run ghost comparison.
 * Built on uPlot.
 */

const COLORS = ['#6ab0ff', '#ffb14e', '#7bd88f', '#ff7070', '#caa9ff', '#5fd4d0', '#e6da74', '#f097c8'];

/** faded stroke for ghost series (same hue as the live trace) */
const fade = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.45)`;
};

export function StripCharts() {
  const chartTick = useStore((s) => s.chartTick);
  const truthOverlay = useStore((s) => s.truthOverlay);
  const logTime = useStore((s) => s.logTime);
  const unit = useStore((s) => s.unit);
  const pinTick = useStore((s) => s.pinTick);
  const st = useStore.getState;
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // true while the user has drag-zoomed: new data must then leave the scales alone
  const zoomedRef = useRef(false);

  const gaugeIds = chartHistory.gaugeIds;
  const pin = getPinnedRun();

  const opts = useMemo<uPlot.Options>(() => {
    // while a ghost is merged in, every series carries nulls at the OTHER
    // run's timestamps — spanGaps bridges them
    const gaps = !!pin;
    const series: uPlot.Series[] = [{ label: 't [s]' }];
    gaugeIds.forEach((id, i) => {
      series.push({
        label: chartHistory.labels[i] ?? id,
        stroke: COLORS[i % COLORS.length],
        width: 1.6,
        spanGaps: gaps,
        value: (_u, v) => (v == null ? '—' : `${v.toExponential(2)} ${unit}`),
      });
    });
    if (truthOverlay) {
      gaugeIds.forEach((id, i) => {
        series.push({
          label: `${id} (true p)`,
          stroke: COLORS[i % COLORS.length],
          width: 1,
          dash: [5, 5],
          spanGaps: gaps,
          value: (_u, v) => (v == null ? '—' : `${v.toExponential(2)} ${unit}`),
        });
      });
    }
    if (pin) {
      pin.history.gaugeIds.forEach((id, i) => {
        series.push({
          label: `${id} (pinned)`,
          stroke: fade(COLORS[i % COLORS.length]),
          width: 1,
          dash: [2, 3],
          spanGaps: true,
          value: (_u, v) => (v == null ? '—' : `${v.toExponential(2)} ${unit}`),
        });
      });
    }
    return {
      width: 800,
      height: 200,
      series,
      scales: {
        x: { time: false, distr: logTime ? 3 : 1, log: 10 },
        y: { distr: 3, log: 10 },
      },
      axes: [
        { stroke: '#9aa2b1', grid: { stroke: '#2c3038' }, ticks: { stroke: '#2c3038' } },
        {
          stroke: '#9aa2b1',
          grid: { stroke: '#2c3038' },
          ticks: { stroke: '#2c3038' },
          size: 64,
          values: (_u, vals) => vals.map((v) => (v > 0 ? v.toExponential(0) : '')),
        },
      ],
      legend: { live: true },
      cursor: { drag: { x: true, y: false } },
      hooks: {
        // a drag-zoom ends with a non-empty selection; uPlot's own
        // double-click handler restores the full range
        setSelect: [(u) => { if (u.select.width > 0) zoomedRef.current = true; }],
        ready: [(u) => u.over.addEventListener('dblclick', () => { zoomedRef.current = false; })],
      },
    };
  }, [gaugeIds.join(','), truthOverlay, logTime, unit, pinTick]);

  // (re)create plot when structure changes. The legend floats inside the
  // plot area (theme.css), so the canvas takes the host's full height.
  useEffect(() => {
    if (!hostRef.current) return;
    plotRef.current?.destroy();
    const el = hostRef.current;
    const chartH = () => Math.max(120, el.clientHeight - 2);
    const plot = new uPlot({ ...opts, width: el.clientWidth - 8, height: chartH() }, [[], ...opts.series.slice(1).map(() => [])], el);
    plotRef.current = plot;
    zoomedRef.current = false;
    // handle for the browser smoke test (and for poking at the chart in devtools)
    (el as HTMLDivElement & { uplot?: uPlot }).uplot = plot;
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth - 8, height: chartH() }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [opts]);

  // feed data (history stays in Torr; converted to the selected unit here;
  // a pinned ghost run is union-merged onto the same x axis)
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let t = chartHistory.t;
    let vals = chartHistory.values;
    let trs = chartHistory.truths;
    if (logTime) {
      // log x needs strictly positive t
      const startIdx = t.findIndex((x) => x > 0);
      if (startIdx > 0) {
        t = t.slice(startIdx);
        vals = vals.map((a) => a.slice(startIdx));
        trs = trs.map((a) => a.slice(startIdx));
      }
    }
    const f = UNIT_FACTOR[unit];
    // a gauge with no output is NaN live and null in a pinned (JSON-copied)
    // run: both become gaps — never NaN in the legend, never null·f = 0 on a
    // log axis
    const scaled = (a: (number | null)[]): (number | null)[] =>
      a.map((v) => (v !== null && Number.isFinite(v) ? v * f : null));
    const liveVals = vals.map(scaled);
    const liveTrs = trs.map(scaled);
    let data: uPlot.AlignedData;
    if (pin) {
      let gt = pin.history.t;
      let gv = pin.history.values;
      if (logTime) {
        const gi = gt.findIndex((x) => x > 0);
        if (gi > 0) {
          gt = gt.slice(gi);
          gv = gv.map((a) => a.slice(gi));
        }
      }
      const merged = mergeAligned(t, [...liveVals, ...(truthOverlay ? liveTrs : [])], gt, gv.map(scaled));
      data = [merged.t, ...merged.live, ...merged.ghost] as uPlot.AlignedData;
    } else {
      data = [t, ...liveVals, ...(truthOverlay ? liveTrs : [])] as uPlot.AlignedData;
    }
    // resetScales = false keeps a drag-zoom in place while samples stream in
    plot.setData(data, !zoomedRef.current);
    if (zoomedRef.current) plot.redraw();
  }, [chartTick, truthOverlay, logTime, unit, pinTick]);

  const exportCsv = () => {
    const f = UNIT_FACTOR[unit];
    const rows = [['t_s', ...gaugeIds.map((g) => `${g}_reading_${unit}`), ...gaugeIds.map((g) => `${g}_true_${unit}`)]];
    for (let i = 0; i < chartHistory.t.length; i++) {
      rows.push([
        chartHistory.t[i].toPrecision(8),
        ...chartHistory.values.map((v) => String(v[i] * f)),
        ...chartHistory.truths.map((v) => String(v[i] * f)),
      ]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    downloadBlob(blob, 'conductvac-gauges.csv');
  };

  const exportPng = () => {
    const canvas = hostRef.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob((b) => b && downloadBlob(b, 'conductvac-chart.png'));
  };

  if (gaugeIds.length === 0) {
    return <div className="hint pad">Place gauges on the system to see strip charts. Press Run to start recording.</div>;
  }

  return (
    <div className="charts">
      <div className="chart-toolbar">
        <label><input type="checkbox" checked={truthOverlay} onChange={(e) => st().setTruthOverlay(e.target.checked)} /> true pressure</label>
        <label><input type="checkbox" checked={logTime} onChange={(e) => st().setLogTime(e.target.checked)} /> log time</label>
        {pin ? (
          <button className="btn" onClick={() => st().clearPin()} title={`remove the comparison ghost (${pin.label})`}>
            ✕ Unpin run
          </button>
        ) : (
          <button
            className="btn" title="freeze this run as a dashed ghost, then change something and re-run"
            onClick={() => st().pinRun()}
            disabled={chartHistory.t.length === 0}
          >
            📌 Pin run
          </button>
        )}
        <div className="chart-export">
          <button className="btn" onClick={exportCsv} title="download the gauge traces as CSV">CSV</button>
          <button className="btn" onClick={exportPng} title="download the chart as an image">PNG</button>
        </div>
        <span className="hint chart-unit">pressure in {unit}</span>
      </div>
      <div ref={hostRef} className="chart-host" />
    </div>
  );
}
