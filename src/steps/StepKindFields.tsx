import { Sparkles } from 'lucide-react';
import type { GenerateStepKind } from '../ai/services/ai.service';
import { resolveStepKind, stepKindOption } from '../shared/stepKinds';
import type { FlowEdge, FlowNode, Project, StepData } from '../shared/types';
import AiFillFields from './aiFill/AiFillFields';
import AiScriptFields from './aiScript/AiScriptFields';
import ApiValidateFields from './apiValidate/ApiValidateFields';
import FrontendValidatorFields from './frontendValidator/FrontendValidatorFields';
import InputWaitFields from './inputWait/InputWaitFields';
import LoopFields from './loop/LoopFields';
import type { RepeatFromOption } from './types';

interface StepKindFieldsProps {
  data: StepData;
  generating: boolean;
  generateError: string | null;
  onChange: (patch: Partial<StepData>) => void;
  onGenerate: () => void;
  capturingHtml?: boolean;
  htmlCaptureError?: string | null;
  onCaptureHtml?: () => void;
  repeatFromOptions?: RepeatFromOption[];
  repeatFromId?: string | null;
  onRepeatFromChange?: (targetNodeId: string | null) => void;
  aiFillContext?: {
    project: Project | null;
    nodes: FlowNode[];
    edges: FlowEdge[];
    selectedNodeId: string;
    onEnsurePreview?: () => void;
  };
  fieldCaptureContext?: {
    project: Project | null;
    nodes: FlowNode[];
    edges: FlowEdge[];
    selectedNodeId: string;
    onEnsurePreview?: () => void;
  };
}

/**
 * Shared inspector header (step type + Generate with AI) plus the selected
 * kind's own fields from `steps/<kind>/`.
 */
export default function StepKindFields({
  data,
  generating,
  generateError,
  onChange,
  onGenerate,
  capturingHtml = false,
  htmlCaptureError = null,
  onCaptureHtml,
  repeatFromOptions = [],
  repeatFromId = null,
  onRepeatFromChange,
  aiFillContext,
  fieldCaptureContext,
}: StepKindFieldsProps) {
  const kind = resolveStepKind(data);
  const option = stepKindOption(kind);
  const validatorFields = data.frontendValidator?.fields || [];
  const validatorAiFields = validatorFields.filter(
    (field) => (field.scriptMode ?? 'ai') === 'ai',
  );
  const apiItems = data.apiValidate?.apis || [];
  const apiAiItems = apiItems.filter((item) => (item.scriptMode ?? 'ai') === 'ai');
  const validatorBulkGenerateDisabled =
    kind === 'patternValidate' &&
    (!validatorAiFields.length || !validatorAiFields.some((field) => field.rule.trim()));
  const apiBulkGenerateDisabled =
    kind === 'apiValidate' &&
    (!apiAiItems.length || !apiAiItems.some((item) => item.rule.trim()));

  return (
    <>
      <div>
        <label className="field-label">Step type</label>
        <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{option.menuLabel}</div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 2 }}>
          {option.description}
        </div>
      </div>

      {kind === 'aiFill' && (
        <AiFillFields data={data} onChange={onChange} aiFillContext={aiFillContext} />
      )}
      {kind === 'inputWait' && <InputWaitFields data={data} onChange={onChange} />}
      {kind === 'aiScript' && (
        <AiScriptFields
          data={data}
          onChange={onChange}
          capturingHtml={capturingHtml}
          htmlCaptureError={htmlCaptureError}
          onCaptureHtml={onCaptureHtml}
        />
      )}
      {kind === 'loop' && (
        <LoopFields
          data={data}
          onChange={onChange}
          repeatFromOptions={repeatFromOptions}
          repeatFromId={repeatFromId}
          onRepeatFromChange={onRepeatFromChange}
        />
      )}
      {kind === 'patternValidate' && (
        <FrontendValidatorFields
          data={data}
          onChange={onChange}
          fieldCaptureContext={fieldCaptureContext}
        />
      )}
      {kind === 'apiValidate' && (
        <ApiValidateFields
          data={data}
          onChange={onChange}
          fieldCaptureContext={fieldCaptureContext}
        />
      )}

      {option.generateAtCreate && (
        <div>
          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={
              generating ||
              capturingHtml ||
              validatorBulkGenerateDisabled ||
              apiBulkGenerateDisabled ||
              (kind === 'aiScript' &&
                (!String(data.goal || '').trim() ||
                  !(Array.isArray(data.htmlCatalog) && data.htmlCatalog.length)))
            }
            onClick={onGenerate}
          >
            <Sparkles size={12} />
            {generating ? 'Generating…' : 'Generate with AI'}
          </button>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: 6 }}>
            {kind === 'aiScript'
              ? 'Write a goal from Preview, then generate. Only the matching section is sent to AI.'
              : kind === 'patternValidate'
                ? 'Bulk-generates scripts for AI fields (with prompts). Manual fields are skipped. Existing scripts are sent as context.'
                : kind === 'apiValidate'
                  ? 'Bulk-generates scripts for AI APIs (with prompts). Manual APIs are skipped. Captured calls are sent as context.'
              : 'Writes Playwright once. Later runs use the saved script.'}
          </div>
          {generateError && (
            <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)', marginTop: 6 }}>
              {generateError}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function isGenerateStepKind(kind: string): kind is GenerateStepKind {
  return (
    kind === 'aiScript' ||
    kind === 'inputWait' ||
    kind === 'patternValidate' ||
    kind === 'apiValidate'
  );
}

export type { RepeatFromOption } from './types';
