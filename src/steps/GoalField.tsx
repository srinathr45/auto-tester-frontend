interface GoalFieldProps {
  value: string;
  placeholder?: string;
  onChange: (goal: string) => void;
}

export default function GoalField({ value, placeholder, onChange }: GoalFieldProps) {
  return (
    <div>
      <label className="field-label">Goal</label>
      <textarea
        className="textarea"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'What this step should do'}
        style={{ minHeight: 64, fontFamily: 'var(--font-main)', fontSize: '0.78rem' }}
      />
    </div>
  );
}
