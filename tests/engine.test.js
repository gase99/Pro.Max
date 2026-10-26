import test from 'node:test';
import assert from 'node:assert/strict';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList, getDoorCount, getProjectStats, getProjectWarnings, parseNumber, summarizeMaterials } from '../src/lib/engine.js';

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

test('localized number parsing handles Persian/Arabic digits and common separators', () => {
  assert.equal(parseNumber('۷۳٫۴'), 73.4);
  assert.equal(parseNumber('١٢٣٫٤'), 123.4);
  assert.equal(parseNumber('۱٬۲۳۴٫۵'), 1234.5);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('73,4'), 73.4);
  assert.equal(parseNumber('٧٣،٤'), 73.4);
  assert.equal(parseNumber('1,234'), 1234);
  assert.equal(parseNumber('12 cm', -1), -1);
});

test('project summary counts physical cabinets and drawers, including repeated quantities', () => {
  const units = sample.units.map((unit) => {
    if (unit.id === 'sample-lower-1') return { ...unit, quantity: 3 };
    if (unit.id === 'sample-upper-1') return { ...unit, quantity: 2 };
    if (unit.type === 'drawer') return { ...unit, count: 3 };
    return unit;
  });
  const stats = getProjectStats(units);
  assert.equal(stats.lowerCount, 13);
  assert.equal(stats.upperCount, 21);
  assert.equal(stats.unitCount, 34);
  assert.equal(stats.drawerSetCount, 1);
  assert.equal(stats.drawerCount, 3);
});

test('warnings catch invalid formulas, counts, and malformed rows without crashing', () => {
  const warnings = getProjectWarnings([
    null,
    { id: 'short-lower', type: 'lower', name: 'زمینی نامعتبر', width: 3, depth: 0, height: 0, quantity: 0, shelfDepth: 0, railWidth: 0, doorHeight: 0, autoDoors: false, parts: { shelf: 1, rail: 1, doors: 20 } },
    { id: 'short-upper', type: 'upper', name: 'هوایی نامعتبر', width: 80, depth: 35, height: 0.5, bottomDepth: 0, doorHeight: 0, quantity: 1, autoDoors: true, parts: { bottom: 1, back: 1 } },
    { id: 'short-drawer', type: 'drawer', name: 'کشوی نامعتبر', count: 1, width: 50, depth: 50, height: 15 },
    { id: 'unknown', type: 'other', name: 'نوع ناشناخته' }
  ]);
  assert.ok(warnings.some((item) => item.message.includes('اطلاعات این ردیف معتبر نیست')));
  assert.ok(warnings.some((item) => item.message.includes('تعداد یونیت مشابه')));
  assert.ok(warnings.some((item) => item.message.includes('ابعاد درب')));
  assert.ok(warnings.some((item) => item.message.includes('ارتفاع پشت‌بند')));
  assert.ok(warnings.some((item) => item.message.includes('عمق کف')));
  assert.ok(warnings.some((item) => item.message.includes('قطعه‌ی پشت')));
  assert.ok(warnings.some((item) => item.message.includes('نوع یونیت ناشناخته')));
  assert.deepEqual(buildCutList([null, {}, 'invalid']), []);
});

test('material summaries ignore malformed values and do not concatenate numeric strings', () => {
  const [summary] = summarizeMaterials([
    { material: 'MDF', quantity: '2', areaM2: '1.25', edgeTapeCm: '20' },
    null,
    { material: '', quantity: 100, areaM2: 100, edgeTapeCm: 100 }
  ]);
  assert.deepEqual(summary, { material: 'MDF', pieces: 2, areaM2: 1.25, edgeTapeCm: 20, lineCount: 1 });
});
