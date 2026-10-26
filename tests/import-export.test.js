import { afterEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCutList, getDoorCount } from '../src/lib/engine.js';
import { exportWorkbook, importWorkbook } from '../src/lib/workbook.js';

const realFixturePath = fileURLToPath(new URL('./fixtures/analiz-pro-2.xlsx', import.meta.url));
const hasRealFixture = existsSync(realFixturePath);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function asWorkbookFile(bytes, name = 'test.xlsx') {
  const buffer = Buffer.from(bytes);
  return {
    name,
    size: buffer.byteLength,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  };
}

async function createLegacyWorkbook({ lower = [], upper = [], drawerCount, lowerQuantityHeader = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const lowerSheet = workbook.addWorksheet('کابینت زمینی');
  const upperSheet = workbook.addWorksheet('کابینت هوایی');

  if (lowerQuantityHeader) lowerSheet.getCell(1, 1).value = 'تعداد';

  const addUnit = (sheet, type, row, item, withQuantity = false) => {
    const cell = (column, value) => { sheet.getCell(row, column).value = value; };
    if (withQuantity) cell(1, item.quantity ?? 1);
    cell(2, item.width ?? 80);
    cell(3, type === 'lower' ? (item.depth ?? 58) : (item.depth ?? 35));

    if (type === 'lower') {
      cell(6, item.height ?? 73.4);
      cell(7, item.shelfDepth ?? 55);
      cell(9, item.railWidth ?? 7);
      cell(14, item.doorHeight ?? 73.4);
      const qtyRow = row + 3;
      for (const [column, key, fallback] of [[4, 'bottom', 1], [6, 'sides', 2], [8, 'shelf', 1], [10, 'rail', 1], [12, 'back', 1]]) {
        sheet.getCell(qtyRow, column).value = item.parts?.[key] ?? fallback;
      }
    } else {
      cell(4, item.height ?? 90);
      cell(5, item.bottomDepth ?? 35);
      cell(16, item.doorHeight ?? 92);
      const qtyRow = row + 3;
      for (const [column, key, fallback] of [[4, 'sides', 2], [6, 'bottom', 1], [8, 'top', 1], [10, 'shelf', 1], [12, 'rail', 1], [14, 'back', 1]]) {
        sheet.getCell(qtyRow, column).value = item.parts?.[key] ?? fallback;
      }
    }
  };

  lower.forEach((item, index) => addUnit(lowerSheet, 'lower', (lowerQuantityHeader ? 2 : 1) + index * 4, item, lowerQuantityHeader));
  upper.forEach((item, index) => addUnit(upperSheet, 'upper', 1 + index * 4, item));

  if (drawerCount !== undefined) {
    const drawerSheet = workbook.addWorksheet('کشو');
    drawerSheet.getCell(4, 2).value = drawerCount;
    drawerSheet.getCell(4, 3).value = 50;
    drawerSheet.getCell(4, 4).value = 90;
    drawerSheet.getCell(4, 5).value = 50;
  }

  const bytes = await workbook.xlsx.writeBuffer();
  return asWorkbookFile(bytes);
}

async function exportToBlob(project) {
  let exportedBlob;
  const anchor = { style: {}, click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', {
    createElement: vi.fn(() => anchor),
    body: { appendChild: vi.fn() }
  });
  vi.stubGlobal('window', { setTimeout: vi.fn(() => 1) });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    exportedBlob = blob;
    return 'blob:promax-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await exportWorkbook(project);
  return exportedBlob;
}

describe('real Excel workbook fixture', () => {
  it.skipIf(!hasRealFixture)('imports 11 ground and 20 wall units from analiz-pro-2.xlsx', async () => {
    const bytes = readFileSync(realFixturePath);
    const project = await importWorkbook(asWorkbookFile(bytes, 'analiz-pro-2.xlsx'));

    expect(project.units.filter((unit) => unit.type === 'lower')).toHaveLength(11);
    expect(project.units.filter((unit) => unit.type === 'upper')).toHaveLength(20);
  });
});

