import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSavedProject } from '../src/lib/projectStorage.js';

test('saved project normalization rejects malformed project roots', () => {
  assert.equal(normalizeSavedProject(null), null);
  assert.equal(normalizeSavedProject([]), null);
  assert.equal(normalizeSavedProject({ units: {} }), null);
});

test('saved project normalization preserves valid data and repairs unsafe records', () => {
  const project = normalizeSavedProject({
    name: 42,
    customer: null,
    units: [
      null,
      { id: 'duplicate', type: 'lower', name: 'یونیت سالم', width: '80', depth: 58, height: 73.4, parts: { bottom: 1 } },
      { id: 'duplicate', type: 'lower', width: 90, depth: 58, height: 73.4 },
      { id: 'unknown', type: 'remote' },
      { id: 'drawer-1', type: 'drawer', name: 'کشو', count: '2', width: 90, depth: 50, height: 50, parts: 'invalid' }
    ]
  });

  assert.equal(project.name, 'پروژه بدون نام');
  assert.equal(project.customer, '');
  assert.equal(project.units.length, 3);
  assert.equal(project.units[0].name, 'یونیت سالم');
  assert.equal(project.units[0].width, '80');
  assert.equal(project.units[0].parts.sides, 2);
  assert.notEqual(project.units[0].id, project.units[1].id);
  assert.equal(project.units[2].count, '2');
  assert.equal('parts' in project.units[2], false);
});
