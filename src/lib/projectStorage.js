import { createDefaultUnit } from '../data/sampleProject.js';

const UNIT_TYPES = new Set(['lower', 'upper', 'drawer']);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function storedScalar(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value;
  return fallback;
}

function normalizeUnit(value, index, usedIds) {
  if (!isRecord(value) || !UNIT_TYPES.has(value.type)) return null;

  const defaults = createDefaultUnit(value.type, index + 1);
  let id = typeof value.id === 'string' && value.id.trim() ? value.id : defaults.id;
  if (usedIds.has(id)) id = `${defaults.id}-${index}`;
  while (usedIds.has(id)) id = `${id}-${index}`;
  usedIds.add(id);

  const normalized = {
    ...defaults,
    ...value,
    id,
    type: value.type,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : defaults.name
  };
  const numericFields = value.type === 'drawer'
    ? ['count', 'width', 'depth', 'height']
    : value.type === 'lower'
      ? ['quantity', 'width', 'depth', 'height', 'shelfDepth', 'railWidth', 'doorHeight']
      : ['quantity', 'width', 'depth', 'height', 'bottomDepth', 'doorHeight'];

  for (const key of numericFields) normalized[key] = storedScalar(value[key], defaults[key]);

  if (value.type !== 'drawer') {
    const sourceParts = isRecord(value.parts) ? value.parts : {};
    normalized.parts = Object.fromEntries(Object.entries(defaults.parts).map(([key, fallback]) => {
      const part = sourceParts[key];
      return [key, part === null || typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part)) ? part : fallback];
    }));
    normalized.autoDoors = typeof value.autoDoors === 'boolean' ? value.autoDoors : defaults.autoDoors;
  } else {
    delete normalized.parts;
    delete normalized.autoDoors;
  }
  return normalized;
}

export function normalizeSavedProject(value) {
  if (!isRecord(value) || !Array.isArray(value.units)) return null;

  const usedIds = new Set();
  const units = value.units
    .map((unit, index) => normalizeUnit(unit, index, usedIds))
    .filter(Boolean);

  return {
    ...value,
    id: typeof value.id === 'string' && value.id.trim() ? value.id : `project-${Date.now()}`,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : 'پروژه بدون نام',
    customer: typeof value.customer === 'string' ? value.customer : '',
    notes: typeof value.notes === 'string' ? value.notes : '',
    sourceFile: typeof value.sourceFile === 'string' ? value.sourceFile : '',
    units
  };
}
