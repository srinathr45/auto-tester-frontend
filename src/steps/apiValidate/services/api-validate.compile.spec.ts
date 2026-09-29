import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiValidateItem, CapturedApiCall } from '../../../shared/types.ts';
import {
  apiAlias,
  applyApiGenerationResults,
  compileCombinedApiScripts,
  refreshApiValidateScripts,
  rematchSelectedApis,
  withReassignedAliases,
} from './api-validate.compile.ts';

const call = (id: string, path: string, occurrence = 1): CapturedApiCall => ({
  id,
  method: 'POST',
  url: `https://example.test${path}`,
  urlPattern: path,
  status: 200,
  occurrence,
});

const item = (
  api: CapturedApiCall,
  alias: string,
  scriptText = '',
): ApiValidateItem => ({
  api,
  alias,
  rule: '',
  scriptMode: 'ai',
  scriptText,
});

test('apiAlias is 1-based', () => {
  assert.equal(apiAlias(0), 'api1');
  assert.equal(apiAlias(2), 'api3');
});

test('compileCombinedApiScripts joins without wrapping braces', () => {
  const script = compileCombinedApiScripts([
    item(call('a', '/a'), 'api1', 'const created = api1.response.body;'),
    item(call('b', '/b'), 'api2', ''),
    item(call('c', '/c'), 'api3', 'expect(api3.status).toBe(200);'),
  ]);
  assert.equal(
    script,
    'const created = api1.response.body;\n\nexpect(api3.status).toBe(200);',
  );
  assert.doesNotMatch(script, /^\s*\{/m);
});

test('withReassignedAliases numbers selected APIs in order', () => {
  const apis = withReassignedAliases([
    item(call('a', '/a'), ''),
    item(call('b', '/b'), 'old'),
  ]);
  assert.equal(apis[0].alias, 'api1');
  assert.equal(apis[1].alias, 'api2');
});

test('refreshApiValidateScripts writes combined scriptText', () => {
  const refreshed = refreshApiValidateScripts({
    capturedApis: [call('a', '/a'), call('b', '/b')],
    apis: [
      item(call('a', '/a'), '', 'const created = api1.response.body;'),
      item(call('b', '/b'), '', 'expect(api2.status).toBe(200);'),
    ],
  });
  assert.equal(refreshed.config.apis?.[0].alias, 'api1');
  assert.match(refreshed.scriptText, /const created/);
  assert.match(refreshed.scriptText, /expect\(api2.status\)/);
});

test('rematchSelectedApis keeps scripts after recapture by method+path+occurrence', () => {
  const previous = [
    item(call('POST:/old:1', '/users', 1), 'api1', 'expect(api1.status).toBe(200);'),
  ];
  const captured = [call('POST:/users:1', '/users', 1)];
  const rematched = rematchSelectedApis(captured, previous);
  assert.equal(rematched.length, 1);
  assert.equal(rematched[0].api.id, 'POST:/users:1');
  assert.equal(rematched[0].scriptText, 'expect(api1.status).toBe(200);');
});

test('applyApiGenerationResults skips manual cards', () => {
  const apis: ApiValidateItem[] = [
    { ...item(call('a', '/a'), 'api1', 'manual()'), scriptMode: 'manual' },
    { ...item(call('b', '/b'), 'api2'), scriptMode: 'ai' },
  ];
  const next = applyApiGenerationResults(apis, [
    { alias: 'api1', scriptText: 'should-not-apply()' },
    { alias: 'api2', scriptText: 'expect(api2.status).toBe(201);' },
  ]);
  assert.equal(next[0].scriptText, 'manual()');
  assert.equal(next[1].scriptText, 'expect(api2.status).toBe(201);');
});