describe('Excel import tolerance and export round-trip', () => {
  it('imports width 30 as one door and width 80 as two doors', async () => {
    const project = await importWorkbook(await createLegacyWorkbook({ lower: [{ width: 30 }, { width: 80 }] }));
    const byWidth = new Map(project.units.filter((unit) => unit.type === 'lower').map((unit) => [unit.width, getDoorCount(unit)]));

    expect(byWidth.get(30)).toBe(1);
    expect(byWidth.get(80)).toBe(2);
  });

  it('keeps broken cross-sheet references as NaN, warns, and does not crash cut-list generation', async () => {
    const workbook = new ExcelJS.Workbook();
    const lower = workbook.addWorksheet('کابینت زمینی');
    lower.getCell(1, 2).value = 80;
    lower.getCell(1, 3).value = { formula: "'کابینت هوایی'!#REF!", result: '#REF!' };
    lower.getCell(1, 6).value = 73.4;
    for (const [column, count] of [[4, 1], [6, 2], [8, 1], [10, 1], [12, 1]]) lower.getCell(4, column).value = count;
    const file = asWorkbookFile(await workbook.xlsx.writeBuffer());

    const project = await importWorkbook(file);
    expect(project.units).toHaveLength(1);
    expect(Number.isNaN(project.units[0].depth)).toBe(true);
    expect(project.importWarnings.some((warning) => warning.includes('ارجاع یا فرمول Excel خراب است'))).toBe(true);
    expect(() => buildCutList(project.units)).not.toThrow();
  });

  it('filters zero-quantity units and tolerates a drawer sheet with no active drawers', async () => {
    const file = await createLegacyWorkbook({
      lowerQuantityHeader: true,
      lower: [
        { quantity: 0, width: 30 },
        { quantity: 2, width: 80 }
      ],
      drawerCount: 0
    });

    const project = await importWorkbook(file);
    expect(project.units.filter((unit) => unit.type === 'lower')).toHaveLength(1);
    expect(project.units[0].quantity).toBe(2);
    expect(buildCutList(project.units).length).toBeGreaterThan(0);
    expect(project.units.some((unit) => unit.type === 'drawer')).toBe(false);
    expect(project.importWarnings.some((warning) => warning.includes('غیرفعال بود'))).toBe(true);
    expect(project.importWarnings.some((warning) => warning.includes('هیچ کشوی فعالی ندارد'))).toBe(true);
  });

  it('returns a warning project instead of throwing when all cabinet units are inactive', async () => {
    const file = await createLegacyWorkbook({
      lowerQuantityHeader: true,
      lower: [{ quantity: 0, width: 80 }],
      drawerCount: 0
    });

    const project = await importWorkbook(file);
    expect(project.units).toEqual([]);
    expect(project.importWarnings.some((warning) => warning.includes('پروژه‌ی خالی وارد شد'))).toBe(true);
  });

  it('imports, exports, and re-imports project data without losing units or dimensions', async () => {
    const source = hasRealFixture
      ? asWorkbookFile(readFileSync(realFixturePath), 'analiz-pro-2.xlsx')
      : await createLegacyWorkbook({
        lower: [
          { width: 30, depth: { formula: "'کابینت هوایی'!#REF!", result: '#REF!' } },
          { width: 80 }
        ],
        upper: [{ width: 80 }],
        drawerCount: 2
      });
    const imported = await importWorkbook(source);
    const exportedBlob = await exportToBlob(imported);
    expect(exportedBlob).toBeTruthy();

    const exported = asWorkbookFile(await exportedBlob.arrayBuffer(), 'round-trip.xlsx');
    const restored = await importWorkbook(exported);
    expect(restored.name).toBe(imported.name);
    expect(restored.customer).toBe(imported.customer);
    expect(restored.units).toEqual(imported.units);
  });
});
