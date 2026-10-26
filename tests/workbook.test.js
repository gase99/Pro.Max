import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportWorkbook, importWorkbook } from '../src/lib/workbook.js';

async function createWorkbookFile(configure, name = 'cabinet.xlsx') {
  const workbook = new ExcelJS.Workbook();
  configure(workbook);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return { name, size: buffer.byteLength, arrayBuffer: async () => arrayBuffer };
}

function addImportSheets(workbook) {
  const lower = workbook.addWorksheet('کابینت زمینی');
  lower.getCell('B1').value = { formula: '40*2', result: 80 };
  lower.getCell('C1').value = { richText: [{ text: '58' }] };
  lower.getCell('F1').value = 73.4;
  lower.getCell('G1').value = 55;
  lower.getCell('I1').value = 7;
  lower.getCell('N1').value = 73.4;
  lower.getCell('D4').value = 1;
  lower.getCell('F4').value = 2;
  lower.getCell('H4').value = 1;
  lower.getCell('J4').value = 1;
  lower.getCell('L4').value = 1;

  const upper = workbook.addWorksheet('کابینت هوایی');
  upper.getCell('B1').value = 60;
  upper.getCell('C1').value = 35;
  upper.getCell('D1').value = 90;
  upper.getCell('E1').value = 35;
  upper.getCell('P1').value = 92;
  upper.getCell('D4').value = 2;
  upper.getCell('F4').value = 1;
  upper.getCell('H4').value = 1;
  upper.getCell('J4').value = 1;
  upper.getCell('L4').value = 1;
  upper.getCell('N4').value = 1;

  const drawers = workbook.addWorksheet('کشو');
  drawers.getCell('B4').value = 2;
  drawers.getCell('C4').value = 50;
  drawers.getCell('D4').value = 90;
  drawers.getCell('E4').value = 50;
}

test('Excel import reads cabinet, drawer, formula-result, and rich-text values', async () => {
  const file = await createWorkbookFile(addImportSheets);
  const project = await importWorkbook(file);
  const lower = project.units.find((unit) => unit.type === 'lower');
  const upper = project.units.find((unit) => unit.type === 'upper');
  const drawer = project.units.find((unit) => unit.type === 'drawer');

  assert.equal(project.name, 'cabinet');
  assert.equal(lower.width, 80);
  assert.equal(lower.depth, 58);
  assert.equal(lower.parts.sides, 2);
  assert.equal(upper.width, 60);
  assert.equal(upper.doorHeight, 92);
  assert.equal(drawer.count, 2);
  assert.equal(drawer.width, 90);
  assert.equal(project.units.length, 3);
});

test('Excel import rejects unsupported and oversized files before reading them', async () => {
  let readCalled = false;
  const read = async () => { readCalled = true; return new ArrayBuffer(0); };
  await assert.rejects(importWorkbook({ name: 'legacy.xls', size: 1, arrayBuffer: read }), /فقط فایل‌های Excel/);
  await assert.rejects(importWorkbook({ name: 'empty.xlsx', size: 0, arrayBuffer: read }), /فایل اکسل خالی/);
  await assert.rejects(importWorkbook({ name: 'invalid.xlsx', size: Number.POSITIVE_INFINITY, arrayBuffer: read }), /اندازه‌ی آن نامعتبر/);
  await assert.rejects(importWorkbook({ name: 'large.xlsx', size: 25 * 1024 * 1024 + 1, arrayBuffer: read }), /۲۵ مگابایت/);
  await assert.rejects(importWorkbook(null), /فایل انتخاب‌شده معتبر/);
  assert.equal(readCalled, false);
});

test('Excel import reports workbooks without supported cabinet sheets', async () => {
  const file = await createWorkbookFile((workbook) => workbook.addWorksheet('نامعتبر'));
  await assert.rejects(importWorkbook(file), /شیت‌های «کابینت زمینی» یا «کابینت هوایی»/);
});

test('Excel import rejects excessively tall worksheets after parsing', async () => {
  const file = await createWorkbookFile((workbook) => {
    const sheet = workbook.addWorksheet('کابینت زمینی');
    sheet.getCell('B10001').value = 80;
  });
  await assert.rejects(importWorkbook(file), /ساختار فایل اکسل بیش از حد بزرگ است/);
});

test('Excel export creates all documented sheets and preserves cut-list rows', async () => {
  let downloadedBlob;
  let downloadedName;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, 'a');
        return {
          style: {},
          click() {},
          remove() {}
        };
      },
      body: { appendChild() {} }
    }
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout() { return 1; } } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: (blob) => { downloadedBlob = blob; return 'blob:test'; } });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value() {} });

  try {
    const originalCreateElement = globalThis.document.createElement;
    globalThis.document.createElement = (tag) => {
      const anchor = originalCreateElement(tag);
      Object.defineProperty(anchor, 'download', { set(value) { downloadedName = value; } });
      return anchor;
    };
    await exportWorkbook({
      name: 'آزمون',
      sourceFile: 'source.xlsx',
      units: [{
        id: 'unit-1', type: 'lower', name: 'زمینی ۱', quantity: 1,
        width: 80, depth: 58, height: 73.4, shelfDepth: 55, railWidth: 7,
        doorHeight: 73.4, autoDoors: true,
        parts: { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1, doors: null }
      }]
    });
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
    else delete URL.revokeObjectURL;
  }

  assert.ok(downloadedBlob instanceof Blob);
  assert.match(downloadedName, /آزمون-لیست-برش\.xlsx$/);
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(await downloadedBlob.arrayBuffer());
  assert.deepEqual(exported.worksheets.map((sheet) => sheet.name), ['لیست برش', 'خلاصه متریال', 'یونیت‌ها', 'روش محاسبه']);
  assert.equal(exported.getWorksheet('لیست برش').rowCount, 7);
  assert.equal(exported.getWorksheet('یونیت‌ها').getRow(2).getCell(1).value, 'زمینی ۱');
});
