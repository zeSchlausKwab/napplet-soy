import { Pause, Play } from 'lucide-react';

/** Decorative loading companion. The containing state owns the status text. */
export function SoybertWalk() {
  return (
    <label className="soybert-walk" title="Pause / resume Soybert">
      <input
        type="checkbox"
        className="soybert-walk-toggle"
        aria-label="Pause Soybert loading animation"
      />
      <span className="soybert-walk-frames" aria-hidden="true" />
      <span className="soybert-walk-hint" aria-hidden="true">
        <Pause className="soybert-walk-pause" size={12} />
        <Play className="soybert-walk-play" size={12} />
      </span>
    </label>
  );
}
