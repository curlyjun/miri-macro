const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const page = fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'index.html'),
  'utf8',
);

test('uses the documented Apple-inspired page shell and design tokens', () => {
  assert.match(page, /class="global-nav"/);
  assert.match(page, /class="sub-nav"/);
  assert.match(page, /--blue:\s*#0066cc/);
  assert.match(page, /--dark-link:\s*#2997ff/);
  assert.match(page, /backdrop-filter:\s*blur\(/);
  assert.doesNotMatch(page, /box-shadow:\s*(?!none)/);
});

test('keeps generated booking targets accessible and stylistically isolated', () => {
  assert.match(page, /card\.className = 'target-surface'/);
  assert.match(page, /aria-label="예약 대상 삭제"/);
  assert.match(page, /target-surface:nth-child\(even\)/);
  assert.match(page, /@media \(max-width:\s*640px\)/);
  assert.match(page, /\.seat-btn\.selected/);
});
