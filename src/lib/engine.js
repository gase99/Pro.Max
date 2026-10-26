export const TYPE_LABELS = {
  lower: 'زمینی',
  upper: 'هوایی',
  drawer: 'کشو'
};

const MAIN_BOARD = 'سفید ۳۶۶';
const BACK_BOARD = 'MDF سه‌میل';
const DOOR_BOARD = 'درب';
const WIDTH_CLEARANCE = 3.2;
const DOOR_GAP = 0.2;

export function parseNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;

  let normalized = String(value)
    .replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10))
    .replace(/[−–]/g, '-')
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/٫/g, '.')
    .replace(/،/g, ',')
    .replace(/٬/g, '');

  const commaCount = (normalized.match(/,/g) || []).length;
  const hasDot = normalized.includes('.');
  if (commaCount && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      // European-style grouping and decimal separators, e.g. 1.234,56.
      normalized = normalized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // English-style grouping and decimal separators, e.g. 1,234.56.
      normalized = normalized.replace(/,/g, '');
    }
  } else if (commaCount === 1) {
    const [integer, fraction] = normalized.split(',');
    const groupedInteger = integer !== '0' && /^[+-]?\d{1,3}$/.test(integer) && /^\d{3}$/.test(fraction);
    normalized = groupedInteger ? `${integer}${fraction}` : `${integer}.${fraction}`;
  } else if (commaCount > 1) {
    if (/^[+-]?\d{1,3}(,\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/,/g, '');
    } else {
      const lastComma = normalized.lastIndexOf(',');
      const integer = normalized.slice(0, lastComma).replace(/,/g, '');
      const fraction = normalized.slice(lastComma + 1);
      normalized = `${integer}.${fraction}`;
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const readDimension = (unit, key, fallback = 0) => {
  const value = unit?.[key];
  if (typeof value === 'string' && value.trim() === '') return 0;
  return parseNumber(value, fallback);
};
const positive = (value) => Math.max(0, Number.isFinite(value) ? value : 0);

function readCount(unit, key, fallback = 0) {
  const value = unit?.parts?.[key];
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return 0;
  return Math.max(0, Math.floor(parseNumber(value, fallback)));
}

export function getDoorCount(unit) {
  if (unit?.autoDoors === false) return readCount(unit, 'doors', 0);
  const width = readNumber(unit?.width);
  if (width >= 10 && width <= 50) return 1;
  if (width > 50 && width <= 100) return 2;
  if (width > 100 && width <= 150) return 3;
  return 0;
}

function readNumber(value) {
  return parseNumber(value, 0);
}

export function buildCutList(units = []) {
  const rows = [];
  const entries = Array.isArray(units) ? units : [];

  const addPart = (unit, key, part, material, width, length, perUnitCount, edgeLengthPerPiece = 0) => {
    const perUnit = Math.max(0, Math.floor(parseNumber(perUnitCount, 0)));
    const unitMultiplier = unit.type === 'drawer'
      ? Math.max(0, Math.floor(readDimension(unit, 'count', 0)))
      : Math.max(0, Math.floor(readDimension(unit, 'quantity', 1)));
    const count = perUnit * unitMultiplier;
    const w = positive(width);
    const l = positive(length);
    if (count <= 0 || w <= 0 || l <= 0) return;
    rows.push({
      id: `${unit.id || unit.name || 'unit'}-${key}`,
      unitId: unit.id || '',
      unitName: unit.name || 'یونیت بدون نام',
      type: unit.type,
      typeLabel: TYPE_LABELS[unit.type] || 'متفرقه',
      key,
      part,
      material,
      width: w,
      length: l,
      quantity: count,
      areaM2: (w * l * count) / 10000,
      edgeTapeCm: positive(edgeLengthPerPiece) * count,
      edgeTapePerPieceCm: positive(edgeLengthPerPiece)
    });
  };

  for (const unit of entries) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) continue;
    if (unit.type === 'lower') {
      const width = readDimension(unit, 'width');
      const depth = readDimension(unit, 'depth');
      const height = readDimension(unit, 'height');
      const shelfDepth = readDimension(unit, 'shelfDepth', depth - 3);
      const railWidth = readDimension(unit, 'railWidth', 7);
      const doorCount = getDoorCount(unit);
      const doorWidth = doorCount ? width / doorCount - DOOR_GAP : 0;
      addPart(unit, 'bottom', 'کف', MAIN_BOARD, depth, width, readCount(unit, 'bottom', 1), width);
      addPart(unit, 'sides', 'بدنه جانبی', MAIN_BOARD, depth, height, readCount(unit, 'sides', 2), height);
      addPart(unit, 'shelf', 'طبقه', MAIN_BOARD, shelfDepth, width - WIDTH_CLEARANCE, readCount(unit, 'shelf', 1), width - WIDTH_CLEARANCE);
      addPart(unit, 'rail', 'قید', MAIN_BOARD, railWidth, width - WIDTH_CLEARANCE, readCount(unit, 'rail', 1), 0);
      addPart(unit, 'back', 'پشت‌بند ۳ میل', BACK_BOARD, width - 1.6, height + 0.8, readCount(unit, 'back', 1), 0);
      addPart(unit, 'doors', 'درب', DOOR_BOARD, doorWidth, readDimension(unit, 'doorHeight', 73.4), doorCount, 0);
    } else if (unit.type === 'upper') {
      const width = readDimension(unit, 'width');
      const depth = readDimension(unit, 'depth');
      const height = readDimension(unit, 'height');
      const bottomDepth = readDimension(unit, 'bottomDepth', depth);
      const innerWidth = width - WIDTH_CLEARANCE;
      const doorCount = getDoorCount(unit);
      const doorWidth = doorCount ? width / doorCount - DOOR_GAP : 0;

      addPart(unit, 'sides', 'بدنه جانبی', MAIN_BOARD, depth, height, readCount(unit, 'sides', 2), depth + height);
      addPart(unit, 'bottom', 'کف', MAIN_BOARD, bottomDepth, innerWidth, readCount(unit, 'bottom', 1), innerWidth);
      addPart(unit, 'top', 'تاق', MAIN_BOARD, depth - 2, innerWidth, readCount(unit, 'top', 1), innerWidth);
      addPart(unit, 'shelf', 'طبقه', MAIN_BOARD, depth - 3, innerWidth, readCount(unit, 'shelf', 1), innerWidth);
      addPart(unit, 'rail', 'قید', MAIN_BOARD, 7, innerWidth, readCount(unit, 'rail', 1), 0);
      addPart(unit, 'back', 'پشت‌بند ۳ میل', BACK_BOARD, width - 1.6, height - 0.8, readCount(unit, 'back', 1), 0);
      addPart(unit, 'doors', 'درب', DOOR_BOARD, doorWidth, readDimension(unit, 'doorHeight', 92), doorCount, 0);
    } else if (unit.type === 'drawer') {
      const depth = readDimension(unit, 'depth');
      const width = readDimension(unit, 'width');
      const height = readDimension(unit, 'height');
      const sideWidth = height / 3 - 4;
      const bodyLength = depth - 5;
      const frontLength = width - 9.1;
      const count = Math.max(0, Math.floor(readDimension(unit, 'count', 1)));

      addPart(unit, 'drawer-sides', 'بدنه کشو', MAIN_BOARD, sideWidth, bodyLength, 2, 0);
      addPart(unit, 'drawer-front', 'جلوی کشو', MAIN_BOARD, sideWidth, frontLength, 1, 0);
      addPart(unit, 'drawer-back', 'پشت کشو', MAIN_BOARD, sideWidth - 2, frontLength, 1, 0);
    }
  }

  return rows;
}

