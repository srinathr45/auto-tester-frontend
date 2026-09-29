import assert from 'node:assert/strict';
import test from 'node:test';
import { bracketDepthDelta, injectLineDelays } from './stepScript.ts';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

function assertParsesAsAsyncBody(body: string): void {
  assert.doesNotThrow(() => {
    new AsyncFunction('warn', `let page = null;\n${body}\nreturn page;`);
  });
}

test('bracketDepthDelta ignores braces inside strings', () => {
  assert.equal(bracketDepthDelta('page.locator("{not-a-brace}")'), 0);
  assert.equal(bracketDepthDelta('const x = {'), 1);
  assert.equal(bracketDepthDelta('};'), -1);
});

test('injectLineDelays skips nested object and array lines', () => {
  const script = [
    'const __validatorSnapshot = {',
    '  url: page.url(),',
    '  fields: [',
    "    { kind: 'text', selector: '#a', value: await page.locator('#a').inputValue() },",
    '  ],',
    '};',
    'await __restoreValidatorSnapshot();',
  ].join('\n');
  const injected = injectLineDelays(script, 200);
  assert.doesNotMatch(injected, /fields: \[\nawait new Promise/);
  assert.doesNotMatch(injected, /\{\nawait new Promise/);
  assert.match(injected, /await __restoreValidatorSnapshot\(\)/);
  assertParsesAsAsyncBody(injected);
});

test('injectLineDelays still pauses between top-level statements', () => {
  const script = "await page.click('#one');\nawait page.click('#two');";
  const injected = injectLineDelays(script, 150);
  assert.equal((injected.match(/await new Promise/g) || []).length, 1);
  assertParsesAsAsyncBody(injected);
});

test('injectLineDelays skips lines inside block-scoped field validators', () => {
  const script = [
    '{',
    '// Frontend validation: Email',
    'const errorText = null;',
    'await page.locator("#email").fill("");',
    'await clickValidationTrigger();',
    '}',
    '{',
    '// Frontend validation: Name',
    'await page.locator("#name").fill("");',
    '}',
  ].join('\n');
  const injected = injectLineDelays(script, 100);
  assert.doesNotMatch(injected, /Frontend validation: Email\nawait new Promise/);
  assert.match(injected, /\}\nawait new Promise.*\n\{/);
  assertParsesAsAsyncBody(injected);
});
