const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('viewer renders grouped choices and interactive local repeater controls', () => {
  const viewer = fs.readFileSync(path.join(__dirname, '../../viewer/index.html'), 'utf8');
  assert.match(viewer, /function choicePreview/);
  assert.match(viewer, /type=\"\$\{kind\}\"/);
  assert.doesNotMatch(viewer, /type=\"\$\{kind\}\" disabled/);
  assert.match(viewer, /function repeaterPreview/);
  assert.match(viewer, /Detected nested fields/);
  assert.match(viewer, /unclassified controls/);
  assert.match(viewer, /data-repeat/);
  assert.match(viewer, /input type=\"file\"/);
  assert.match(viewer, /phone_composite/);
});

test('viewer renders option-capture completion evidence for select controls', () => {
  const viewer = fs.readFileSync(path.join(__dirname, '../../viewer/index.html'), 'utf8');
  assert.match(viewer, /option_capture/);
  assert.match(viewer, /discovered_count/);
  assert.match(viewer, /incomplete_reason/);
  assert.match(viewer, /Options captured/);
});
