// Role selector helper test suite (standalone, no framework)
// Run: node app/functions/_lib/__tests__/role-selector.test.mjs
//
// The dropdown itself is DOM-bound and verified manually; these cover the
// pure pieces the fix extracted so they stay testable: the suggestion
// filter, the match highlighting (with HTML escaping), and the category
// label. Keyboard navigation and positioning live in the browser component.

import assert from 'node:assert/strict';
import {
  filterRoles,
  escapeHtmlText,
  highlightRoleMatch,
  prettyCategory
} from '../../../../js/role-selector.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

const ROLES = [
  { name: 'Software Engineer', category: 'software_engineering' },
  { name: 'Product Manager', category: 'product_management' },
  { name: 'Product Owner', category: 'product_management' },
  { name: 'Data Engineer', category: 'data_engineering' },
  { name: 'Machine Learning Engineer', category: 'ml_engineering' }
];

test('filterRoles matches case-insensitive substrings anywhere in the name', () => {
  assert.deepEqual(filterRoles(ROLES, 'product', 8).map((r) => r.name),
    ['Product Manager', 'Product Owner']);
  assert.deepEqual(filterRoles(ROLES, 'ENGINEER', 8).map((r) => r.name),
    ['Software Engineer', 'Data Engineer', 'Machine Learning Engineer']);
  assert.deepEqual(filterRoles(ROLES, 'learning', 8).map((r) => r.name),
    ['Machine Learning Engineer']);
});

test('filterRoles caps at maxResults', () => {
  assert.equal(filterRoles(ROLES, 'engineer', 2).length, 2);
});

test('filterRoles tolerates junk input without throwing', () => {
  assert.deepEqual(filterRoles(ROLES, '', 8), []);
  assert.deepEqual(filterRoles(ROLES, '   ', 8), []);
  assert.deepEqual(filterRoles(null, 'product', 8), []);
  assert.deepEqual(filterRoles([{ nope: true }, null], 'product', 8), []);
});

test('highlightRoleMatch wraps the matched span in <strong>', () => {
  assert.equal(highlightRoleMatch('Product Manager', 'duct'),
    'Pro<strong>duct</strong> Manager');
  // Case preserved from the role name, matched case-insensitively
  assert.equal(highlightRoleMatch('Product Manager', 'PRODUCT'),
    '<strong>Product</strong> Manager');
});

test('highlightRoleMatch escapes HTML in both role text and query', () => {
  // A role name containing markup-significant characters renders inert
  assert.equal(highlightRoleMatch('R&D <Lead>', 'lead'),
    'R&amp;D &lt;<strong>Lead</strong>&gt;');
  // A query that matches nothing still comes back fully escaped
  assert.equal(highlightRoleMatch('<script>alert(1)</script>', 'zzz'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtmlText covers the five specials and rejects non-strings', () => {
  assert.equal(escapeHtmlText(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtmlText(null), '');
  assert.equal(escapeHtmlText(42), '');
});

test('prettyCategory turns snake_case into readable text', () => {
  assert.equal(prettyCategory('software_engineering'), 'software engineering');
  assert.equal(prettyCategory('general'), 'general');
  assert.equal(prettyCategory(null), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