export function summarizeMaterials(cutList = []) {
  const groups = new Map();
  const rows = Array.isArray(cutList) ? cutList : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !String(row.material || '').trim()) continue;
    const material = String(row.material);
    const current = groups.get(material) || {
      material,
      pieces: 0,
      areaM2: 0,
      edgeTapeCm: 0,
      lineCount: 0
    };
    current.pieces += Math.max(0, parseNumber(row.quantity, 0));
    current.areaM2 += Math.max(0, parseNumber(row.areaM2, 0));
    current.edgeTapeCm += Math.max(0, parseNumber(row.edgeTapeCm, 0));
    current.lineCount += 1;
    groups.set(material, current);
  }
  return [...groups.values()].sort((a, b) => b.areaM2 - a.areaM2);
}

export function getProjectWarnings(units = []) {
  const warnings = [];
  const entries = Array.isArray(units) ? units : [];
  for (const [index, unit] of entries.entries()) {
    const unitName = typeof unit?.name === 'string' && unit.name.trim() ? unit.name : 'یونیت بدون نام';
    const unitId = typeof unit?.id === 'string' && unit.id ? unit.id : `unit-${index}`;
    const add = (message) => warnings.push({ id: `${unitId}-${index}-${warnings.length}`, unitName, message });

    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      add('اطلاعات این ردیف معتبر نیست و باید دوباره وارد شود.');
      continue;
    }
    if (!['lower', 'upper', 'drawer'].includes(unit.type)) {
      add('نوع یونیت ناشناخته است و در لیست برش محاسبه نمی‌شود.');
      continue;
    }

    if (unit.type === 'lower' || unit.type === 'upper') {
      const rawQuantity = unit.quantity ?? 1;
      const quantity = parseNumber(rawQuantity, Number.NaN);
      if (!Number.isFinite(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
        add('تعداد یونیت مشابه باید عدد صحیح و دست‌کم ۱ باشد.');
      }
    } else {
      const rawCount = unit.count;
      const count = parseNumber(rawCount, Number.NaN);
      if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
        add('تعداد کشو باید عدد صحیح و دست‌کم ۱ باشد.');
      }
    }

    if (unit.type === 'lower') {
      const width = readDimension(unit, 'width');
      const depth = readDimension(unit, 'depth');
      const height = readDimension(unit, 'height');
      const doorCount = getDoorCount(unit);
      if (width <= WIDTH_CLEARANCE) add('عرض داخلی با کسر ۳٫۲ سانتی‌متر صفر یا منفی می‌شود.');
      if (depth <= 0 || height <= 0) add('عمق یا ارتفاع باید بزرگ‌تر از صفر باشد.');
      if (readCount(unit, 'shelf', 1) > 0 && readDimension(unit, 'shelfDepth', depth - 3) <= 0) add('عمق طبقه باید برای برش بزرگ‌تر از صفر باشد.');
      if (readCount(unit, 'rail', 1) > 0 && readDimension(unit, 'railWidth', 7) <= 0) add('عرض قید باید برای برش بزرگ‌تر از صفر باشد.');
      if (doorCount === 0) add('تعداد درب برای این عرض یا تنظیم دستی تعریف نشده است.');
      if (doorCount > 0 && (readDimension(unit, 'doorHeight', 73.4) <= 0 || width / doorCount <= DOOR_GAP)) add('ابعاد درب برای برش معتبر نیست.');
    } else if (unit.type === 'upper') {
      const width = readDimension(unit, 'width');
      const depth = readDimension(unit, 'depth');
      const doorCount = getDoorCount(unit);
      if (width <= WIDTH_CLEARANCE) add('عرض داخلی با کسر ۳٫۲ سانتی‌متر صفر یا منفی می‌شود.');
      if (depth <= 3 || readDimension(unit, 'height') <= 0) add('عمق یا ارتفاع برای تولید قطعات کافی نیست.');
      if (readCount(unit, 'bottom', 1) > 0 && readDimension(unit, 'bottomDepth', depth) <= 0) add('عمق کف باید برای برش بزرگ‌تر از صفر باشد.');
      if (readCount(unit, 'back', 1) > 0 && readDimension(unit, 'height') <= 0.8) add('ارتفاع پشت‌بند پس از کسر ۰٫۸ سانتی‌متر قابل برش نیست.');
      if (doorCount === 0) add('تعداد درب برای این عرض یا تنظیم دستی تعریف نشده است.');
      if (doorCount > 0 && (readDimension(unit, 'doorHeight', 92) <= 0 || width / doorCount <= DOOR_GAP)) add('ابعاد درب برای برش معتبر نیست.');
    } else {
      const depth = readDimension(unit, 'depth');
      const width = readDimension(unit, 'width');
      const sideWidth = readDimension(unit, 'height') / 3 - 4;
      if (depth <= 5) add('عمق کشو پس از کسر ۵ سانتی‌متر، قابل برش نیست.');
      if (width <= 9.1) add('عرض کشو پس از کسر ۹٫۱ سانتی‌متر، قابل برش نیست.');
      if (sideWidth <= 0) add('ارتفاع کشو برای فرمول بدنه کافی نیست.');
      else if (sideWidth <= 2) add('ارتفاع کشو برای ساخت قطعه‌ی پشت کافی نیست.');
    }
  }
  return warnings;
}

