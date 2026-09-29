import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyGenerationResults,
  buildValidatorStepScript,
  compileCombinedValidatorScript,
  compileFieldScriptFromPlan,
  refreshValidatorScripts,
} from './frontend-validator.compile.ts';
import type { FrontendValidatorField } from '../../../shared/types.ts';

const mobileField: FrontendValidatorField = {
  field: {
    fieldId: 'mobile-number-1',
    label: 'Mobile number',
    kind: 'text',
    required: true,
    visible: true,
    enabled: true,
    locatorCandidates: ['#mobile'],
  },
  rule: 'Maximum 10 digits',
  scriptMode: 'ai',
};

const emailField: FrontendValidatorField = {
  field: {
    fieldId: 'email-1',
    label: 'Email',
    kind: 'text',
    required: true,
    visible: true,
    enabled: true,
    locatorCandidates: ['#email'],
  },
  rule: 'Must be a valid email',
  scriptMode: 'manual',
  scriptText: "warn('manual email script');",
};

test('compileFieldScriptFromPlan uses captured trigger click', () => {
  const script = compileFieldScriptFromPlan(
    mobileField,
    {
      fieldId: 'mobile-number-1',
      invalidValue: '12345678901',
      validValue: '9876543210',
      trigger: 'blur',
      detection: 'rejected',
      warningMessage: 'Mobile number: expected max length 10.',
    },
    {
      label: 'Next',
      locatorCandidates: ['#next'],
      clickScriptLine: "await page.locator('#next').click();",
    },
  );
  assert.match(script, /await clickValidationTrigger\(\);/);
  assert.match(script, /warn\("Mobile number: expected max length 10\."\)/);
  assert.doesNotMatch(script, /const validState =/);
  assert.equal((script.match(/await clickValidationTrigger\(\);/g) || []).length, 1);
});

test('compileFieldScriptFromPlan treats number-input letter fills as rejected not failed', () => {
  const areaField: FrontendValidatorField = {
    field: {
      fieldId: 'total-area-sq-ft-7',
      label: 'Total area (sq.ft.)',
      kind: 'text',
      type: 'number',
      required: true,
      visible: true,
      enabled: true,
      locatorCandidates: ['#total-area'],
    },
    rule: 'Must be a number',
    scriptMode: 'ai',
  };
  const script = compileFieldScriptFromPlan(areaField, {
    fieldId: 'total-area-sq-ft-7',
    invalidValue: 'abc',
    validValue: '1200',
    trigger: 'blur',
    detection: 'rejected',
    warningMessage: 'Total area: expected a numeric value.',
  });
  assert.match(script, /__wrapValidationInput/);
  assert.match(script, /const inputRejected = await __wrapValidationInput/);
  assert.match(script, /if \(!inputRejected && !/);
});

test('compileFieldScriptFromPlan wraps select fills with input rejection guard', () => {
  const selectField: FrontendValidatorField = {
    field: {
      fieldId: 'state-1',
      label: 'State',
      kind: 'select',
      required: true,
      visible: true,
      enabled: true,
      locatorCandidates: ['#state'],
    },
    rule: 'Must pick a valid state',
    scriptMode: 'ai',
  };
  const script = compileFieldScriptFromPlan(selectField, {
    fieldId: 'state-1',
    invalidValue: 'INVALID',
    validValue: 'CA',
    trigger: 'blur',
    detection: 'rejected',
    warningMessage: 'State: invalid option should be rejected.',
  });
  assert.match(script, /selectOption\("INVALID"\)/);
  assert.match(script, /const inputRejected = await __wrapValidationInput/);
});

test('buildValidatorStepScript injects input rejection helper when body exists', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    fields: [{ ...mobileField, scriptText: "warn('check');" }],
    restoreAfterValidate: false,
  });
  assert.match(script, /const __wrapValidationInput = async \(action\) => \{/);
  assert.match(script, /Cannot type text into input/i);
  assert.match(script, /did not find some options/i);
  assert.match(script, /throw error;/);
});

