import type {
  AiFillField,
  FrontendValidationPlan,
  FrontendValidatorConfig,
  FrontendValidatorField,
  FrontendValidatorTriggerButton,
} from '../../../shared/types';

function jsString(value: string): string {
  return JSON.stringify(value);
}

function locatorFor(field: AiFillField): string {
  const locator = field.locatorCandidates[0];
  if (!locator) throw new Error(`No trusted locator exists for "${field.label}"`);
  return `page.locator(${jsString(locator)})`;
}

/**
 * Runtime helpers injected once per validator step script.
 * Input rejection = validation pass; locator / timeout errors still throw.
 * Visible error helper covers exact errorText, generic copy, and role=alert.
 */
export function compileValidatorErrorHelpers(): string {
  return [
    '// Input rejected by browser/Playwright => validation pass; locator failures still throw.',
    'const __wrapValidationInput = async (action) => {',
    '  try {',
    '    await action();',
    '    return false;',
    '  } catch (error) {',
    '    const message = error instanceof Error ? error.message : String(error);',
    '    if (',
    '      /Cannot type text into input/i.test(message) ||',
    '      /Input of type "number" is not valid/i.test(message) ||',
    '      /Cannot enter text into/i.test(message) ||',
    '      /did not find some options/i.test(message)',
    '    ) return true;',
    '    throw error;',
    '  }',
    '};',
    'const __hasVisibleValidationError = async (errorText) => {',
    '  if (errorText && await page.getByText(errorText, { exact: false }).first().isVisible().catch(() => false)) return true;',
    '  if (await page.getByRole(\'alert\').first().isVisible().catch(() => false)) return true;',
    '  if (await page.getByText(/required|invalid|must be|cannot be empty|can\'t be empty|is required/i).first().isVisible().catch(() => false)) return true;',
    '  return false;',
    '};',
  ].join('\n');
}

function setValue(field: AiFillField, locator: string, value: string): string {
  let action: string;
  if (field.kind === 'select') {
    action = `await ${locator}.selectOption(${jsString(value)});`;
  } else if (field.kind === 'checkbox' || field.kind === 'radio') {
    action =
      value.toLowerCase() === 'true'
        ? `await ${locator}.check();`
        : `await ${locator}.uncheck();`;
  } else {
    action = `await ${locator}.fill(${jsString(value)});`;
  }
  return [
    'const inputRejected = await __wrapValidationInput(async () => {',
    `  ${action}`,
    '});',
  ].join('\n');
}

function triggerValidation(
  fieldLocator: string,
  trigger: FrontendValidationPlan['trigger'],
  triggerButton?: FrontendValidatorTriggerButton,
): string {
  if (triggerButton?.clickScriptLine) {
    return 'await clickValidationTrigger();';
  }
  if (trigger === 'blur') return `await ${fieldLocator}.blur();`;
  if (trigger === 'submit') return `await ${fieldLocator}.press('Enter');`;
  return '';
}

function uniqueRestoreFields(config: FrontendValidatorConfig): AiFillField[] {
  const byId = new Map<string, AiFillField>();
  for (const field of config.restoreFields || []) {
    if (field?.fieldId && field.locatorCandidates?.[0]) byId.set(field.fieldId, field);
  }
  for (const item of config.fields || []) {
    const field = item.field;
    if (field?.fieldId && field.locatorCandidates?.[0]) byId.set(field.fieldId, field);
  }
  return [...byId.values()];
}

function compileSnapshotEntry(field: AiFillField): string {
  const locator = locatorFor(field);
  const selector = jsString(field.locatorCandidates[0]);
  if (field.kind === 'select') {
    return `{ kind: 'select', selector: ${selector}, value: await ${locator}.inputValue().catch(() => '') }`;
  }
  if (field.kind === 'checkbox' || field.kind === 'radio') {
    return `{ kind: ${jsString(field.kind)}, selector: ${selector}, value: (await ${locator}.isChecked().catch(() => false)) ? 'true' : 'false' }`;
  }
  return `{ kind: ${jsString(field.kind)}, selector: ${selector}, value: await ${locator}.inputValue().catch(() => '') }`;
}

export function compileValidatorSnapshotScript(fields: AiFillField[]): string {
  if (!fields.length) return '';
  const entries = fields.map((field) => `    ${compileSnapshotEntry(field)},`).join('\n');
  return [
    'const __validatorSnapshot = {',
    '  url: page.url(),',
    '  fields: [',
    entries,
    '  ],',
    '};',
    'const __restoreValidatorSnapshot = async () => {',
    '  for (const item of __validatorSnapshot.fields) {',
    '    const loc = page.locator(item.selector);',
    "    if (item.kind === 'select') await loc.selectOption(item.value).catch(() => undefined);",
    "    else if (item.kind === 'checkbox' || item.kind === 'radio') {",
    "      if (item.value === 'true') await loc.check().catch(() => undefined);",
    '      else await loc.uncheck().catch(() => undefined);',
    '    } else await loc.fill(item.value).catch(() => undefined);',
    '  }',
    '};',
  ].join('\n');
}

export function compileValidatorRestoreScript(): string {
  return [
    '// Restore form to the state before this validator step',
    'await __restoreValidatorSnapshot();',
    'if (page.url() !== __validatorSnapshot.url) {',
    "  await page.goto(__validatorSnapshot.url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);",
    '  await __restoreValidatorSnapshot();',
    '}',
  ].join('\n');
}

export { uniqueRestoreFields };

function planWarning(plan: FrontendValidationPlan, selected: FrontendValidatorField): string {
  return (
    plan.warningMessage ||
    `${selected.field.label}: expected rule "${selected.rule}" was not enforced.`
  );
}

