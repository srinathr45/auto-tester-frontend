import { aiService } from '../../../ai/services/ai.service';
import type { ApiValidateItem } from '../../../shared/types';
import {
  applyApiGenerationResults,
  compileCombinedApiScripts,
  refreshApiValidateScripts,
} from './api-validate.compile';

export {
  applyApiGenerationResults,
  compileCombinedApiScripts,
  refreshApiValidateScripts,
};

function toAiApi(item: ApiValidateItem, includeRule: boolean) {
  return {
    alias: item.alias,
    method: item.api.method,
    url: item.api.url,
    status: item.api.status,
    requestBody: item.api.requestBody,
    responseBody: item.api.responseBody,
    rule: includeRule ? item.rule : '',
    ...(item.scriptText?.trim() && includeRule
      ? { currentScript: item.scriptText.trim() }
      : {}),
  };
}

export const apiValidateService = {
  /**
   * Ask Nest for scripts. All selected APIs are context; only rows with a
   * rule (and includeRule) get generated output.
   */
  generate: (apis: ApiValidateItem[], onlyAlias?: string) => {
    const payload = apis.map((item) => {
      const isTarget = onlyAlias ? item.alias === onlyAlias : item.scriptMode !== 'manual';
      return toAiApi(item, isTarget && Boolean(item.rule.trim()));
    });
    return aiService.generateApiValidation({ apis: payload });
  },
  applyGenerationResults: applyApiGenerationResults,
  compileCombined: compileCombinedApiScripts,
  refreshScripts: refreshApiValidateScripts,
};