test('buildValidatorStepScript restores between each field block', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    restoreFields: [mobileField.field, emailField.field],
    fields: [
      { ...mobileField, scriptText: "warn('one');" },
      { ...emailField, scriptText: "warn('two');" },
    ],
  });
  const restores = script.match(/await __restoreValidatorSnapshot\(\);/g) || [];
  assert.ok(restores.length >= 3, 'per-field restore plus final restore block');
  assert.match(script, /warn\('one'\);\nawait __restoreValidatorSnapshot\(\)/);
});

test('buildValidatorStepScript wraps validation with snapshot and restore', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    restoreFields: mobileField.field.locatorCandidates ? [mobileField.field] : [],
    fields: [{ ...mobileField, scriptText: "warn('check');" }],
  });
  assert.match(script, /const __validatorSnapshot = \{/);
  assert.match(script, /const __restoreValidatorSnapshot = async \(\) => \{/);
  assert.match(script, /await __restoreValidatorSnapshot\(\)/);
  assert.match(script, /warn\('check'\)/);
  const restoreIndex = script.indexOf('await __restoreValidatorSnapshot()');
  const checkIndex = script.indexOf("warn('check')");
  assert.ok(restoreIndex > checkIndex, 'restore runs after validation body');
});

test('buildValidatorStepScript skips restore when disabled', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    restoreAfterValidate: false,
    fields: [{ ...mobileField, scriptText: "warn('check');" }],
  });
  assert.doesNotMatch(script, /__validatorSnapshot/);
});

test('buildValidatorStepScript injects shared trigger helper once', () => {
  const combined = buildValidatorStepScript({
    mode: 'autoFill',
    triggerButton: {
      label: 'Next',
      locatorCandidates: ['#next'],
      clickScriptLine: "await page.locator('#next').click();",
    },
    fields: [
      { ...mobileField, scriptText: 'await clickValidationTrigger();' },
    ],
  });
  assert.match(combined, /const clickValidationTrigger = async \(\) => \{/);
  assert.match(combined, /await page\.locator\('#next'\)\.click\(\);/);
  assert.match(combined, /await clickValidationTrigger\(\);/);
});

test('applyGenerationResults compiles with trusted locators not AI scriptText', () => {
  const plans = [
    {
      fieldId: 'mobile-number-1',
      invalidValue: '12345678901',
      validValue: '9876543210',
      trigger: 'blur' as const,
      detection: 'rejected' as const,
      scriptText: "await page.locator('#mobile-number-1').fill('bad');",
    },
  ];
  const [compiled] = applyGenerationResults([mobileField], plans);
  assert.match(compiled.scriptText || '', /page\.locator\("#mobile"\)/);
  assert.doesNotMatch(compiled.scriptText || '', /#mobile-number-1/);
});

test('applyGenerationResults preserves manual field scripts', () => {
  const plans = [
    {
      fieldId: 'mobile-number-1',
      invalidValue: '12345678901',
      validValue: '9876543210',
      trigger: 'blur' as const,
      detection: 'rejected' as const,
      scriptText: "warn('generated mobile');",
    },
  ];
  const next = applyGenerationResults([mobileField, emailField], plans);
  assert.match(next[0].scriptText || '', /page\.locator\("#mobile"\)/);
  assert.equal(next[0].scriptMode, 'ai');
  assert.equal(next[1].scriptText, "warn('manual email script');");
  assert.equal(next[1].scriptMode, 'manual');
});

test('compileCombinedValidatorScript joins field scripts in order', () => {
  const combined = compileCombinedValidatorScript([
    { ...mobileField, scriptText: "warn('one');" },
    emailField,
  ]);
  assert.equal(combined, "warn('one');\n\nwarn('manual email script');");
});

test('refreshValidatorScripts rebuilds stale AI scripts from plan with inputRejected wrap', () => {
  const stale: FrontendValidatorField = {
    ...mobileField,
    scriptText:
      '{\nawait page.locator("#mobile").fill("abc");\nif (!(false)) warn("old");\n}',
    plan: {
      fieldId: 'mobile-number-1',
      invalidValue: 'abc',
      validValue: '9876543210',
      trigger: 'blur',
      detection: 'rejected',
      warningMessage: 'Mobile number: expected max length 10.',
    },
  };
  const { config, scriptText } = refreshValidatorScripts({
    mode: 'autoFill',
    restoreAfterValidate: false,
    fields: [stale, emailField],
  });
  assert.match(config.fields?.[0].scriptText || '', /inputRejected/);
  assert.match(config.fields?.[0].scriptText || '', /__wrapValidationInput/);
  assert.doesNotMatch(config.fields?.[0].scriptText || '', /warn\("old"\)/);
  assert.equal(config.fields?.[1].scriptText, "warn('manual email script');");
  assert.match(scriptText, /const __wrapValidationInput = async \(action\) => \{/);
  assert.match(scriptText, /const inputRejected = await __wrapValidationInput/);
  assert.match(scriptText, /warn\('manual email script'\)/);
});

test('buildValidatorStepScript recompiles AI fields from plan even when scriptText is stale', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    restoreAfterValidate: false,
    fields: [
      {
        ...mobileField,
        scriptText: 'await page.locator("#mobile").fill("abc");',
        plan: {
          fieldId: 'mobile-number-1',
          invalidValue: '12345678901',
          validValue: '9876543210',
          trigger: 'blur',
          detection: 'rejected',
          warningMessage: 'Mobile: max 10.',
        },
      },
    ],
  });
  assert.match(script, /__wrapValidationInput/);
  assert.match(script, /inputRejected/);
  assert.match(script, /fill\("12345678901"\)/);
  assert.doesNotMatch(script, /fill\("abc"\)/);
});

