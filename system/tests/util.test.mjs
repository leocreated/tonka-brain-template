// isInside decides containment by whole path segments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isInside } from '../lib/util.mjs';

const root = path.resolve('/brain root/repo');

test('children are inside, including names that start with dots', () => {
  for (const rel of ['', 'a', 'a/b', '..export', '...export', '..export/nested', 'a/..b', '.. x', '..\u2026']) {
    assert.equal(isInside(root, path.join(root, rel)), true, rel || '(itself)');
  }
});

test('the parent, siblings, traversal and other roots are outside', () => {
  for (const p of [
    path.dirname(root),
    path.join(root, '..'),
    path.join(root, '..', 'repo2'),
    path.join(root, '..', '..export'),
    path.join(root, 'a', '..', '..', 'x'),
    path.resolve('/elsewhere'),
    root + 'x',
  ]) {
    assert.equal(isInside(root, p), false, p);
  }
});

test('a different drive is outside on Windows', { skip: process.platform !== 'win32' }, () => {
  const other = root.startsWith('Z:') ? 'Y:\brain' : 'Z:\brain';
  assert.equal(isInside(root, other), false);
});
