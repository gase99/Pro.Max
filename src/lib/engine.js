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
  const normalized = String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
    .replace(/,/g, '.')
    .replace(/\s/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const readDimension = (unit, key, fallback = 0) => parseNumber(unit?.[key], fallback);
const positive = (value) => Math.max(0, Number.isFinite(value) ? value : 0);

function readCount(unit, key, fallback = 0) {
  const value = unit?.parts?.[key];
  if (value === null || value === undefined || value === '') return fallback;
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

  for (const unit of units) {
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
  for (const row of cutList) {
    const current = groups.get(row.material) || {
      material: row.material,
      pieces: 0,
      areaM2: 0,
      edgeTapeCm: 0,
      lineCount: 0
    };
    current.pieces += row.quantity;
    current.areaM2 += row.areaM2;
    current.edgeTapeCm += row.edgeTapeCm;
    current.lineCount += 1;
    groups.set(row.material, current);
  }
  return [...groups.values()].sort((a, b) => b.areaM2 - a.areaM2);
}

export function getProjectWarnings(units = []) {
  const warnings = [];
  for (const unit of units) {
    const add = (message) => warnings.push({ id: `${unit.id}-${message}`, unitName: unit.name, message });
    if (unit.type === 'lower') {
      const width = readDimension(unit, 'width');
      const depth = readDimension(unit, 'depth');
      const height = readDimension(unit, 'height');
      if (width <= WIDTH_CLEARANCE) add('عرض داخلی با کسر ۳٫۲ سانتی‌متر صفر یا منفی می‌شود.');
      if (depth <= 0 || height <= 0) add('عمق یا ارتفاع باید بزرگ‌تر از صفر باشد.');
      if (getDoorCount(unit) === 0) add('تعداد درب خودکار برای این عرض در بازه‌ی ۱۰ تا ۱۵۰ تعریف نشده است.');
    } else if (unit.type === 'upper') {
      const width = readDimension(unit, 'width');
      if (width <= WIDTH_CLEARANCE) add('عرض داخلی با کسر ۳٫۲ سانتی‌متر صفر یا منفی می‌شود.');
      if (readDimension(unit, 'depth') <= 3 || readDimension(unit, 'height') <= 0) add('عمق یا ارتفاع برای تولید قطعات کافی نیست.');
      if (getDoorCount(unit) === 0) add('تعداد درب خودکار برای این عرض در بازه‌ی ۱۰ تا ۱۵۰ تعریف نشده است.');
    } else if (unit.type === 'drawer') {
      if (readDimension(unit, 'depth') <= 5) add('عمق کشو پس از کسر ۵ سانتی‌متر، قابل برش نیست.');
      if (readDimension(unit, 'width') <= 9.1) add('عرض کشو پس از کسر ۹٫۱ سانتی‌متر، قابل برش نیست.');
      if (readDimension(unit, 'height') / 3 <= 4) add('ارتفاع کشو برای فرمول بدنه کافی نیست.');
    }
  }
  return warnings;
}

export function getProjectStats(units = [], cutList = buildCutList(units)) {
  const cabinetUnits = units.filter((unit) => unit.type !== 'drawer');
  const drawerUnits = units.filter((unit) => unit.type === 'drawer');
  const materials = summarizeMaterials(cutList);
  const lowerCount = cabinetUnits.filter((unit) => unit.type === 'lower').length;
  const upperCount = cabinetUnits.filter((unit) => unit.type === 'upper').length;
  const drawerCount = drawerUnits.reduce((sum, unit) => sum + readDimension(unit, 'count', 0), 0);
  const pieceCount = cutList.reduce((sum, item) => sum + item.quantity, 0);
  const areaM2 = cutList.reduce((sum, item) => sum + item.areaM2, 0);
  const edgeTapeCm = cutList.reduce((sum, item) => sum + item.edgeTapeCm, 0);
  const thinBoard = cutList.filter((item) => item.material === BACK_BOARD).reduce((sum, item) => sum + item.quantity, 0);

  return {
    unitCount: cabinetUnits.length,
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
