import { aiService } from '../../../ai/services/ai.service';
import type { FrontendValidatorField, FrontendValidatorTriggerButton } from '../../../shared/types';
import {
  applyGenerationResults,
  buildValidatorStepScript,
  compileCombinedValidatorScript,
  compileFieldScriptFromPlan,
  compileFrontendValidationScript,
  refreshValidatorScripts,
  recompileAiFieldsFromPlans,
} from './frontend-validator.compile';

export {
  applyGenerationResults,
  buildValidatorStepScript,
  compileCombinedValidatorScript,
  compileFieldScriptFromPlan,
  compileFrontendValidationScript,
  refreshValidatorScripts,
  recompileAiFieldsFromPlans,
};

export const frontendValidatorService = {
  generate: (
    fields: FrontendValidatorField[],
    snapshot?: string,
    triggerButton?: FrontendValidatorTriggerButton,
  ) => {
    const semanticFields = fields
      .filter((item) => item.scriptMode !== 'manual')
      .map(({ field, rule, scriptText }) => ({
        field,
        rule,
        ...(scriptText?.trim() ? { currentScript: scriptText.trim() } : {}),
      }));
    return aiService.generateFrontendValidation({
      fields: semanticFields,
      snapshot,
      triggerButton: triggerButton
        ? {
            label: triggerButton.label,
            locatorCandidates: triggerButton.locatorCandidates,
          }
        : undefined,
    });
  },
  applyGenerationResults,
  compileFieldScriptFromPlan,
  compile: compileFrontendValidationScript,
  compileCombined: compileCombinedValidatorScript,
  buildStepScript: buildValidatorStepScript,
  refreshScripts: refreshValidatorScripts,
};
