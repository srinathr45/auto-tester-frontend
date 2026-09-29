import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeCssClass, pickBestCssClasses } from './cssClassUtil.ts';

test('rejects Tailwind variant / slash classes', () => {
  assert.equal(isSafeCssClass('dark:aria-invalid:ring-destructive/40'), false);
  assert.equal(isSafeCssClass('hover:bg-primary'), false);
  assert.equal(isSafeCssClass('ring-destructive/40'), false);
  assert.equal(isSafeCssClass('form-select-option'), true);
  assert.equal(isSafeCssClass('registry-search-clear'), true);
});

test('pickBestCssClasses never returns unsafe Tailwind classes', () => {
  const picked = pickBestCssClasses(
    'inline-flex dark:aria-invalid:ring-destructive/40 form-select-option text-sm',
  );
  assert.deepEqual(picked, ['form-select-option']);
  assert.ok(!picked.some((c) => c.includes(':') || c.includes('/')));
});