test('refreshValidatorScripts leaves AI fields without plan unchanged', () => {
  const bare: FrontendValidatorField = {
    ...mobileField,
    scriptText: 'await page.locator("#mobile").fill("abc");',
  };
  const { config, scriptText } = refreshValidatorScripts({
    mode: 'autoFill',
    restoreAfterValidate: false,
    fields: [bare],
  });
  assert.equal(config.fields?.[0].scriptText, 'await page.locator("#mobile").fill("abc");');
  assert.match(scriptText, /fill\("abc"\)/);
});

test('compileFieldScriptFromPlan always uses ranked visible error helper even when errorText empty', () => {
  const script = compileFieldScriptFromPlan(mobileField, {
    fieldId: 'mobile-number-1',
    invalidValue: '',
    validValue: '9876543210',
    trigger: 'blur',
    detection: 'error',
    warningMessage: 'Mobile: required.',
  });
  assert.match(script, /__hasVisibleValidationError\(errorText\)/);
  assert.match(script, /invalidState\.ariaInvalid/);
  assert.match(script, /invalidState\.nativeInvalid/);
  assert.match(script, /if \(!inputRejected && !/);
  assert.doesNotMatch(script, /__beforeUrl/);
  assert.doesNotMatch(script, /__fieldWasVisible/);
});

test('compileFieldScriptFromPlan with trigger emits page/field unchanged fallback', () => {
  const script = compileFieldScriptFromPlan(
    mobileField,
    {
      fieldId: 'mobile-number-1',
      invalidValue: '',
      validValue: '9876543210',
      trigger: 'submit',
      detection: 'error',
      warningMessage: 'Mobile: required.',
    },
    {
      label: 'Next',
      locatorCandidates: ['#next'],
      clickScriptLine: "await page.locator('#next').click();",
    },
  );
  assert.match(script, /const __beforeUrl = page\.url\(\);/);
  assert.match(script, /const __fieldWasVisible = await page\.locator\("#mobile"\)\.isVisible/);
  assert.match(script, /__beforeUrl === page\.url\(\)/);
  assert.match(script, /await clickValidationTrigger\(\);/);
  assert.match(script, /__hasVisibleValidationError\(errorText\)/);
});

test('buildValidatorStepScript injects visible validation error helper', () => {
  const script = buildValidatorStepScript({
    mode: 'autoFill',
    restoreAfterValidate: false,
    fields: [{ ...mobileField, scriptText: "warn('check');" }],
  });
  assert.match(script, /const __hasVisibleValidationError = async \(errorText\) => \{/);
  assert.match(script, /getByRole\('alert'\)/);
  assert.match(script, /required\|invalid\|must be/);
});
