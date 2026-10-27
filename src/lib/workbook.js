import { buildCutList, getDoorCount, parseNumber, summarizeMaterials, TYPE_LABELS } from './engine.js';
import { normalizeSavedProject } from './projectStorage.js';

const MAX_WORKBOOK_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_WORKSHEETS = 50;
const MAX_WORKSHEET_ROWS = 10_000;
const MAX_WORKSHEET_COLUMNS = 256;
const MAX_IMPORT_WARNINGS = 20;
const PROJECT_BACKUP_SHEET = 'Pro.Max data';
const PROJECT_BACKUP_MARKER = 'PROMAX_PROJECT_V1';
const PROJECT_SPECIAL_NUMBER_KEY = '__PROMAX_SPECIAL_NUMBER__';
const PROJECT_BACKUP_CHUNK_SIZE = 30_000;
const faDigits = (value) => String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const EXCEL_ERROR_PATTERN = /#(?:REF!|VALUE!|DIV\/0!|NAME\??!?|N\/A!?|NUM!|NULL!|SPILL!|CALC!)/i;
const UNIT_QUANTITY_HEADERS = new Set([
  'تعداد', 'تعداد یونیت', 'تعداد یونیت ها', 'تعداد یونیت مشابه', 'تعداد یونیت های مشابه',
  'تعداد کابینت', 'تعداد کابینت ها', 'تعداد مشابه', 'qty', 'quantity', 'unit qty', 'unit quantity'
]);

function rawCellValue(sheet, row, column) {
  return sheet?.getRow(row)?.getCell(column)?.value;
}

function isBrokenExcelValue(value) {
  if (typeof value === 'string') return EXCEL_ERROR_PATTERN.test(value.trim());
  if (!value || typeof value !== 'object') return false;
  if (typeof value.error === 'string') return isBrokenExcelValue(value.error);
  const hasFormula = Object.prototype.hasOwnProperty.call(value, 'formula')
    || Object.prototype.hasOwnProperty.call(value, 'sharedFormula');
  if (hasFormula) {
    const formula = [value.formula, value.sharedFormula].filter((part) => typeof part === 'string').join(' ');
    if (EXCEL_ERROR_PATTERN.test(formula)) return true;
    if (!Object.prototype.hasOwnProperty.call(value, 'result')) return true;
    if (typeof value.result === 'number' && !Number.isFinite(value.result)) return true;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'result')) return isBrokenExcelValue(value.result);
  return false;
}

function cellValue(sheet, row, column) {
  const value = rawCellValue(sheet, row, column);
  if (isBrokenExcelValue(value)) return Number.NaN;
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((chunk) => chunk.text || '').join('');
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
  }
  return value;
}

