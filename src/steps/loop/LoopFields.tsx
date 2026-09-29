import type { LoopFieldsProps } from '../types';

export default function LoopFields({
  data,
  onChange,
  repeatFromOptions = [],
  repeatFromId = null,
  onRepeatFromChange,
}: LoopFieldsProps) {
  const loop = data.loop || { count: 3 };

  return (
    <>
      <div>
        <label className="field-label">Loop times</label>
        <input
          className="input"
          type="number"
          min={1}
          value={loop.count ?? 3}
          onChange={(e) => onChange({ loop: { count: Number(e.target.value) || 3 } })}
        />
      </div>
      <div>
        <label className="field-label">Repeat from</label>
        <select
          className="select"
          value={repeatFromId || ''}
          onChange={(e) => {
            const value = e.target.value;
            onRepeatFromChange?.(value ? value : null);
          }}
        >
          <option value="">Select first step of body…</option>
          {repeatFromOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <p style={{ fontSize: '0.68rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
        Steps from <strong>Repeat from</strong> into this Loop run N times, then continue via Next.
        You can also drag the amber Repeat handle on the canvas.
      </p>
      <p
        style={{
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          margin: 0,
          lineHeight: 1.45,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-color)',
          background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        }}
      >
        <strong>Navigate back:</strong> paste Playwright JS or use Capture in the script panel.
        That script runs before each repeat (not the first pass) so the body starts on the same
        page or tab.
      </p>
    </>
  );
}
