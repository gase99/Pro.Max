import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDimension, formatNumber } from '../src/lib/format.js';

test('display formatting accepts Persian and Arabic number input', () => {
  assert.equal(formatNumber('۷۳٫۴'), '۷۳٫۴');
  assert.equal(formatNumber('١٢٣٫٤'), '۱۲۳٫۴');
  assert.equal(formatNumber('1,234.56'), '۱٬۲۳۴٫۵۶');
});

test('display formatting handles precision, invalid values, and dimensions', () => {
  assert.equal(formatNumber('12.345', 1), '۱۲٫۳');
  assert.equal(formatNumber('not a number'), '—');
  assert.equal(formatDimension('۷۳٫۴'), '۷۳٫۴ cm');
  assert.equal(formatDimension(''), '—');
});
