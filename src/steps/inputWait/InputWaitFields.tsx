import GoalField from '../GoalField';
import type { KindFieldsProps } from '../types';

export default function InputWaitFields({ data, onChange }: KindFieldsProps) {
  const wait = data.wait || { timeoutMs: 120000 };

  return (
    <>
      <GoalField
        value={data.goal || ''}
        placeholder="e.g. Wait until the OTP input is visible"
        onChange={(goal) => onChange({ goal })}
      />
      <p style={{ fontSize: '0.68rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
        The Description above is shown when the run pauses so the operator can type OTP, captcha, or other input.
      </p>
      <div>
        <label className="field-label">Timeout (ms)</label>
        <input
          className="input"
          type="number"
          min={1000}
          value={wait.timeoutMs ?? 120000}
          onChange={(e) =>
            onChange({ wait: { ...wait, timeoutMs: Number(e.target.value) || 120000 } })
          }
        />
      </div>
    </>
  );
}