function columnLabel(column) {
  let value = column;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function addImportWarning(warnings, message) {
  if (!Array.isArray(warnings) || !message || warnings.includes(message)) return;
  if (warnings.length < MAX_IMPORT_WARNINGS) {
    warnings.push(message);
  } else if (!warnings.includes('هشدارهای بیشتری وجود دارد؛ برای جلوگیری از شلوغی فقط بخشی از آن‌ها نمایش داده می‌شود.')) {
    warnings.push('هشدارهای بیشتری وجود دارد؛ برای جلوگیری از شلوغی فقط بخشی از آن‌ها نمایش داده می‌شود.');
  }
}

function addCellWarning(warnings, sheet, row, column, detail = 'مقدار سلول قابل‌خواندن نیست') {
  const address = `${columnLabel(column)}${row}`;
  addImportWarning(warnings, `${detail} (شیت «${sheet?.name || ''}»، سلول ${address}).`);
}

function cellNumber(sheet, row, column, fallback = 0, warnings = [], warnOnInvalid = false) {
  const raw = rawCellValue(sheet, row, column);
  if (isBrokenExcelValue(raw)) {
    addCellWarning(warnings, sheet, row, column, 'ارجاع یا فرمول Excel خراب است؛ مقدار به‌صورت NaN نگه‌داری شد');
    return Number.NaN;
  }
  const value = cellValue(sheet, row, column);
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseNumber(value, Number.NaN);
  if (Number.isFinite(parsed)) return parsed;
  if (warnOnInvalid) addCellWarning(warnings, sheet, row, column, 'مقدار عددی معتبر نیست؛ مقدار به‌صورت NaN نگه‌داری شد');
  return warnOnInvalid ? Number.NaN : fallback;
}

function safeCount(sheet, row, column, fallback = 0, warnings = []) {
  const raw = rawCellValue(sheet, row, column);
  if (isBrokenExcelValue(raw)) {
    addCellWarning(warnings, sheet, row, column, 'ارجاع یا فرمول Excel خراب است؛ تعداد صفر در نظر گرفته شد');
    return 0;
  }
  const value = cellValue(sheet, row, column);
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = parseNumber(value, Number.NaN);
  if (!Number.isFinite(parsed) || parsed < 0) {
    addCellWarning(warnings, sheet, row, column, 'تعداد معتبر نیست؛ تعداد صفر در نظر گرفته شد');
    return 0;
  }
  return Math.floor(parsed);
}

function auditFormulaReferences(workbook, warnings) {
  let unresolvedCrossSheet = 0;
  let unresolvedLocal = 0;
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => {
      const raw = cell.value;
      if (!raw || typeof raw !== 'object') return;
      const formula = [raw.formula, raw.sharedFormula].filter((part) => typeof part === 'string').join(' ');
      if (!formula || !isBrokenExcelValue(raw)) return;
      if (formula.includes('!')) unresolvedCrossSheet += 1;
      else unresolvedLocal += 1;
    }));
  }
  if (unresolvedCrossSheet > 0) {
    addImportWarning(warnings, `${faDigits(unresolvedCrossSheet)} ارجاع فرمولی بین‌شیتی نتیجه‌ی ذخیره‌شده ندارد؛ این فرمول‌های تحلیلی نادیده گرفته می‌شوند تا محاسبه‌ی پروژه با داده‌ی خراب متوقف نشود.`);
  }
  if (unresolvedLocal > 0) {
    addImportWarning(warnings, `${faDigits(unresolvedLocal)} فرمول در فایل نتیجه‌ی ذخیره‌شده‌ی معتبر ندارد؛ مقادیر نامعتبر هنگام ورود به‌صورت NaN امن نگه‌داری می‌شوند.`);
  }
}

function sheetByName(workbook, name) {
  return workbook.getWorksheet(name)
    || workbook.worksheets.find((sheet) => sheet.name.trim().replace(/\s+/g, ' ') === name);
}