/** Compile one field validation block from an AI plan and trusted locators. */
export function compileFieldScriptFromPlan(
  selected: FrontendValidatorField,
  plan: FrontendValidationPlan,
  triggerButton?: FrontendValidatorTriggerButton,
): string {
  const { field } = selected;
  const locator = locatorFor(field);
  const warning = jsString(planWarning(plan, selected));
  const errorText = plan.errorText ? jsString(plan.errorText) : 'null';
  const hasTriggerClick = Boolean(triggerButton?.clickScriptLine?.trim());
  const invalidState = `const invalidState = await ${locator}.evaluate((element) => ({
  value: 'value' in element ? String(element.value) : '',
  checked: 'checked' in element ? Boolean(element.checked) : false,
  ariaInvalid: element.getAttribute('aria-invalid') === 'true',
  nativeInvalid: element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
    ? !element.checkValidity()
    : false,
}));`;
  // Ranked pass: visible error/alert OR aria/native OR (trigger only) page/field unchanged.
  // plan.detection is kept for AI/docs only — runtime always uses this OR.
  const pageUnchanged = hasTriggerClick
    ? '(__beforeUrl === page.url() && __fieldWasVisible && await ' +
      `${locator}.isVisible().catch(() => false))`
    : 'false';
  const invalidDetected =
    `(await __hasVisibleValidationError(errorText) || invalidState.ariaInvalid || invalidState.nativeInvalid || ${pageUnchanged})`;

  const warnIfMissing = `if (!inputRejected && !${invalidDetected}) warn(${warning});`;

  const beforeTrigger = hasTriggerClick
    ? [
        'const __beforeUrl = page.url();',
        `const __fieldWasVisible = await ${locator}.isVisible().catch(() => false);`,
      ].join('\n')
    : '';

  return [
    '{',
    `// Frontend validation: ${field.label}`,
    `const errorText = ${errorText};`,
    setValue(field, locator, plan.invalidValue),
    beforeTrigger,
    triggerValidation(locator, plan.trigger, triggerButton),
    invalidState,
    warnIfMissing,
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export function compileFrontendValidationScript(
  fields: FrontendValidatorField[],
  plans: FrontendValidationPlan[],
  triggerButton?: FrontendValidatorTriggerButton,
): string {
  const byId = new Map(fields.map((item) => [item.field.fieldId, item]));
  return plans
    .map((plan) => {
      const selected = byId.get(plan.fieldId);
      if (!selected) throw new Error(`AI returned unknown field "${plan.fieldId}"`);
      return compileFieldScriptFromPlan(selected, plan, triggerButton);
    })
    .join('\n\n');
}

export function compileCombinedValidatorScript(
  fields: FrontendValidatorField[],
  restoreBetweenFields = false,
): string {
  return fields
    .map((item) => {
      const script = item.scriptText?.trim();
      if (!script) return '';
      if (restoreBetweenFields) {
        return `${script}\nawait __restoreValidatorSnapshot();`;
      }
      return script;
    })
    .filter(Boolean)
    .join('\n\n');
}

export function applyGenerationResults(
  fields: FrontendValidatorField[],
  plans: FrontendValidationPlan[],
  triggerButton?: FrontendValidatorTriggerButton,
): FrontendValidatorField[] {
  const byId = new Map(plans.map((plan) => [plan.fieldId, plan]));
  return fields.map((item) => {
    if (item.scriptMode === 'manual') return item;
    const plan = byId.get(item.field.fieldId);
    if (!plan) return item;
    const scriptText = compileFieldScriptFromPlan(item, plan, triggerButton);
    return {
      ...item,
      scriptMode: 'ai',
      plan,
      scriptText,
    };
  });
}

/**
 * Recompile AI-mode fields that have a stored plan so stale bare fills pick up
 * __wrapValidationInput. Manual fields and AI fields without a plan are left as-is.
 */
export function recompileAiFieldsFromPlans(
  config: FrontendValidatorConfig,
): FrontendValidatorField[] {
  const fields = config.fields || [];
  const triggerButton = config.triggerButton;
  return fields.map((item) => {
    if (item.scriptMode === 'manual' || !item.plan) return item;
    return {
      ...item,
      scriptMode: 'ai',
      scriptText: compileFieldScriptFromPlan(item, item.plan, triggerButton),
    };
  });
}

/** Refresh field scripts from plans and rebuild the combined step script. */
export function refreshValidatorScripts(config: FrontendValidatorConfig): {
  config: FrontendValidatorConfig;
  scriptText: string;
} {
  const fields = recompileAiFieldsFromPlans(config);
  const nextConfig = { ...config, fields };
  return {
    config: nextConfig,
    scriptText: buildValidatorStepScript(nextConfig),
  };
}

export function buildValidatorStepScript(config: FrontendValidatorConfig): string {
  const fields = recompileAiFieldsFromPlans(config);
  const restoreEnabled = config.restoreAfterValidate !== false;
  const restoreFields = uniqueRestoreFields({ ...config, fields });
  const restoreBetweenFields = restoreEnabled && restoreFields.length > 0;
  const body = compileCombinedValidatorScript(fields, restoreBetweenFields);
  const parts: string[] = [];
  const clickLine = config.triggerButton?.clickScriptLine?.trim();
  if (clickLine) {
    parts.push(['const clickValidationTrigger = async () => {', clickLine, '};'].join('\n'));
  }
  if (body) {
    parts.push(compileValidatorErrorHelpers());
  }
  if (restoreEnabled && restoreFields.length) {
    parts.push(compileValidatorSnapshotScript(restoreFields));
  }
  if (body) parts.push(body);
  if (restoreEnabled && restoreFields.length) {
    parts.push(compileValidatorRestoreScript());
  }
  return parts.join('\n\n');
}
