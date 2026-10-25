import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList, getDoorCount, getProjectStats, parseNumber } from '../src/lib/engine.js';

const sample = createSampleProject();

test('sample project carries the workbook-scale layout', () => {
  assert.equal(sample.units.filter((unit) => unit.type === 'lower').length, 11);
  assert.equal(sample.units.filter((unit) => unit.type === 'upper').length, 20);
  assert.equal(sample.units.filter((unit) => unit.type === 'drawer').length, 1);
});

test('ground-unit cut dimensions and edge tape follow the Excel rules', () => {
  const unit = sample.units.find((item) => item.id === 'sample-lower-1');
  const rows = buildCutList([unit]);
  const byPart = Object.fromEntries(rows.map((row) => [row.key, row]));

  assert.deepEqual([byPart.bottom.width, byPart.bottom.length, byPart.bottom.quantity], [58, 80, 1]);
  assert.equal(byPart.sides.edgeTapeCm, 146.8);
  assert.deepEqual([byPart.shelf.width, byPart.shelf.length], [55, 76.8]);
  assert.deepEqual([byPart.back.width, byPart.back.length], [78.4, 74.2]);
  assert.deepEqual([byPart.doors.width, byPart.doors.length, byPart.doors.quantity], [39.8, 73.4, 2]);
});

test('upper cabinet and drawer calculations match the workbook formulas', () => {
  const upper = sample.units.find((item) => item.id === 'sample-upper-1');
  const upperParts = Object.fromEntries(buildCutList([upper]).map((row) => [row.key, row]));
  assert.deepEqual([upperParts.sides.width, upperParts.sides.length, upperParts.sides.quantity], [35, 90, 2]);
  assert.equal(upperParts.sides.edgeTapeCm, 250);
  assert.deepEqual([upperParts.back.width, upperParts.back.length], [58.4, 89.2]);
  assert.deepEqual([upperParts.doors.width, upperParts.doors.length, upperParts.doors.quantity], [29.8, 92, 2]);

  const drawer = { ...sample.units.find((item) => item.type === 'drawer'), count: 2 };
  const drawerParts = Object.fromEntries(buildCutList([drawer]).map((row) => [row.key, row]));
  assert.deepEqual([drawerParts['drawer-sides'].width, drawerParts['drawer-sides'].length, drawerParts['drawer-sides'].quantity], [50 / 3 - 4, 45, 4]);
  assert.deepEqual([drawerParts['drawer-front'].length, drawerParts['drawer-front'].quantity], [80.9, 2]);
  assert.deepEqual([drawerParts['drawer-back'].width, drawerParts['drawer-back'].quantity], [50 / 3 - 6, 2]);
});

test('door count thresholds and Persian number input are supported', () => {
  assert.equal(getDoorCount({ width: 50, autoDoors: true }), 1);
  assert.equal(getDoorCount({ width: 80, autoDoors: true }), 2);
  assert.equal(getDoorCount({ width: 120, autoDoors: true }), 3);
  assert.equal(getDoorCount({ width: 170, autoDoors: true }), 0);
  assert.equal(parseNumber('۷۳٫۴'), 73.4);
});

test('project summary includes piece area and tape without claiming sheet counts', () => {
  const rows = buildCutList(sample.units);
  const stats = getProjectStats(sample.units, rows);
  assert.equal(stats.unitCount, 31);
  assert.equal(stats.pieceCount, 262);
  assert.equal(stats.thinBoard, 29);
  assert.ok(stats.areaM2 > 89 && stats.areaM2 < 90);
  assert.ok(stats.edgeTapeCm > 12700 && stats.edgeTapeCm < 12800);
});
