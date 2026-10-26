import { parseNumber } from './engine.js';

const numberFormatters = new Map();

export function formatNumber(value, decimals = 2) {
  const number = parseNumber(value, Number.NaN);
  if (!Number.isFinite(number)) return '—';

  const precision = Math.max(0, Math.min(6, Math.floor(parseNumber(decimals, 2))));
  let formatter = numberFormatters.get(precision);
  if (!formatter) {
    formatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: precision });
    numberFormatters.set(precision, formatter);
  }
  return formatter.format(number);
}

export function formatDimension(value) {
  const formatted = formatNumber(value);
  return formatted === '—' ? formatted : `${formatted} cm`;
}
