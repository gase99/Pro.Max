import { buildCutList, getDoorCount, parseNumber, summarizeMaterials, TYPE_LABELS } from './engine.js';

const faDigits = (value) => String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

function cellValue(sheet, row, column) {
  const value = sheet?.getRow(row)?.getCell(column)?.value;
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map((chunk) => chunk.text || '').join('');
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
  }
  return value;
}

function cellNumber(sheet, row, column, fallback = 0) {
  return parseNumber(cellValue(sheet, row, column), fallback);
}

function safeCount(sheet, row, column, fallback = 0) {
  const raw = cellValue(sheet, row, column);
  if (raw === null || raw === undefined || raw === '') return fallback;
  return Math.max(0, Math.floor(parseNumber(raw, fallback)));
}

function sheetByName(workbook, name) {
  return workbook.getWorksheet(name)
    || workbook.worksheets.find((sheet) => sheet.name.trim().replace(/\s+/g, ' ') === name);
}

function importCabinetSheet(sheet, type, startIndex = 1) {
  if (!sheet) return [];
  const units = [];
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const width = cellNumber(sheet, row, 2, NaN);
    if (!Number.isFinite(width) || width <= 0) continue;
    const qtyRow = row + 3;
    const index = startIndex + units.length;
    const tag = faDigits(String(index).padStart(2, '0'));

    if (type === 'lower') {
      units.push({
        id: `import-lower-${index}-${Date.now()}`,
        type,
        name: `یونیت زمینی ${tag}`,
        quantity: 1,
        width,
        depth: cellNumber(sheet, row, 3, 58),
        height: cellNumber(sheet, row, 6, 73.4),
        shelfDepth: cellNumber(sheet, row, 7, 55),
        railWidth: cellNumber(sheet, row, 9, 7),
        doorHeight: cellNumber(sheet, row, 14, 73.4),
        autoDoors: true,
        parts: {
          bottom: safeCount(sheet, qtyRow, 4, 1),
          sides: safeCount(sheet, qtyRow, 6, 2),
          shelf: safeCount(sheet, qtyRow, 8, 1),
          rail: safeCount(sheet, qtyRow, 10, 1),
          back: safeCount(sheet, qtyRow, 12, 1),
          doors: null
        }
      });
    } else {
      units.push({
        id: `import-upper-${index}-${Date.now()}`,
        type,
        name: `یونیت هوایی ${tag}`,
        quantity: 1,
        width,
        depth: cellNumber(sheet, row, 3, 35),
        height: cellNumber(sheet, row, 4, 90),
        bottomDepth: cellNumber(sheet, row, 5, 35),
        doorHeight: cellNumber(sheet, row, 16, 92),
        autoDoors: true,
        parts: {
          sides: safeCount(sheet, qtyRow, 4, 2),
          bottom: safeCount(sheet, qtyRow, 6, 1),
          top: safeCount(sheet, qtyRow, 8, 1),
          shelf: safeCount(sheet, qtyRow, 10, 1),
          rail: safeCount(sheet, qtyRow, 12, 1),
          back: safeCount(sheet, qtyRow, 14, 1),
          doors: null
        }
      });
    }
  }
  return units;
}

export async function importWorkbook(file) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const lowerSheet = sheetByName(workbook, 'کابینت زمینی');
  const upperSheet = sheetByName(workbook, 'کابینت هوایی');
  const drawerSheet = sheetByName(workbook, 'کشو');
  const units = [
    ...importCabinetSheet(lowerSheet, 'lower'),
    ...importCabinetSheet(upperSheet, 'upper')
  ];

  if (drawerSheet) {
    const count = safeCount(drawerSheet, 4, 2, 0);
    if (count > 0) {
      units.push({
        id: `import-drawer-${Date.now()}`,
        type: 'drawer',
        name: 'مجموعه کشو',
        count,
        depth: cellNumber(drawerSheet, 4, 3, 50),
        width: cellNumber(drawerSheet, 4, 4, 90),
        height: cellNumber(drawerSheet, 4, 5, 50)
      });
    }
  }

  if (units.length === 0) {
    throw new Error('شیت‌های «کابینت زمینی» یا «کابینت هوایی» در فایل پیدا نشدند، یا داده‌ی ابعادی نداشتند.');
  }

  const fileName = file.name || 'فایل Excel';
  return {
    id: `project-${Date.now()}`,
    name: fileName.replace(/\.(xlsx|xls)$/i, '') || 'پروژه واردشده',
    customer: '',
    notes: 'یونیت‌ها از شیت‌های «کابینت زمینی»، «کابینت هوایی» و «کشو» خوانده شدند. برای اطمینان، ابعاد خروجی را با فایل اصلی تطبیق دهید.',
    sourceFile: fileName,
    createdAt: new Date().toISOString(),
    units
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
    ['محدودیت', 'ضخامت تیغ اره، جهت رگه، پرت ورق خام و چیدمان بهینه‌ی برش در محاسبات این نسخه لحاظ نشده‌اند.']
  ]);
  styleHeader(notes.getRow(1));
  styleBody(notes);
  notes.getColumn(1).width = 28;
  notes.getColumn(2).width = 100;

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