function findUnitQuantityColumn(sheet, type) {
  const partCountColumns = new Set(type === 'lower' ? [4, 6, 8, 10, 12] : [4, 6, 8, 10, 12, 14]);
  const maxRows = Math.min(sheet.rowCount, 10);
  const maxColumns = Math.min(sheet.columnCount, MAX_WORKSHEET_COLUMNS);
  for (let row = 1; row <= maxRows; row += 1) {
    for (let column = 1; column <= maxColumns; column += 1) {
      if (column === 2 || partCountColumns.has(column)) continue;
      const value = cellValue(sheet, row, column);
      if (typeof value !== 'string') continue;
      const header = value.replace(/\u200c/g, ' ').replace(/[\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (UNIT_QUANTITY_HEADERS.has(header) && (header !== 'تعداد' || column === 1)) return column;
    }
  }
  return null;
}

function importCabinetSheet(sheet, type, startIndex = 1, warnings = []) {
  if (!sheet) return [];
  const units = [];
  const quantityColumn = findUnitQuantityColumn(sheet, type);
  let inactiveCount = 0;
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const width = cellNumber(sheet, row, 2, NaN, warnings);
    if (!Number.isFinite(width) || width <= 0) continue;
    const quantity = quantityColumn ? cellNumber(sheet, row, quantityColumn, 1, warnings, true) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0 || Math.floor(quantity) === 0) {
      inactiveCount += 1;
      if (Number.isNaN(quantity) || quantity < 0) {
        addCellWarning(warnings, sheet, row, quantityColumn, 'تعداد یونیت معتبر نیست؛ این ردیف از فهرست متریال حذف شد');
      }
      continue;
    }
    const qtyRow = row + 3;
    const parts = type === 'lower'
      ? {
        bottom: safeCount(sheet, qtyRow, 4, 1, warnings),
        sides: safeCount(sheet, qtyRow, 6, 2, warnings),
        shelf: safeCount(sheet, qtyRow, 8, 1, warnings),
        rail: safeCount(sheet, qtyRow, 10, 1, warnings),
        back: safeCount(sheet, qtyRow, 12, 1, warnings)
      }
      : {
        sides: safeCount(sheet, qtyRow, 4, 2, warnings),
        bottom: safeCount(sheet, qtyRow, 6, 1, warnings),
        top: safeCount(sheet, qtyRow, 8, 1, warnings),
        shelf: safeCount(sheet, qtyRow, 10, 1, warnings),
        rail: safeCount(sheet, qtyRow, 12, 1, warnings),
        back: safeCount(sheet, qtyRow, 14, 1, warnings)
      };
    if (Object.values(parts).every((count) => count === 0)) {
      inactiveCount += 1;
      addImportWarning(warnings, `یونیت ردیف ${faDigits(row)} در شیت «${sheet.name}» همه‌ی تعداد قطعات آن صفر است و از فهرست متریال حذف شد.`);
      continue;
    }
    const index = startIndex + units.length;
    const tag = faDigits(String(index).padStart(2, '0'));
    const unitQuantity = Math.floor(quantity);

    if (type === 'lower') {
      units.push({
        id: `import-lower-${index}-${Date.now()}`,
        type,
        name: `یونیت زمینی ${tag}`,
        quantity: unitQuantity,
        width,
        depth: cellNumber(sheet, row, 3, 58, warnings, true),
        height: cellNumber(sheet, row, 6, 73.4, warnings, true),
        shelfDepth: cellNumber(sheet, row, 7, 55, warnings, true),
        railWidth: cellNumber(sheet, row, 9, 7, warnings, true),
        doorHeight: cellNumber(sheet, row, 14, 73.4, warnings, true),
        autoDoors: true,
        parts: { ...parts, doors: null }
      });
    } else {
      units.push({
        id: `import-upper-${index}-${Date.now()}`,
        type,
        name: `یونیت هوایی ${tag}`,
        quantity: unitQuantity,
        width,
        depth: cellNumber(sheet, row, 3, 35, warnings, true),
        height: cellNumber(sheet, row, 4, 90, warnings, true),
        bottomDepth: cellNumber(sheet, row, 5, 35, warnings, true),
        doorHeight: cellNumber(sheet, row, 16, 92, warnings, true),
        autoDoors: true,
        parts: { ...parts, doors: null }
      });
    }
  }
  if (inactiveCount > 0) {
    addImportWarning(warnings, `در شیت «${sheet.name}»، ${faDigits(inactiveCount)} یونیت با تعداد صفر یا نامعتبر غیرفعال بود و از فهرست متریال حذف شد.`);
  }
  return units;
}

function decodeSpecialNumbers(value) {
  if (!value || typeof value !== 'object') return value;
  if (!Array.isArray(value) && Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, PROJECT_SPECIAL_NUMBER_KEY)) {
    const special = value[PROJECT_SPECIAL_NUMBER_KEY];
    if (special === 'NaN') return Number.NaN;
    if (special === 'Infinity') return Number.POSITIVE_INFINITY;
    if (special === '-Infinity') return Number.NEGATIVE_INFINITY;
  }
  if (Array.isArray(value)) return value.map(decodeSpecialNumbers);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decodeSpecialNumbers(child)]));
}

function restoreSpecialNumbers(target, source) {
  if (typeof source === 'number' && !Number.isFinite(source)) return source;
  if (Array.isArray(source)) {
    if (!Array.isArray(target)) return target;
    return source.map((child, index) => restoreSpecialNumbers(target[index], child));
  }
  if (source && typeof source === 'object') {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return target;
    for (const [key, child] of Object.entries(source)) {
      if (typeof child === 'number' && !Number.isFinite(child)) target[key] = child;
      else if (child && typeof child === 'object') target[key] = restoreSpecialNumbers(target[key], child);
    }
  }
  return target;
}

