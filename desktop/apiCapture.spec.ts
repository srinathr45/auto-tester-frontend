import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignOccurrences,
  findMatchingCall,
  matchKey,
  nextApiListenTarget,
  parseBody,
  previousNonLoopNode,
  shouldCaptureNetwork,
  toRuntimeBinding,
  urlPatternFromUrl,
  formatApiCheckError,
  type CapturedApiCall,
} from './apiCapture.ts';
import type { FlowNode } from './types.ts';

test('shouldCaptureNetwork keeps xhr and fetch and skips OPTIONS', () => {
  assert.equal(shouldCaptureNetwork('xhr', 'POST'), true);
  assert.equal(shouldCaptureNetwork('fetch', 'GET'), true);
  assert.equal(shouldCaptureNetwork('xhr', 'OPTIONS'), false);
  assert.equal(shouldCaptureNetwork('script', 'GET'), false);
  assert.equal(shouldCaptureNetwork('image', 'GET'), false);
});

test('urlPatternFromUrl drops origin and query', () => {
  assert.equal(urlPatternFromUrl('https://app.example/api/users?x=1'), '/api/users');
  assert.equal(urlPatternFromUrl('https://app.example/'), '/');
  assert.equal(urlPatternFromUrl('/relative/path?q=1'), '/relative/path');
});

test('assignOccurrences stamps duplicate method+path calls', () => {
  const stamped = assignOccurrences([
    {
      id: '',
      method: 'POST',
      url: 'https://x/save',
      urlPattern: '/save',
      status: 200,
    },
    {
      id: '',
      method: 'POST',
      url: 'https://x/save',
      urlPattern: '/save',
      status: 201,
    },
    {
      id: '',
      method: 'GET',
      url: 'https://x/save',
      urlPattern: '/save',
      status: 200,
    },
  ]);
  assert.equal(stamped[0].occurrence, 1);
  assert.equal(stamped[1].occurrence, 2);
  assert.equal(stamped[2].occurrence, 1);
  assert.equal(stamped[1].id, 'POST:/save:2');
});

test('findMatchingCall uses occurrence among the same method and path', () => {
  const live: CapturedApiCall[] = assignOccurrences([
    {
      id: '',
      method: 'POST',
      url: 'https://x/save?a=1',
      urlPattern: '/save',
      status: 200,
      responseBody: '{"n":1}',
    },
    {
      id: '',
      method: 'POST',
      url: 'https://x/save?a=2',
      urlPattern: '/save',
      status: 201,
      responseBody: '{"n":2}',
    },
  ]);
  const second = findMatchingCall(
    { method: 'POST', urlPattern: '/save', occurrence: 2 },
    live,
  );
  assert.equal(second?.status, 201);
  assert.equal(findMatchingCall({ method: 'GET', urlPattern: '/save', occurrence: 1 }, live), undefined);
});

test('toRuntimeBinding parses JSON bodies', () => {
  const binding = toRuntimeBinding({
    id: 'POST:/orders:1',
    method: 'POST',
    url: 'https://x/orders',
    urlPattern: '/orders',
    status: 201,
    requestBody: '{"amount":10}',
    responseBody: '{"id":"abc"}',
    occurrence: 1,
  });
  assert.equal(binding.ok, true);
  assert.deepEqual(binding.request.body, { amount: 10 });
  assert.deepEqual(binding.response.body, { id: 'abc' });
  assert.equal(matchKey('post', '/orders'), 'POST /orders');
  assert.equal(parseBody('not-json'), 'not-json');
});

test('previousNonLoopNode skips loop steps', () => {
  const nodes: FlowNode[] = [
    { id: 'a', data: { stepKind: 'script', scriptText: 'a' } },
    { id: 'loop', data: { stepKind: 'loop', scriptText: 'back' } },
    { id: 'check', data: { stepKind: 'apiValidate' } },
  ];
  const previous = previousNonLoopNode(nodes, 'check');
  assert.equal(previous?.id, 'a');
  assert.equal(previousNonLoopNode(nodes, 'a'), null);
});

test('nextApiListenTarget only matches the immediate next API check', () => {
  const nodes: FlowNode[] = [
    { id: 'a', data: { stepKind: 'script', scriptText: 'a' } },
    {
      id: 'check',
      data: {
        stepKind: 'apiValidate',
        apiValidate: {
          apis: [
            {
              api: {
                id: 'POST:/x:1',
                method: 'POST',
                url: 'https://x/x',
                urlPattern: '/x',
                status: 200,
              },
              alias: 'api1',
              rule: 'ok',
            },
          ],
        },
      },
    },
    { id: 'b', data: { stepKind: 'script', scriptText: 'b' } },
  ];
  assert.equal(nextApiListenTarget(nodes, 0, new Set()).id, 'check');
  assert.equal(nextApiListenTarget(nodes, 1, new Set()), undefined);
});

test('formatApiCheckError labels missing calls vs content mismatches', () => {
  assert.equal(
    formatApiCheckError('API not found: api1 POST /users'),
    'API not found: api1 POST /users',
  );
  assert.match(
    formatApiCheckError('API check did not see api2 GET /items'),
    /^API not found:/,
  );
  assert.equal(
    formatApiCheckError('Expected 200, received 404'),
    'API error: Expected 200, received 404',
  );
  assert.equal(
    formatApiCheckError('API error: body.id mismatch'),
    'API error: body.id mismatch',
  );
});
