import { useEffect, useRef, useState } from 'react';
import { Check, Crosshair, Search, Sparkles, WandSparkles, X } from 'lucide-react';
import { aiFillService, compileConditionalFillScript, compileLocalFillScript } from './services/ai-fill.service';
import { recordingService } from '../../recording/services/recording.service';
import GoalField from '../GoalField';
import type { KindFieldsProps } from '../types';
import type { AiFillField } from '../../shared/types';

function fieldKey(field: AiFillField): string {
  const locator = field.locatorCandidates[0];
  return locator ? `${locator}|${field.kind}|${field.label}` : field.fieldId;
}

export default function AiFillFields({ data, onChange, aiFillContext }: KindFieldsProps) {
  const context = aiFillContext;
  const [fields, setFields] = useState<AiFillField[]>(data.aiFillFields || []);
  const [availableFields, setAvailableFields] = useState<AiFillField[]>(
    data.aiFillFields || [],
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'confirm' | 'picking'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    try {
      const off = recordingService.onFieldPicker((payload) => {
        if (!payload || payload.sessionId !== sessionRef.current) return;
        setFields((previous) => {
          const merged = new Map(previous.map((field) => [fieldKey(field), field]));
          payload.fields.forEach((field) => {
            const key = fieldKey(field);
            if (!merged.has(key)) merged.set(key, field);
          });
          const next = [...merged.values()];
          setAvailableFields((available) => {
            const all = new Map(available.map((field) => [fieldKey(field), field]));
            payload.fields.forEach((field) => {
              const key = fieldKey(field);
              if (!all.has(key)) all.set(key, field);
            });
            return [...all.values()];
          });
          setMessage(`Found ${next.length} field${next.length === 1 ? '' : 's'}. Are these all the fields?`);
          void recordingService.highlightFields(payload.sessionId, next);
          return next;
        });
        setState('confirm');
      });
      return off;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (sessionId) void recordingService.stop(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  const captureFields = async () => {
    if (!context?.project) {
      setError('Select a project before capturing fields.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    context.onEnsurePreview?.();
    try {
      const result = await recordingService.captureFields({
        untilNodeId: context.selectedNodeId,
        url: context.project.url,
        projectUrl: context.project.url,
        nodes: context.nodes,
        edges: context.edges,
      });
      if (!result) throw new Error('Desktop runtime unavailable.');
      setSessionId(result.sessionId);
      sessionRef.current = result.sessionId;
      setAvailableFields(result.fields);
      const captured = result.formFound ? result.fields : [];
      setFields(captured);
      if (captured.length) {
        setState('confirm');
        setMessage(`Found ${captured.length} form field${captured.length === 1 ? '' : 's'}. Are these all the fields?`);
        await recordingService.highlightFields(result.sessionId, captured);
      } else {
        setState('picking');
        setMessage('Sorry, I could not find a form. Click a field in Preview to find similar fields.');
        await recordingService.startFieldPicker(result.sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture fields');
    } finally {
      setBusy(false);
    }
  };

  const pickAnother = async () => {
    if (!sessionId) {
      setError('Capture the page before picking a field.');
      return;
    }
    setError(null);
    setMessage('Click another field in Preview. Similar fields will be highlighted.');
    setState('picking');
    await recordingService.startFieldPicker(sessionId);
  };

  const removeField = async (key: string) => {
    const next = fields.filter((field) => fieldKey(field) !== key);
    setFields(next);
    setMessage(
      next.length
        ? `Removed the field. ${next.length} field${next.length === 1 ? '' : 's'} remain selected.`
        : 'No fields selected. Pick the fields you want to fill.',
    );
    if (sessionId) {
      if (next.length) {
        await recordingService.highlightFields(sessionId, next);
      } else {
        await recordingService.stopFieldPicker(sessionId);
      }
    }
    if (!next.length) setState('picking');
  };

  const findMoreWithAi = async () => {
    if (!data.goal?.trim()) {
      setError('Write a goal before asking AI to find more fields.');
      return;
    }
    if (!fields.length) {
      setError('Capture or pick at least one field first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await aiFillService.suggestFields(
        data.goal,
        availableFields,
        fields.map((field) => field.fieldId),
      );
      const suggested = aiFillService.mergeSuggestions(availableFields, result.fields);
      if (!suggested.length) {
        setMessage('AI did not identify additional fields from the captured controls.');
        return;
      }
      const merged = [...new Map(
        [...fields, ...suggested].map((field) => [field.fieldId, field]),
      ).values()];
      setFields(merged);
      if (sessionId) await recordingService.highlightFields(sessionId, merged);
      setMessage(`AI identified ${suggested.length} matching field${suggested.length === 1 ? '' : 's'}. Confirm the highlighted set.`);
      setState('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI field discovery failed');
    } finally {
      setBusy(false);
    }
  };

  const generateLocal = () => {
    try {
      const scriptText = compileLocalFillScript(fields);
      onChange({
        scriptText,
        aiFillMode: 'local',
        aiFillFields: fields,
        aiFillSelectedFieldIds: fields.map((field) => field.fieldId),
      });
      setMessage('Saved a local fill script. AI will not be used when this step runs.');
      setSessionId(null);
      sessionRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate local fill script');
    }
  };

  const generateConditional = async () => {
    if (!data.goal?.trim()) {
      setError('Write a goal before generating conditional logic.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await aiFillService.generateConditionalFill(
        data.goal,
        fields,
        fields.map((field) => field.fieldId),
      );
      const scriptText = compileConditionalFillScript(fields, result.actions);
      onChange({
        scriptText,
        aiFillMode: 'conditionalAi',
        aiFillFields: fields,
        aiFillSelectedFieldIds: fields.map((field) => field.fieldId),
        aiFillActions: result.actions,
      });
      setMessage('Saved the conditional fill script. AI will not be used when this step runs.');
      setSessionId(null);
      sessionRef.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conditional script generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GoalField
        value={data.goal || ''}
        placeholder="e.g. Fill the sign-up form with valid test data"
        onChange={(goal) => onChange({ goal, scriptText: '' })}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" className="btn-secondary" onClick={() => void captureFields()} disabled={busy}>
          <Crosshair size={12} />
          {busy ? 'Preparing…' : 'Capture form fields'}
        </button>
        {state === 'picking' && (
          <div style={{ fontSize: '0.7rem', color: 'var(--warn-text)', lineHeight: 1.4 }}>
            {message || 'Pick a field in Preview.'}
          </div>
        )}
        {state === 'confirm' && (
          <>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {message || `Selected ${fields.length} field${fields.length === 1 ? '' : 's'}.`}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-secondary" onClick={() => void pickAnother()} disabled={busy}>
                <Search size={12} /> Add field
              </button>
              <button type="button" className="btn-secondary" onClick={() => void findMoreWithAi()} disabled={busy || !fields.length}>
                <Sparkles size={12} /> Find more with AI
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-primary" onClick={generateLocal} disabled={busy || !fields.length}>
                <Check size={12} /> Generate local fill
              </button>
              <button type="button" className="btn-secondary" onClick={() => void generateConditional()} disabled={busy || !fields.length}>
                <WandSparkles size={12} /> Generate AI logic
              </button>
            </div>
          </>
        )}
        {error && <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)' }}>{error}</div>}
        {fields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fields.map((field) => (
              <div
                key={fieldKey(field)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  padding: '3px 6px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 5,
                  fontSize: '0.65rem',
                  color: 'var(--text-dim)',
                }}
              >
                <span>{field.label}</span>
                <button
                  type="button"
                  className="btn-icon"
                  style={{ width: 20, height: 20, border: 'none' }}
                  onClick={() => void removeField(fieldKey(field))}
                  aria-label={`Remove ${field.label}`}
                  title={`Remove ${field.label}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {state === 'idle' && (
          <p style={{ fontSize: '0.68rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.45 }}>
            Capture fields first. Simple values are generated locally; AI is used only for discovery or conditional logic.
          </p>
        )}
      </div>
    </>
  );
}