function readProjectBackup(sheet, warnings) {
  if (cellValue(sheet, 1, 1) !== PROJECT_BACKUP_MARKER) return null;
  const chunks = [];
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const value = cellValue(sheet, row, 1);
    if (value !== null && value !== undefined) chunks.push(String(value));
  }
  try {
    const decoded = decodeSpecialNumbers(JSON.parse(chunks.join('')));
    const project = normalizeSavedProject(decoded);
    if (!project) throw new Error('اطلاعات پروژه در شیت پشتیبان معتبر نیست.');
    const restored = restoreSpecialNumbers(project, decoded);
    return { ...restored, importWarnings: Array.isArray(restored.importWarnings) ? restored.importWarnings : [] };
  } catch {
    addImportWarning(warnings, 'داده‌ی پشتیبان داخل فایل Excel قابل‌بازیابی نبود؛ تلاش برای خواندن شیت‌های معمول ادامه یافت.');
    return null;
  }
}

export async function importWorkbook(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('فایل انتخاب‌شده معتبر نیست.');
  }
  if (file.name && !/\.xlsx$/i.test(file.name)) {
    throw new Error('فقط فایل‌های Excel با پسوند .xlsx پشتیبانی می‌شوند.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('فایل اکسل خالی یا اندازه‌ی آن نامعتبر است.');
  }
  if (file.size > MAX_WORKBOOK_SIZE_BYTES) {
    throw new Error('حجم فایل اکسل نباید بیشتر از ۲۵ مگابایت باشد.');
  }

  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error('ساختار فایل Excel قابل‌خواندن نیست. فایل را در Excel باز و دوباره با فرمت .xlsx ذخیره کنید.');
  }
  if (workbook.worksheets.length > MAX_WORKSHEETS || workbook.worksheets.some((sheet) => (
    sheet.rowCount > MAX_WORKSHEET_ROWS || sheet.columnCount > MAX_WORKSHEET_COLUMNS
  ))) {
    throw new Error('ساختار فایل اکسل بیش از حد بزرگ است؛ تعداد شیت، ردیف یا ستون را کاهش دهید.');
  }

  const importWarnings = [];
  auditFormulaReferences(workbook, importWarnings);
  const backupSheet = workbook.getWorksheet(PROJECT_BACKUP_SHEET);
  const backupProject = backupSheet && readProjectBackup(backupSheet, importWarnings);
  if (backupProject) {
    return {
      ...backupProject,
      importWarnings: [...new Set([...importWarnings, ...(backupProject.importWarnings || [])])]
    };
  }

  const lowerSheet = sheetByName(workbook, 'کابینت زمینی');
  const upperSheet = sheetByName(workbook, 'کابینت هوایی');
  const drawerSheet = sheetByName(workbook, 'کشو');
  if (!lowerSheet && !upperSheet && !drawerSheet) {
    throw new Error('شیت‌های پشتیبانی‌شده‌ی «کابینت زمینی»، «کابینت هوایی» یا «کشو» در فایل پیدا نشدند.');
  }

  const units = [
    ...importCabinetSheet(lowerSheet, 'lower', 1, importWarnings),
    ...importCabinetSheet(upperSheet, 'upper', 1, importWarnings)
  ];

  if (drawerSheet) {
    const count = safeCount(drawerSheet, 4, 2, 0, importWarnings);
    if (count > 0) {
      units.push({
        id: `import-drawer-${Date.now()}`,
        type: 'drawer',
        name: 'مجموعه کشو',
        count,
        depth: cellNumber(drawerSheet, 4, 3, 50, importWarnings, true),
        width: cellNumber(drawerSheet, 4, 4, 90, importWarnings, true),
        height: cellNumber(drawerSheet, 4, 5, 50, importWarnings, true)
      });
    } else {
      addImportWarning(importWarnings, 'شیت «کشو» وجود دارد اما هیچ کشوی فعالی ندارد؛ از فهرست متریال رد شد.');
    }
  }

  if (units.length === 0) {
    addImportWarning(importWarnings, 'یونیت فعالی برای محاسبه پیدا نشد؛ پروژه‌ی خالی وارد شد تا بتوانید داده‌ها را اصلاح کنید.');
  }

  const fileName = file.name || 'فایل Excel';
  return {
    id: `project-${Date.now()}`,
    name: fileName.replace(/\.xlsx$/i, '') || 'پروژه واردشده',
    customer: '',
    notes: 'یونیت‌ها از شیت‌های «کابینت زمینی»، «کابینت هوایی» و «کشو» خوانده شدند. برای اطمینان، ابعاد خروجی را با فایل اصلی تطبیق دهید.',
    sourceFile: fileName,
    createdAt: new Date().toISOString(),
    units,
    importWarnings
  };
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: 'Vazirmatn', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF193D44' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFDCE5E7' } } };
  });
}

