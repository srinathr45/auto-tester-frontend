import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseSliceHtml,
  HTML_SLICE_MAX,
  joinHtmlSlices,
  matchesHint,
  rankCatalogItem,
  selectCatalogMatches,
  type HtmlCatalogItem,
  type HtmlLocateHint,
} from './htmlNormalizer.ts';

const hint: HtmlLocateHint = {
  action: 'click',
  tags: ['button', 'a', 'input'],
  roles: ['button', 'link'],
  namePattern: 'update',
};

function item(partial: Partial<HtmlCatalogItem> & Pick<HtmlCatalogItem, 'id' | 'name'>): HtmlCatalogItem {
  return {
    tag: 'button',
    role: 'button',
    scope: 'main',
    htmlSize: 80,
    ...partial,
  };
}

test('matchesHint requires tag, role, and name substring', () => {
  assert.equal(matchesHint(item({ id: 'c1', name: 'Update settings' }), hint), true);
  assert.equal(matchesHint(item({ id: 'c2', name: 'Cancel' }), hint), false);
  assert.equal(
    matchesHint(item({ id: 'c3', tag: 'div', role: 'button', name: 'Update' }), hint),
    false,
  );
});

test('selectCatalogMatches prefers main/form over nav', () => {
  const nav = item({ id: 'c1', name: 'Update', scope: 'nav Sidebar' });
  const main = item({ id: 'c2', name: 'Update', scope: 'form Account' });
  const picked = selectCatalogMatches([nav, main], hint);
  assert.equal(picked[0]?.id, 'c2');
  assert.ok(rankCatalogItem(main, hint) < rankCatalogItem(nav, hint));
});

test('selectCatalogMatches drops scopeHint when it matches nothing', () => {
  const picked = selectCatalogMatches(
    [item({ id: 'c1', name: 'Update', scope: 'main' })],
    { ...hint, scopeHint: 'dialog' },
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.id, 'c1');
});

test('chooseSliceHtml uses a small parent and falls back to the control', () => {
  const control = '<button>Update</button>';
  const parent = `<form>${control}</form>`;
  assert.equal(chooseSliceHtml(control, parent, 200), parent);
  const hugeParent = `<form>${'x'.repeat(500)}</form>`;
  assert.equal(chooseSliceHtml(control, hugeParent, 200), control);
});

test('joinHtmlSlices returns empty markup when over cap unless clipping is allowed', () => {
  const big = 'a'.repeat(HTML_SLICE_MAX + 10);
  assert.deepEqual(joinHtmlSlices([big], HTML_SLICE_MAX, false), {
    htmlElements: '',
    overCap: true,
  });
  const clipped = joinHtmlSlices([big], HTML_SLICE_MAX, true);
  assert.equal(clipped.overCap, true);
  assert.equal(clipped.htmlElements.length, HTML_SLICE_MAX);
});
