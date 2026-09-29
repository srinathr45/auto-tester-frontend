import type { StepData, StepKind } from './types';

export interface StepKindOption {
  kind: StepKind;
  /** Short name shown in the Add menu and timeline badge. */
  menuLabel: string;
  defaultName: string;
  description: string;
  /** True when inspector shows Generate with AI (not aiFill / script). */
  generateAtCreate: boolean;
}

export const STEP_KIND_OPTIONS: StepKindOption[] = [
  {
    kind: 'script',
    menuLabel: 'Script',
    defaultName: 'Script',
    description: 'Write or capture Playwright JS',
    generateAtCreate: false,
  },
  {
    kind: 'aiFill',
    menuLabel: 'Auto Form Filler',
    defaultName: 'Auto Form Filler',
    description: 'Capture fields and generate a saved form-filling script',
    generateAtCreate: false,
  },
  {
    kind: 'inputWait',
    menuLabel: 'Input wait',
    defaultName: 'Wait for OTP / captcha',
    description: 'Wait, then pause for human input',
    generateAtCreate: true,
  },
  {
    kind: 'aiScript',
    menuLabel: 'AI script',
    defaultName: 'AI script',
    description: 'Capture HTML, then generate a Playwright step once',
    generateAtCreate: true,
  },
  {
    kind: 'loop',
    menuLabel: 'Loop',
    defaultName: 'Loop',
    description: 'Repeat earlier steps N times — paste or capture a navigate-back script on this step',
    generateAtCreate: false,
  },
  {
    kind: 'patternValidate',
    menuLabel: 'Frontend Validator',
    defaultName: 'Frontend Validator',
    description: 'Check frontend field rules with invalid and valid input',
    generateAtCreate: true,
  },
  {
    kind: 'apiValidate',
    menuLabel: 'API check',
    defaultName: 'API check',
    description: 'Capture APIs from the previous step and assert them',
    generateAtCreate: true,
  },
];

const KIND_SET = new Set<string>(STEP_KIND_OPTIONS.map((o) => o.kind));

/** Treat missing or unknown stepKind as a plain script step. */
export function resolveStepKind(data?: StepData | null): StepKind {
  const kind = data?.stepKind;
  if (kind && KIND_SET.has(kind)) return kind;
  return 'script';
}

export function stepKindOption(kind: StepKind): StepKindOption {
  return STEP_KIND_OPTIONS.find((o) => o.kind === kind) || STEP_KIND_OPTIONS[0];
}

export function defaultDataForKind(kind: StepKind): StepData {
  const opt = stepKindOption(kind);
  const data: StepData = {
    label: opt.defaultName,
    description: opt.description,
    scriptText: '',
    stepKind: kind,
    goal: '',
  };
  if (kind === 'inputWait') {
    // Empty so the pause popup is not "Paused for Wait, then pause for human input".
    data.description = '';
    data.wait = { timeoutMs: 120000 };
  }
  if (kind === 'loop') {
    data.loop = { count: 3 };
  }
  if (kind === 'patternValidate') {
    data.pattern = { field: '', format: 'mobile number', invalidExample: '', validExample: '' };
    data.frontendValidator = { mode: 'autoFill', fields: [], plans: [] };
  }
  if (kind === 'apiValidate') {
    data.api = { urlContains: '', method: 'POST', sampleJson: '' };
    data.apiValidate = { capturedApis: [], apis: [] };
  }
  return data;
}