function styleBody(sheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.height = 22;
    row.eachCell((cell) => {
      cell.font = { name: 'Vazirmatn', size: 10, color: { argb: 'FF27363A' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE7ECEE' } } };
      if (rowNumber % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8F8' } };
    });
  });
}

function cleanFileName(value) {
  return String(value || 'پروژه ProMax').replace(/[\\/:*?"<>|]/g, '-').trim() || 'پروژه ProMax';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function exportWorkbook(project) {
  const { default: ExcelJS } = await import('exceljs');
  const cutList = buildCutList(project.units || []);
  const materials = summarizeMaterials(cutList);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pro.Max Cabinet Studio';
  workbook.subject = 'لیست برش و خلاصه متریال کابینت';
  workbook.title = project.name || 'Pro.Max';
  workbook.created = new Date();
  workbook.modified = new Date();

  const cuts = workbook.addWorksheet('لیست برش', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  cuts.columns = [
    { header: 'ردیف', key: 'index', width: 8 },
    { header: 'یونیت', key: 'unit', width: 24 },
    { header: 'نوع', key: 'type', width: 12 },
    { header: 'قطعه', key: 'part', width: 20 },
    { header: 'متریال', key: 'material', width: 18 },
    { header: 'عرض', key: 'width', width: 12 },
    { header: 'طول', key: 'length', width: 12 },
    { header: 'تعداد', key: 'quantity', width: 10 },
    { header: 'نوار لبه (cm)', key: 'edge', width: 16 },
    { header: 'مساحت کل (m²)', key: 'area', width: 18 }
  ];
  cutList.forEach((item, index) => cuts.addRow({
    index: index + 1,
    unit: item.unitName,
    type: item.typeLabel,
    part: item.part,
    material: item.material,
    width: round(item.width),
    length: round(item.length),
    quantity: item.quantity,
    edge: round(item.edgeTapeCm),
    area: round(item.areaM2, 3)
  }));
  styleHeader(cuts.getRow(1));
  styleBody(cuts);
  cuts.autoFilter = { from: 'A1', to: `J${Math.max(1, cuts.rowCount)}` };

  const materialSheet = workbook.addWorksheet('خلاصه متریال', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  materialSheet.columns = [
    { header: 'متریال', key: 'material', width: 24 },
    { header: 'تعداد قطعه', key: 'pieces', width: 16 },
    { header: 'مساحت کل (m²)', key: 'area', width: 20 },
    { header: 'نوار لبه (m)', key: 'edge', width: 18 },
    { header: 'تعداد ردیف برش', key: 'lines', width: 20 }
  ];
  materials.forEach((item) => materialSheet.addRow({
    material: item.material,
    pieces: item.pieces,
    area: round(item.areaM2, 3),
    edge: round(item.edgeTapeCm / 100, 2),
    lines: item.lineCount
  }));
  styleHeader(materialSheet.getRow(1));
  styleBody(materialSheet);

  const unitsSheet = workbook.addWorksheet('یونیت‌ها', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  unitsSheet.columns = [
    { header: 'نام یونیت', key: 'name', width: 28 },
    { header: 'نوع', key: 'type', width: 12 },
    { header: 'تعداد', key: 'quantity', width: 10 },
    { header: 'عرض', key: 'width', width: 12 },
    { header: 'عمق', key: 'depth', width: 12 },
    { header: 'ارتفاع', key: 'height', width: 12 },
    { header: 'تعداد درب', key: 'doors', width: 14 },
    { header: 'تعداد طبقه', key: 'shelves', width: 14 }
  ];
  for (const unit of project.units || []) {
    unitsSheet.addRow({
      name: unit.name,
      type: TYPE_LABELS[unit.type] || unit.type,
      quantity: unit.type === 'drawer' ? unit.count : (unit.quantity ?? 1),
      width: round(parseNumber(unit.width, 0)),
      depth: round(parseNumber(unit.depth, 0)),
      height: round(parseNumber(unit.height, 0)),
      doors: unit.type === 'drawer' ? '—' : getDoorCount(unit),
      shelves: unit.type === 'drawer' ? '—' : (unit.parts?.shelf ?? 0)
    });
  }
  styleHeader(unitsSheet.getRow(1));
  styleBody(unitsSheet);

  const notes = workbook.addWorksheet('روش محاسبه', { views: [{ rightToLeft: true }] });
  notes.columns = [{ width: 38 }, { width: 100 }];
  notes.addRow(['عنوان', 'شرح']);
  notes.addRows([
    ['پروژه', project.name || 'بدون نام'],
    ['فایل منبع', project.sourceFile || '—'],
    ['واحد ابعاد', 'طبق اعداد فایل اصلی؛ در این برنامه به‌صورت سانتی‌متر نمایش داده می‌شود.'],
    ['درب', 'تعداد خودکار: ۱ در عرض ۱۰–۵۰، ۲ در عرض بیش از ۵۰ تا ۱۰۰، ۳ در عرض بیش از ۱۰۰ تا ۱۵۰؛ عرض هر درب = عرض یونیت ÷ تعداد − ۰٫۲.'],
    ['زمینی', 'عرض داخلی و طول طبقه/قید = عرض یونیت − ۳٫۲؛ پشت‌بند ۳ میل = (عرض − ۱٫۶) × (ارتفاع + ۰٫۸).'],
    ['هوایی', 'عرض داخلی = عرض یونیت − ۳٫۲؛ پشت‌بند ۳ میل = (عرض − ۱٫۶) × (ارتفاع − ۰٫۸).'],
    ['کشو', 'بدنه: طول = عمق − ۵ و عرض = ارتفاع ÷ ۳ − ۴؛ جلوی کشو: طول = عرض − ۹٫۱؛ پشت کشو دو سانتی‌متر باریک‌تر.'],
    ['چیدمان ورق', 'تعداد ورق، درصد پرت و نقشه‌ی برش در صفحه‌ی «لیست برش ← محاسبه‌ی بهینه‌سازی برش» محاسبه می‌شود و در این فایل Excel نیست.'],
    ['محدودیت', 'جهت رگه، رزرو لبه‌ی خام ورق و پرت طبیعی در محاسبات لحاظ نشده‌اند.']
  ]);
  styleHeader(notes.getRow(1));
  styleBody(notes);
  notes.getColumn(1).width = 28;
  notes.getColumn(2).width = 100;

  const backup = workbook.addWorksheet(PROJECT_BACKUP_SHEET, { state: 'veryHidden' });
  backup.getCell(1, 1).value = PROJECT_BACKUP_MARKER;
  const projectJson = JSON.stringify(project, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return { [PROJECT_SPECIAL_NUMBER_KEY]: String(value) };
    }
    return value;
  });
  for (let offset = 0, row = 2; offset < projectJson.length; offset += PROJECT_BACKUP_CHUNK_SIZE, row += 1) {
    backup.getCell(row, 1).value = projectJson.slice(offset, offset + PROJECT_BACKUP_CHUNK_SIZE);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveBlob(blob, `${cleanFileName(project.name)}-لیست-برش.xlsx`);
}

export function exportProjectBackup(project) {
  const json = JSON.stringify({ ...project, backupAt: new Date().toISOString() }, null, 2);
  saveBlob(new Blob([json], { type: 'application/json;charset=utf-8' }), `${cleanFileName(project.name)}-backup.json`);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