export function getProjectStats(units = [], cutList = buildCutList(units)) {
  const validUnits = Array.isArray(units) ? units.filter((unit) => unit && typeof unit === 'object') : [];
  const validCutList = Array.isArray(cutList) ? cutList.filter((item) => item && typeof item === 'object') : [];
  const cabinetUnits = validUnits.filter((unit) => unit.type === 'lower' || unit.type === 'upper');
  const drawerUnits = validUnits.filter((unit) => unit.type === 'drawer');
  const materials = summarizeMaterials(validCutList);
  const countPhysicalUnits = (type) => cabinetUnits
    .filter((unit) => unit.type === type)
    .reduce((sum, unit) => sum + Math.max(0, Math.floor(readDimension(unit, 'quantity', 1))), 0);
  const lowerCount = countPhysicalUnits('lower');
  const upperCount = countPhysicalUnits('upper');
  const drawerCount = drawerUnits.reduce((sum, unit) => sum + Math.max(0, Math.floor(readDimension(unit, 'count', 0))), 0);
  const pieceCount = validCutList.reduce((sum, item) => sum + Math.max(0, parseNumber(item.quantity, 0)), 0);
  const areaM2 = validCutList.reduce((sum, item) => sum + Math.max(0, parseNumber(item.areaM2, 0)), 0);
  const edgeTapeCm = validCutList.reduce((sum, item) => sum + Math.max(0, parseNumber(item.edgeTapeCm, 0)), 0);
  const thinBoard = validCutList
    .filter((item) => item.material === BACK_BOARD)
    .reduce((sum, item) => sum + Math.max(0, parseNumber(item.quantity, 0)), 0);

  return {
    unitCount: lowerCount + upperCount,
    lowerCount,
    upperCount,
    drawerSetCount: drawerUnits.length,
    drawerCount,
    pieceCount,
    areaM2,
    edgeTapeCm,
    thinBoard,
    materialCount: materials.length,
    materials
  };
}

export function getDefaultPartCount(unit, key) {
  if (key === 'doors') return getDoorCount(unit);
  if (key === 'sides') return 2;
  if (key === 'top' || key === 'bottom' || key === 'shelf' || key === 'rail' || key === 'back') return 1;
  return 0;
}
