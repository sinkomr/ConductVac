import { colorbarGradient, COLORBAR_TICKS, LOG_P_MAX, LOG_P_MIN } from './colormap';
import { useStore } from '../../store';

export function Colorbar() {
  const unit = useStore((s) => s.unit);
  void unit;
  return (
    <div className="colorbar">
      <div className="colorbar-title">log₁₀ p [Torr]</div>
      <div className="colorbar-strip" style={{ background: colorbarGradient() }} />
      <div className="colorbar-ticks">
        {COLORBAR_TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - LOG_P_MIN) / (LOG_P_MAX - LOG_P_MIN)) * 100}%` }}>
            {t === LOG_P_MAX ? '760' : `1e${t}`}
          </span>
        ))}
      </div>
    </div>
  );
}
