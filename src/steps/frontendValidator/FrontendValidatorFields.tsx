import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crosshair, Sparkles, X } from 'lucide-react';
import { recordingService } from '../../recording/services/recording.service';
import { orderFlowNodes } from '../../shared/orderNodes';
import { resolveStepKind } from '../../shared/stepKinds';
import type {
  AiFillField,
  FrontendValidatorConfig,
  FrontendValidatorField,
  FlowEdge,
  FlowNode,
} from '../../shared/types';
import {
  frontendValidatorService,
  refreshValidatorScripts,
} from './services/frontend-validator.service';
import type { KindFieldsProps } from '../types';

function fieldKey(field: AiFillField): string {
  return field.fieldId;
}

function configFor(data: KindFieldsProps['data']): FrontendValidatorConfig {
  return data.frontendValidator || { mode: 'autoFill', fields: [] };
}

function mergeField(
  fields: FrontendValidatorField[],
  field: AiFillField,
): FrontendValidatorField[] {
  if (fields.some((item) => fieldKey(item.field) === fieldKey(field))) return fields;
  return [...fields, { field, rule: '', scriptMode: 'ai' }];
}

function withoutField(
  fields: FrontendValidatorField[],
  fieldId: string,
): FrontendValidatorField[] {
  return fields.filter((item) => fieldKey(item.field) !== fieldId);
}

function earlierAutoFillNodes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  selectedNodeId: string,
): FlowNode[] {
  const ordered = orderFlowNodes(nodes, edges);
  const selectedIndex = ordered.findIndex((node) => node.id === selectedNodeId);
  return ordered.filter(
    (node, index) =>
      resolveStepKind(node.data) === 'aiFill' &&
      (selectedIndex < 0 || index < selectedIndex),
  );
}

