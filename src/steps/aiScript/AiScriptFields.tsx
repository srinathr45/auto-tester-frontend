import { Code2 } from 'lucide-react';
import GoalField from '../GoalField';
import type { KindFieldsProps } from '../types';

interface AiScriptFieldsProps extends KindFieldsProps {
  capturingHtml?: boolean;
  htmlCaptureError?: string | null;
  onCaptureHtml?: () => void;
}

export default function AiScriptFields({
  data,
  onChange,
  capturingHtml = false,
  htmlCaptureError,
  onCaptureHtml,
}: AiScriptFieldsProps) {
  const catalogCount = Array.isArray(data.htmlCatalog) ? data.htmlCatalog.length : 0;
  const hasCatalog = catalogCount > 0;
  const sliceKb = String(data.htmlElements || '').trim().length / 1024;

  return (
    <>
      <div>
        <button
          type="button"
          className="btn-secondary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={capturingHtml || !onCaptureHtml}
          onClick={onCaptureHtml}
        >
          <Code2 size={12} />
          {capturingHtml
            ? 'Running prior steps…'
            : hasCatalog
              ? 'Recapture page'
              : 'Capture page'}
        </button>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 6 }}>
          {capturingHtml
            ? 'Runs previous steps, then indexes clickable and fillable controls.'
            : hasCatalog
              ? `Page indexed (${catalogCount} control${catalogCount === 1 ? '' : 's'}${
                  sliceKb > 0 ? `, last slice ${sliceKb < 10 ? sliceKb.toFixed(1) : Math.round(sliceKb)} KB` : ''
                }). Write a goal from Preview, then generate.`
              : 'Runs previous steps and shows Preview. Generate sends only the matching section.'}
        </div>
        {htmlCaptureError && (
          <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)', marginTop: 6 }}>
            {htmlCaptureError}
          </div>
        )}
      </div>
      <GoalField
        value={data.goal || ''}
        placeholder="What this step should do on the captured page"
        onChange={(goal) => onChange({ goal })}
      />
    </>
  );
}
