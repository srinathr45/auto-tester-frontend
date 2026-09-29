import { request } from '../../shared/http';
import type {
  ApiConfig,
  AiFillConditionalAction,
  AiFillField,
  AiFillFieldSuggestion,
  FrontendValidationPlan,
  HtmlCatalogItem,
  HtmlLocateHint,
  PatternConfig,
  StepKind,
  WaitConfig,
} from '../../shared/types';

/** Kinds that author a Playwright script once via AI (Loop is control-flow, not AI). */
export type GenerateStepKind = Exclude<StepKind, 'script' | 'aiFill' | 'loop'>;

export interface GenerateScriptBody {
  stepKind: GenerateStepKind;
  goal?: string;
  snapshot?: string;
  /** Saved page markup for aiScript generate (preferred over snapshot). */
  htmlElements?: string;
  wait?: WaitConfig;
  pattern?: PatternConfig;
  api?: ApiConfig;
}

export interface FillPlanField {
  locator: string;
  value: string;
  action: string;
}

export interface AiFillFieldDiscovery {
  goal: string;
  anchorFieldIds: string[];
  fields: Array<Omit<AiFillField, 'locatorCandidates'>>;
}

export interface ConditionalFillBody {
  goal: string;
  fields: Array<Omit<AiFillField, 'locatorCandidates'>>;
  anchorFieldIds: string[];
}

export interface FrontendValidationBody {
  fields: Array<{
    field: AiFillField;
    rule: string;
    currentScript?: string;
  }>;
  snapshot?: string;
  triggerButton?: {
    label: string;
    locatorCandidates: string[];
  };
}

export interface ApiValidationBody {
  apis: Array<{
    alias: string;
    method: string;
    url: string;
    status: number;
    requestBody?: string;
    responseBody?: string;
    rule: string;
    currentScript?: string;
  }>;
}

/**
 * Nest AI proxy client. The API key never leaves the backend.
 */
export const aiService = {
  generateScript: (body: GenerateScriptBody) =>
    request<{ scriptText: string }>('/ai/generate-script', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  fillPlan: (body: { goal: string; snapshot?: string }) =>
    request<{ fields: FillPlanField[] }>('/ai/fill-plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  suggestFields: (body: AiFillFieldDiscovery) =>
    request<{ fields: AiFillFieldSuggestion[] }>('/ai/suggest-fields', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateConditionalFill: (body: ConditionalFillBody) =>
    request<{ actions: AiFillConditionalAction[] }>('/ai/conditional-fill', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateFrontendValidation: (body: FrontendValidationBody) =>
    request<{ plans: FrontendValidationPlan[] }>('/ai/frontend-validation', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateApiValidation: (body: ApiValidationBody) =>
    request<{ scripts: Array<{ alias: string; scriptText: string }> }>('/ai/api-validation', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  locateHint: (body: { goal: string }) =>
    request<HtmlLocateHint>('/ai/locate-hint', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  narrowTargets: (body: { goal: string; candidates: HtmlCatalogItem[] }) =>
    request<{ pick: string[]; namePattern: string }>('/ai/narrow-targets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