export default function FrontendValidatorFields({
  data,
  onChange,
  fieldCaptureContext,
}: KindFieldsProps) {
  const context = fieldCaptureContext;
  const config = configFor(data);
  const mode = config.mode || 'autoFill';
  const selectedFields = config.fields || [];
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [capturedFields, setCapturedFields] = useState<AiFillField[]>(
    () => (mode === 'captured' ? selectedFields.map((item) => item.field) : []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  const sourceNodes = useMemo(
    () =>
      context
        ? earlierAutoFillNodes(context.nodes, context.edges, context.selectedNodeId)
        : [],
    [context],
  );
  const sourceNode = sourceNodes.find((node) => node.id === config.sourceAiFillNodeId);
  const sourceFields = sourceNode?.data.aiFillFields || [];

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    try {
      const offTrigger = recordingService.onTriggerPicker((payload) => {
        if (!payload || payload.sessionId !== sessionRef.current) return;
        const current = configFor(dataRef.current);
        const nextConfig = {
          ...current,
          triggerButton: payload.trigger,
        };
        const refreshed = refreshValidatorScripts(nextConfig);
        onChangeRef.current({
          frontendValidator: refreshed.config,
          scriptText: refreshed.scriptText,
        });
        setTriggerMessage(`Captured trigger: ${payload.trigger.label}`);
        void recordingService.stopTriggerPicker(payload.sessionId);
      });
      return offTrigger;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (sessionId) void recordingService.stop(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  // Rebuild AI field scripts from stored plans so stale bare fills pick up inputRejected wrapping.
  useEffect(() => {
    const current = configFor(dataRef.current);
    const needsRefresh = (current.fields || []).some(
      (item) =>
        item.scriptMode !== 'manual' &&
        item.plan &&
        !(item.scriptText || '').includes('__wrapValidationInput'),
    );
    if (!needsRefresh) return;
    const refreshed = refreshValidatorScripts(current);
    onChangeRef.current({
      frontendValidator: refreshed.config,
      scriptText: refreshed.scriptText,
    });
  }, []);

  const updateConfig = (patch: Partial<FrontendValidatorConfig>, rebuildScript = true) => {
    const nextConfig = {
      ...config,
      ...patch,
    };
    if (!rebuildScript) {
      onChange({ frontendValidator: nextConfig });
      return;
    }
    const refreshed = refreshValidatorScripts(nextConfig);
    onChange({
      frontendValidator: refreshed.config,
      scriptText: refreshed.scriptText,
    });
  };

  const updateFields = (fields: FrontendValidatorField[]) => {
    updateConfig({ fields });
  };

  const changeMode = (nextMode: 'autoFill' | 'captured') => {
    setError(null);
    if (sessionId) {
      void recordingService.stop(sessionId).catch(() => undefined);
      setSessionId(null);
    }
    updateConfig({
      mode: nextMode,
      sourceAiFillNodeId: undefined,
      restoreFields: undefined,
      fields: [],
    });
  };

  const selectSource = (sourceAiFillNodeId: string) => {
    const nextSource = sourceNodes.find((node) => node.id === sourceAiFillNodeId);
    updateConfig({
      mode: 'autoFill',
      sourceAiFillNodeId: sourceAiFillNodeId || undefined,
      restoreFields: nextSource?.data.aiFillFields || [],
      fields:
        nextSource?.data.aiFillFields?.map((field) => ({
          field,
          rule: '',
          scriptMode: 'ai',
        })) || [],
    });
  };

  const toggleField = (field: AiFillField) => {
    const exists = selectedFields.some((item) => fieldKey(item.field) === fieldKey(field));
    updateFields(
      exists
        ? withoutField(selectedFields, fieldKey(field))
        : mergeField(selectedFields, field),
    );
  };

  const updateRule = (fieldId: string, rule: string) => {
    updateFields(
      selectedFields.map((item) =>
        fieldKey(item.field) === fieldId ? { ...item, rule } : item,
      ),
    );
  };

  const updateScript = (fieldId: string, scriptText: string) => {
    updateFields(
      selectedFields.map((item) =>
        fieldKey(item.field) === fieldId ? { ...item, scriptText } : item,
      ),
    );
  };

  const setScriptMode = (fieldId: string, scriptMode: 'ai' | 'manual') => {
    updateFields(
      selectedFields.map((item) =>
        fieldKey(item.field) === fieldId ? { ...item, scriptMode } : item,
      ),
    );
  };

  const clearScript = (fieldId: string) => {
    updateFields(
      selectedFields.map((item) =>
        fieldKey(item.field) === fieldId
          ? { ...item, scriptText: '', plan: undefined }
          : item,
      ),
    );
  };

  const warmupCapture = async () => {
    if (!context?.project) {
      throw new Error('Select a project before capturing.');
    }
    context.onEnsurePreview?.();
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
    return result;
  };

  const captureFields = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await warmupCapture();
      setCapturedFields(result.fields);
      updateConfig({
        mode: 'captured',
        sourceAiFillNodeId: undefined,
        restoreFields: result.fields,
        fields: result.fields.map((field) => ({ field, rule: '', scriptMode: 'ai' })),
      });
      await recordingService.highlightFields(result.sessionId, result.fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture fields');
    } finally {
      setBusy(false);
    }
  };

  const captureTrigger = async () => {
    setBusy(true);
    setError(null);
    setTriggerMessage(null);
    try {
      const result = await warmupCapture();
      setTriggerMessage('Click the Next/Submit button in Preview.');
      await recordingService.startTriggerPicker(result.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start trigger capture');
    } finally {
      setBusy(false);
    }
  };

  const clearTrigger = () => {
    setTriggerMessage(null);
    updateConfig({ triggerButton: undefined });
    if (sessionId) void recordingService.stopTriggerPicker(sessionId).catch(() => undefined);
  };

  const generateFieldScript = async (fieldId: string) => {
    const item = selectedFields.find((entry) => fieldKey(entry.field) === fieldId);
    if (!item || item.scriptMode === 'manual') return;
    if (!item.rule.trim()) {
      setError('Add a prompt before generating this field script.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let snapshot = '';
      try {
        const snap = await window.autoTester?.getPageSnapshot?.();
        snapshot = snap?.snapshot || '';
      } catch {
        snapshot = '';
      }
      const result = await frontendValidatorService.generate(
        [item],
        snapshot,
        config.triggerButton,
      );
      const [nextField] = frontendValidatorService.applyGenerationResults(
        [item],
        result.plans,
        config.triggerButton,
      );
      const nextFields = selectedFields.map((entry) =>
        fieldKey(entry.field) === fieldId ? nextField : entry,
      );
      updateConfig({ fields: nextFields });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate field script');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div>
        <label className="field-label">Field source</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={mode === 'autoFill' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => changeMode('autoFill')}
          >
            Auto Form Filler
          </button>
          <button
            type="button"
            className={mode === 'captured' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => changeMode('captured')}
          >
            Captured fields
          </button>
        </div>
      </div>

      {mode === 'autoFill' ? (
        <div>
          <label className="field-label">Auto Form Filler step</label>
          <select
            className="input"
            value={config.sourceAiFillNodeId || ''}
            onChange={(event) => selectSource(event.target.value)}
          >
            <option value="">Select an Auto Form Filler</option>
            {sourceNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.data.label || node.id}
              </option>
            ))}
          </select>
          {!sourceNodes.length && (
            <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', marginTop: 5 }}>
              Add an Auto Form Filler before this validator.
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void captureFields()}
          disabled={busy}
        >
          <Crosshair size={12} />
          {busy ? 'Capturing…' : 'Capture fields'}
        </button>
      )}

      <div>
        <label className="field-label">Validation trigger (optional)</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void captureTrigger()}
            disabled={busy}
          >
            <Crosshair size={12} />
            Capture trigger
          </button>
          {config.triggerButton && (
            <button type="button" className="btn-secondary" onClick={clearTrigger}>
              <X size={12} /> Clear trigger
            </button>
          )}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.45 }}>
          Use when validation only appears after clicking Next or Submit.
        </div>
        {config.triggerButton && (
          <div style={{ fontSize: '0.68rem', color: 'var(--accent-green)', marginTop: 4 }}>
            Trigger: {config.triggerButton.label}
          </div>
        )}
        {triggerMessage && !config.triggerButton && (
          <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', marginTop: 4 }}>
            {triggerMessage}
          </div>
        )}
      </div>

      <div>
        <label className="field-label">After validation</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}>
          <input
            type="checkbox"
            checked={config.restoreAfterValidate !== false}
            onChange={(event) =>
              updateConfig({ restoreAfterValidate: event.target.checked })
            }
          />
          Restore form to pre-step state
        </label>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.45 }}>
          Snapshots linked Auto Form Filler fields (or validated fields) before checks, then refills
          them and returns to the same URL so the next step starts clean.
        </div>
      </div>

      {(mode === 'autoFill' && sourceNode) || (mode === 'captured' && capturedFields.length > 0) ? (
        <div>
          <label className="field-label">Fields to validate</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(mode === 'autoFill' ? sourceFields : capturedFields).map((field) => {
              const selected = selectedFields.some(
                (item) => fieldKey(item.field) === fieldKey(field),
              );
              return (
                <label
                  key={fieldKey(field)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleField(field)}
                  />
                  {field.label}
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      {selectedFields.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Field validation</label>
          {selectedFields.map(({ field, rule, scriptText, scriptMode = 'ai' }) => (
            <div
              key={fieldKey(field)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '8px 10px',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>{field.label}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className={scriptMode === 'manual' ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: '0.62rem', padding: '2px 8px' }}
                    onClick={() => setScriptMode(fieldKey(field), 'manual')}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={scriptMode === 'ai' ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: '0.62rem', padding: '2px 8px' }}
                    onClick={() => setScriptMode(fieldKey(field), 'ai')}
                  >
                    AI
                  </button>
                </div>
              </div>
              {scriptMode === 'ai' && (
                <textarea
                  className="textarea"
                  rows={2}
                  value={rule}
                  onChange={(event) => updateRule(fieldKey(field), event.target.value)}
                  placeholder="Prompt: e.g. Maximum 10 digits; reject longer values"
                />
              )}
              <textarea
                className="textarea"
                rows={5}
                value={scriptText || ''}
                onChange={(event) => updateScript(fieldKey(field), event.target.value)}
                placeholder={
                  scriptMode === 'manual'
                    ? 'Playwright JS for this field validation.'
                    : 'Generated script appears here. You can edit it after generation.'
                }
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.68rem' }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {scriptMode === 'ai' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void generateFieldScript(fieldKey(field))}
                    disabled={busy || !rule.trim()}
                  >
                    <Sparkles size={12} /> Generate script
                  </button>
                )}
                {scriptText?.trim() && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => clearScript(fieldKey(field))}
                  >
                    Clear script
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedFields.length === 0 && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>
          Select at least one field to validate.
        </div>
      )}
      {selectedFields.some(
        (item) => item.scriptMode === 'manual' && !item.scriptText?.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', lineHeight: 1.45 }}>
          Manual fields need a script before the step can run.
        </div>
      )}
      {selectedFields.some(
        (item) => (item.scriptMode ?? 'ai') === 'ai' && !item.rule.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', lineHeight: 1.45 }}>
          AI fields need a prompt before generating scripts.
        </div>
      )}
      {error && <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)' }}>{error}</div>}
      {selectedFields.some(
        (item) => (item.scriptMode ?? 'ai') === 'ai' && item.rule.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--accent-green)', lineHeight: 1.45 }}>
          <Check size={11} style={{ verticalAlign: 'middle' }} /> AI fields ready for generation.
          Manual field scripts are preserved during bulk generate.
        </div>
      )}
    </>
  );
}
