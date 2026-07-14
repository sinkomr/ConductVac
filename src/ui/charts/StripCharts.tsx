import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import { chartHistory, useStore } from '../../store';

/**
 * Strip charts (§3.3): every placed gauge auto-added; log-p vs t or log-t;
 * dashed truth overlay; CSV and PNG export. Built on uPlot.
 */

const COLORS = ['#6ab0ff', '#ffb14e', '#7bd88f', '#ff7070', '#caa9ff', '#5fd4d0', '#e6da74', '#f097c8'];

export function StripCharts() {
  const chartTick = useStore((s) => s.chartTick);
  const truthOverlay = useStore((s) => s.truthOverlay);
  const logTime = useStore((s) => s.logTime);
  const st = useStore.getState;
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  const gaugeIds = chartHistory.gaugeIds;

  const opts = useMemo<uPlot.Options>(() => {
    const series: uPlot.Series[] = [{ label: 't [s]' }];
    gaugeIds.forEach((id, i) => {
      series.push({
        label: chartHistory.labels[i] ?? id,
        stroke: COLORS[i % COLORS.length],
        width: 1.6,
        spanGaps: false,
        value: (_u, v) => (v == null ? '—' : v.toExponential(2)),
      });
    });
    if (truthOverlay) {
      gaugeIds.forEach((id, i) => {
        series.push({
          label: `${id} (true p)`,
          stroke: COLORS[i % COLORS.length],
          width: 1,
          dash: [5, 5],
          spanGaps: false,
          value: (_u, v) => (v == null ? '—' : v.toExponential(2)),
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
    };
  }, [gaugeIds.join(','), truthOverlay, logTime]);

  // (re)create plot when structure changes; leave room for the legend row
  useEffect(() => {
    if (!hostRef.current) return;
    plotRef.current?.destroy();
    const el = hostRef.current;
    const chartH = () => Math.max(140, el.clientHeight - 34);
    const plot = new uPlot({ ...opts, width: el.clientWidth - 8, height: chartH() }, [[], ...opts.series.slice(1).map(() => [])], el);
    plotRef.current = plot;
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth - 8, height: chartH() }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [opts]);

  // feed data
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
    const data: uPlot.AlignedData = [
      t,
      ...vals,
      ...(truthOverlay ? trs : []),
    ] as uPlot.AlignedData;
    plot.setData(data);
  }, [chartTick, truthOverlay, logTime]);

  const exportCsv = () => {
    const rows = [['t_s', ...gaugeIds.map((g) => `${g}_reading_Torr`), ...gaugeIds.map((g) => `${g}_true_Torr`)]];
    for (let i = 0; i < chartHistory.t.length; i++) {
      rows.push([
        chartHistory.t[i].toPrecision(8),
        ...chartHistory.values.map((v) => String(v[i])),
        ...chartHistory.truths.map((v) => String(v[i])),
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
        <label><input type="checkbox" checked={truthOverlay} onChange={(e) => st().setTruthOverlay(e.target.checked)} /> show true pressure</label>
        <label><input type="checkbox" checked={logTime} onChange={(e) => st().setLogTime(e.target.checked)} /> log time</label>
        <button className="btn" onClick={exportCsv}>CSV</button>
        <button className="btn" onClick={exportPng}>PNG</button>
      </div>
      <div ref={hostRef} className="chart-host" />
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
