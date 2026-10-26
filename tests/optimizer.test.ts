import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList } from '../src/lib/engine.js';
import {
  DEFAULT_KERF_MM,
  DEFAULT_SHEET,
  cutRowsToPieces,
  groupRowsByMaterial,
  optimizeCuts,
  optimizeCutListByMaterial
} from '../src/lib/optimizer';
import type {
  CutPiece,
  OptimizationResult,
  PlacedPiece,
  SheetLayout
} from '../src/lib/optimizer';

const EPSILON = 1e-6;
const STANDARD_SHEET = { width: 1830, height: 3660 };

function piece(overrides: Partial<CutPiece> & Pick<CutPiece, 'id' | 'width' | 'height'>): CutPiece {
  return {
    name: overrides.id,
    quantity: 1,
    ...overrides
  };
}

function assertInsideSheet(sheet: SheetLayout, placed: PlacedPiece): void {
  expect(placed.x).toBeGreaterThanOrEqual(-EPSILON);
  expect(placed.y).toBeGreaterThanOrEqual(-EPSILON);
  expect(placed.width).toBeGreaterThan(0);
  expect(placed.height).toBeGreaterThan(0);
  expect(placed.x + placed.width).toBeLessThanOrEqual(sheet.width + EPSILON);
  expect(placed.y + placed.height).toBeLessThanOrEqual(sheet.height + EPSILON);
}

function axisSeparated(aStart: number, aSize: number, bStart: number, bSize: number): boolean {
  return aStart + aSize <= bStart + EPSILON || bStart + bSize <= aStart + EPSILON;
}

function assertNoOverlaps(result: OptimizationResult): void {
  for (const sheet of result.sheets) {
    for (const placed of sheet.pieces) assertInsideSheet(sheet, placed);

    for (let first = 0; first < sheet.pieces.length; first += 1) {
      for (let second = first + 1; second < sheet.pieces.length; second += 1) {
        const a = sheet.pieces[first]!;
        const b = sheet.pieces[second]!;
        const separated =
          axisSeparated(a.x, a.width, b.x, b.width) || axisSeparated(a.y, a.height, b.y, b.height);
        expect(
          separated,
          `pieces ${a.instanceId} and ${b.instanceId} overlap on sheet ${sheet.index}`
        ).toBe(true);
      }
    }
  }
}

/**
 * A layout is guillotine-cuttable when a straight cut can split the remaining
 * region into two halves without touching any part. Every cut consumes `kerf`.
 */
function isGuillotineCuttable(
  pieces: readonly PlacedPiece[],
  region: { x: number; y: number; width: number; height: number },
  kerf: number
): boolean {
  if (pieces.length <= 1) return true;
  const tolerance = 1e-6;

  const leftEdges = new Set<number>();
  const topEdges = new Set<number>();
  for (const item of pieces) {
    leftEdges.add(item.x + item.width);
    topEdges.add(item.y + item.height);
  }

  for (const cut of leftEdges) {
    if (cut < region.x + tolerance || cut > region.x + region.width - tolerance) continue;
    const left = pieces.filter((item) => item.x + item.width <= cut + tolerance);
    const right = pieces.filter((item) => item.x >= cut + kerf - tolerance);
    if (left.length + right.length !== pieces.length) continue;
    if (left.length === 0 || right.length === 0) continue;
    const leftWidth = cut - region.x;
    const rightStart = cut + kerf;
    if (
      isGuillotineCuttable(left, { ...region, width: leftWidth }, kerf) &&
      isGuillotineCuttable(
        right,
        {
          x: rightStart,
          y: region.y,
          width: region.x + region.width - rightStart,
          height: region.height
        },
        kerf
      )
    ) {
      return true;
    }
  }

  for (const cut of topEdges) {
    if (cut < region.y + tolerance || cut > region.y + region.height - tolerance) continue;
    const top = pieces.filter((item) => item.y + item.height <= cut + tolerance);
    const bottom = pieces.filter((item) => item.y >= cut + kerf - tolerance);
    if (top.length + bottom.length !== pieces.length) continue;
    if (top.length === 0 || bottom.length === 0) continue;
    const topHeight = cut - region.y;
    const bottomStart = cut + kerf;
    if (
      isGuillotineCuttable(top, { ...region, height: topHeight }, kerf) &&
      isGuillotineCuttable(
        bottom,
        {
          x: region.x,
          y: bottomStart,
          width: region.width,
          height: region.y + region.height - bottomStart
        },
        kerf
      )
    ) {
      return true;
    }
  }

  return false;
}

function assertGuillotine(result: OptimizationResult): void {
  for (const sheet of result.sheets) {
    const region = { x: 0, y: 0, width: sheet.width, height: sheet.height };
    expect(
      isGuillotineCuttable(sheet.pieces, region, result.kerf),
      `sheet ${sheet.index} cannot be produced with edge-to-edge guillotine cuts`
    ).toBe(true);
  }
}

function relativeDifference(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
}

describe('optimizeCuts — placement', () => {
  it('places every copy without overlaps and inside the sheet bounds', () => {
    const result = optimizeCuts({
      pieces: [
        piece({ id: 'side-a', name: 'بدنه جانبی', width: 600, height: 730, quantity: 4 }),
        piece({ id: 'shelf-b', name: 'طبقه', width: 550, height: 768, quantity: 5 }),
        piece({ id: 'rail-c', name: 'قید', width: 70, height: 768, quantity: 6 }),
        piece({ id: 'door-d', name: 'درب', width: 398, height: 734, quantity: 8 })
      ],
      sheet: STANDARD_SHEET,
      kerf: 4
    });

    expect(result.requestedPieceCount).toBe(23);
    expect(result.placedPieceCount).toBe(23);
    expect(result.rejected).toEqual([]);
    expect(result.totalSheetsUsed).toBeGreaterThan(0);
    assertNoOverlaps(result);
    assertGuillotine(result);

    for (const sheet of result.sheets) {
      expect(sheet.usedArea).toBeGreaterThan(0);
      expect(sheet.usedArea).toBeLessThanOrEqual(sheet.width * sheet.height + EPSILON);
      expect(sheet.wasteArea).toBeGreaterThanOrEqual(-EPSILON);
      expect(sheet.usedArea + sheet.wasteArea).toBeCloseTo(sheet.width * sheet.height, 3);
      const placedArea = sheet.pieces.reduce((sum, item) => sum + item.width * item.height, 0);
      expect(placedArea).toBeCloseTo(sheet.usedArea, 6);
    }
  });

  it('expands quantities into individual copies with unique ids', () => {
    const result = optimizeCuts({
      pieces: [piece({ id: 'shelf', name: 'طبقه', width: 500, height: 700, quantity: 3 })],
      sheet: STANDARD_SHEET,
      kerf: 4
    });

    expect(result.placedPieceCount).toBe(3);
    const placed = result.sheets.flatMap((sheet) => sheet.pieces);
    expect(placed.map((item) => item.copyIndex).sort()).toEqual([1, 2, 3]);
    expect(new Set(placed.map((item) => item.instanceId)).size).toBe(3);
    for (const item of placed) {
      expect(item.sourceWidth).toBe(500);
      expect(item.sourceHeight).toBe(700);
      expect(item.name).toBe('طبقه');
      expect(item.material).toBeUndefined();
    }
  });

  it('returns an empty layout for an empty cut list', () => {
    const result = optimizeCuts({ pieces: [] });
    expect(result.sheets).toEqual([]);
    expect(result.totalSheetsUsed).toBe(0);
    expect(result.totalSheetArea).toBe(0);
    expect(result.wastePercentage).toBe(0);
    expect(result.rejected).toEqual([]);
  });

  it('supports the positional (pieces, options) call style', () => {
    const result = optimizeCuts(
      [piece({ id: 'a', width: 400, height: 600 })],
      { sheet: { width: 1000, height: 1000 }, kerf: 0 }
    );
    expect(result.totalSheetsUsed).toBe(1);
    expect(result.sheet).toEqual({ width: 1000, height: 1000 });
  });
});

describe('optimizeCuts — kerf handling', () => {
  it('keeps at least one blade width between adjacent pieces', () => {
    const result = optimizeCuts({
      pieces: [piece({ id: 'strip', name: 'نوار', width: 400, height: 1000, quantity: 2 })],
      sheet: { width: 1000, height: 1000 },
      kerf: 10,
      allowRotation: false
    });

    expect(result.totalSheetsUsed).toBe(1);
    const [first, second] = [...result.sheets[0]!.pieces].sort((a, b) => a.x - b.x);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const gap = second!.x - (first!.x + first!.width);
    expect(gap).toBeGreaterThanOrEqual(10 - EPSILON);
  });

  it('needs a second sheet when parts plus kerf exceed the sheet width', () => {
    const withoutKerf = optimizeCuts({
      pieces: [piece({ id: 'half', width: 500, height: 1000, quantity: 2 })],
      sheet: { width: 1000, height: 1000 },
      kerf: 0,
      allowRotation: false
    });
    expect(withoutKerf.totalSheetsUsed).toBe(1);

    const withKerf = optimizeCuts({
      pieces: [piece({ id: 'half', width: 500, height: 1000, quantity: 2 })],
      sheet: { width: 1000, height: 1000 },
      kerf: 10,
      allowRotation: false
    });
    expect(withKerf.totalSheetsUsed).toBe(2);
    expect(withKerf.placedPieceCount).toBe(2);
  });

  it('uses 4 mm kerf and the 1830 × 3660 sheet by default', () => {
    const result = optimizeCuts([piece({ id: 'default', width: 500, height: 500 })]);
    expect(result.kerf).toBe(DEFAULT_KERF_MM);
    expect(result.sheet).toEqual(DEFAULT_SHEET);
    expect(result.allowRotation).toBe(true);
  });
});

describe('optimizeCuts — invalid and oversized pieces', () => {
  it('rejects a piece that is larger than the sheet and keeps the valid pieces', () => {
    const result = optimizeCuts({
      pieces: [
        piece({ id: 'ok', name: 'قطعه سالم', width: 500, height: 500 }),
        piece({ id: 'huge', name: 'قطعه بزرگ', width: 1200, height: 2500, quantity: 2 })
      ],
      sheet: { width: 1000, height: 2000 },
      kerf: 4
    });

    expect(result.sheets).toHaveLength(1);
    expect(result.placedPieceCount).toBe(1);
    expect(result.requestedPieceCount).toBe(3);
    expect(result.rejected).toHaveLength(1);

    const rejected = result.rejected[0]!;
    expect(rejected.id).toBe('huge');
    expect(rejected.reason).toBe('too-large');
    expect(rejected.quantity).toBe(2);
    expect(rejected.message).toContain('جای نمی‌گیرد');
  });

  it('reports invalid dimensions and quantities without throwing', () => {
    const result = optimizeCuts({
      pieces: [
        piece({ id: 'zero', width: 0, height: 500 }),
        piece({ id: 'negative', width: 400, height: -20 }),
        piece({ id: 'nonsense', width: 400, height: 500, quantity: 0 })
      ],
      sheet: { width: 1000, height: 1000 }
    });

    expect(result.sheets).toEqual([]);
    expect(result.rejected.map((item) => item.id)).toEqual(['zero', 'negative']);
    expect(result.rejected.every((item) => item.reason === 'invalid-dimensions')).toBe(true);
    expect(result.requestedPieceCount).toBe(0);
  });

  it('allows rotation only when it is enabled (globally or per piece)', () => {
    const locked = optimizeCuts({
      pieces: [piece({ id: 'wide', width: 900, height: 400 })],
      sheet: { width: 500, height: 1000 },
      allowRotation: false
    });
    expect(locked.totalSheetsUsed).toBe(0);
    expect(locked.rejected[0]?.reason).toBe('too-large');

    const rotated = optimizeCuts({
      pieces: [piece({ id: 'wide', width: 900, height: 400 })],
      sheet: { width: 500, height: 1000 },
      allowRotation: true
    });
    expect(rotated.totalSheetsUsed).toBe(1);
    const placed = rotated.sheets[0]!.pieces[0]!;
    expect(placed.rotated).toBe(true);
    expect([placed.width, placed.height]).toEqual([400, 900]);

    const perPieceLock = optimizeCuts({
      pieces: [piece({ id: 'wide', width: 900, height: 400, canRotate: false })],
      sheet: { width: 500, height: 1000 },
      allowRotation: true
    });
    expect(perPieceLock.totalSheetsUsed).toBe(0);
  });

  it('accepts a piece that exactly matches the sheet', () => {
    const result = optimizeCuts({
      pieces: [piece({ id: 'full', width: 1830, height: 3660 })],
      kerf: 4
    });
    expect(result.totalSheetsUsed).toBe(1);
    expect(result.wastePercentage).toBeGreaterThanOrEqual(0);
    expect(result.wastePercentage).toBeLessThanOrEqual(EPSILON);
    expect(result.rejected).toEqual([]);
  });

  it('throws for invalid sheet or kerf configuration', () => {
    expect(() => optimizeCuts({ pieces: [], sheet: { width: 0, height: 1000 } })).toThrow(RangeError);
    expect(() => optimizeCuts({ pieces: [], sheet: { width: 1000, height: -1 } })).toThrow(RangeError);
    expect(() => optimizeCuts({ pieces: [], kerf: -2 })).toThrow(RangeError);
    expect(() => optimizeCuts({ pieces: [], kerf: Number.NaN })).toThrow(RangeError);
  });
});

describe('optimizeCuts — area accounting', () => {
  it('keeps placed area + waste equal to the total sheet area', () => {
    const result = optimizeCuts({
      pieces: [
        piece({ id: 'a', width: 1828, height: 900, quantity: 2 }),
        piece({ id: 'b', name: 'B', width: 1200, height: 2400, quantity: 3 }),
        piece({ id: 'c', name: 'C', width: 300, height: 400, quantity: 10 })
      ],
      sheet: STANDARD_SHEET,
      kerf: 4
    });

    const expectedSheetArea =
      STANDARD_SHEET.width * STANDARD_SHEET.height * result.totalSheetsUsed;
    expect(result.totalSheetArea).toBe(expectedSheetArea);
    expect(result.totalSheetsUsed).toBe(result.sheets.length);
    expect(result.placedPieceCount).toBe(15);
    expect(relativeDifference(result.totalPieceArea + result.totalWasteArea, expectedSheetArea)).toBeLessThan(1e-9);
    expect(relativeDifference(result.totalWasteArea / result.totalSheetArea, result.wasteRatio)).toBeLessThan(1e-9);
    expect(result.wastePercentage).toBeCloseTo(result.wasteRatio * 100, 9);

    const perSheetUsed = result.sheets.reduce((sum, sheet) => sum + sheet.usedArea, 0);
    expect(relativeDifference(perSheetUsed, result.totalPieceArea)).toBeLessThan(1e-9);
  });

  it('reports zero waste when the pieces exactly fill the sheet', () => {
    const result = optimizeCuts({
      pieces: [piece({ id: 'tile', width: 50, height: 50, quantity: 4 })],
      sheet: { width: 100, height: 100 },
      kerf: 0,
      allowRotation: false
    });

    expect(result.totalSheetsUsed).toBe(1);
    expect(result.totalPieceArea).toBe(10000);
    expect(result.totalWasteArea).toBeCloseTo(0, 9);
    expect(result.wastePercentage).toBeCloseTo(0, 9);
    expect(result.sheets[0]!.pieces).toHaveLength(4);
    assertNoOverlaps(result);
  });

  it('counts the saw kerf as waste', () => {
    const result = optimizeCuts({
      pieces: [piece({ id: 'strip', width: 400, height: 1000, quantity: 2 })],
      sheet: { width: 1000, height: 1000 },
      kerf: 10,
      allowRotation: false
    });

    expect(result.totalPieceArea).toBe(800000);
    expect(result.totalWasteArea).toBeCloseTo(200000, 6);
    expect(result.wastePercentage).toBeCloseTo(20, 9);
  });
});

describe('cut-list helpers', () => {
  it('converts centimetre cut rows to millimetre pieces', () => {
    const pieces = cutRowsToPieces([
      {
        id: 'unit-a-sides',
        unitName: 'یونیت زمینی ۰۱',
        part: 'بدنه جانبی',
        width: 58,
        length: 73.4,
        quantity: 2,
        material: 'سفید ۳۶۶'
      }
    ]);

    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({
      id: 'unit-a-sides',
      name: 'بدنه جانبی',
      reference: 'یونیت زمینی ۰۱',
      width: 580,
      height: 734,
      quantity: 2,
      material: 'سفید ۳۶۶'
    });
  });

  it('groups rows by material and keeps an explicit fallback group', () => {
    const groups = groupRowsByMaterial([
      { material: 'سفید ۳۶۶', id: '1' },
      { material: 'MDF سه‌میل', id: '2' },
      { material: 'سفید ۳۶۶', id: '3' },
      { material: '', id: '4' }
    ]);

    expect([...groups.keys()]).toEqual(['سفید ۳۶۶', 'MDF سه‌میل', 'بدون متریال']);
    expect(groups.get('سفید ۳۶۶')?.map((row) => row.id)).toEqual(['1', '3']);
  });
});

describe('optimizeCuts — realistic workshop load', () => {
  it('lays out 60 mixed cabinet parts without overlaps', () => {
    const parts: CutPiece[] = [];
    for (let index = 0; index < 12; index += 1) {
      parts.push(piece({ id: `side-${index}`, name: 'بدنه جانبی', width: 580, height: 734 }));
      parts.push(piece({ id: `shelf-${index}`, name: 'طبقه', width: 550, height: 768 }));
      parts.push(piece({ id: `door-${index}`, name: 'درب', width: 398, height: 734 }));
      parts.push(piece({ id: `back-${index}`, name: 'پشت‌بند', width: 784, height: 742 }));
      parts.push(piece({ id: `rail-${index}`, name: 'قید', width: 70, height: 768 }));
    }

    const result = optimizeCuts({ pieces: parts, sheet: STANDARD_SHEET, kerf: 4 });

    expect(result.placedPieceCount).toBe(60);
    expect(result.rejected).toEqual([]);
    expect(result.totalSheetsUsed).toBeGreaterThan(0);
    expect(result.wastePercentage).toBeGreaterThan(0);
    expect(result.wastePercentage).toBeLessThan(100);
    assertNoOverlaps(result);
    assertGuillotine(result);
  });

  it('keeps every sample-project sheet guillotine-cuttable', () => {
    const report = optimizeCutListByMaterial(buildCutList(createSampleProject().units), {
      kerf: 4
    });
    for (const group of report.groups) {
      expect(group.result.rejected).toEqual([]);
      assertGuillotine(group.result);
    }
  });

  it('respects a per-piece kerf gap across a dense mixed load', () => {
    const result = optimizeCuts({
      pieces: [
        piece({ id: 'a', width: 700, height: 400, quantity: 3 }),
        piece({ id: 'b', width: 350, height: 400, quantity: 4 }),
        piece({ id: 'c', width: 350, height: 300, quantity: 5 }),
        piece({ id: 'd', width: 200, height: 200, quantity: 7 })
      ],
      sheet: { width: 1830, height: 3660 },
      kerf: 4
    });

    assertNoOverlaps(result);
    assertGuillotine(result);

    for (const sheet of result.sheets) {
      const sorted = [...sheet.pieces].sort((a, b) => a.x - b.x);
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1]!;
        const current = sorted[index]!;
        const verticallyOverlapping =
          current.y < previous.y + previous.height - EPSILON &&
          previous.y < current.y + current.height - EPSILON;
        if (!verticallyOverlapping) continue;
        expect(current.x - (previous.x + previous.width)).toBeGreaterThanOrEqual(4 - EPSILON);
      }
    }
  });
});

describe('optimizeCutListByMaterial', () => {
  const rows = [
    {
      id: 'lower-1-sides',
      unitName: 'یونیت زمینی ۰۱',
      part: 'بدنه جانبی',
      width: 58,
      length: 73.4,
      quantity: 2,
      material: 'سفید ۳۶۶'
    },
    {
      id: 'lower-1-shelf',
      unitName: 'یونیت زمینی ۰۱',
      part: 'طبقه',
      width: 55,
      length: 76.8,
      quantity: 1,
      material: 'سفید ۳۶۶'
    },
    {
      id: 'lower-1-back',
      unitName: 'یونیت زمینی ۰۱',
      part: 'پشت‌بند ۳ میل',
      width: 78.4,
      length: 74.2,
      quantity: 1,
      material: 'MDF سه‌میل'
    }
  ];

  it('groups by material, converts cm to mm and aggregates totals', () => {
    const report = optimizeCutListByMaterial(rows, {
      sheet: { width: 1830, height: 3660 },
      kerf: 4,
      allowRotation: true
    });

    expect(report.groups.map((group) => group.material)).toEqual(['سفید ۳۶۶', 'MDF سه‌میل']);
    expect(report.groups.map((group) => group.rowCount)).toEqual([2, 1]);
    expect(report.groups[0]!.result.sheet).toEqual({ width: 1830, height: 3660 });
    expect(report.settings).toEqual({
      sheet: { width: 1830, height: 3660 },
      kerf: 4,
      allowRotation: true
    });
    expect(report.totals.requested).toBe(4);
    expect(report.totals.placed).toBe(4);
    expect(report.totals.rejected).toBe(0);
    expect(report.totals.sheets).toBe(
      report.groups.reduce((sum, group) => sum + group.result.totalSheetsUsed, 0)
    );
    expect(report.totals.pieceArea).toBe(
      report.groups.reduce((sum, group) => sum + group.result.totalPieceArea, 0)
    );
    expect(report.totals.wasteArea).toBe(
      report.groups.reduce((sum, group) => sum + group.result.totalWasteArea, 0)
    );
    expect(report.totals.wastePercentage).toBeCloseTo(
      (report.totals.wasteArea / report.totals.sheetArea) * 100,
      9
    );
    for (const group of report.groups) {
      for (const placed of group.result.sheets.flatMap((sheet) => sheet.pieces)) {
        expect(placed.name).not.toContain(' — ');
        expect(placed.reference).toMatch(/یونیت/);
      }
    }
  });

  it('optimises the sample project cut list end to end', () => {
    const project = createSampleProject();
    const cutList = buildCutList(project.units);
    const report = optimizeCutListByMaterial(cutList, { kerf: 4 });

    expect(report.groups.map((group) => group.material)).toEqual([
      'سفید ۳۶۶',
      'درب',
      'MDF سه‌میل'
    ]);
    expect(report.totals.requested).toBe(262);
    expect(report.totals.placed).toBe(262);
    expect(report.totals.rejected).toBe(0);
    expect(report.totals.sheets).toBeGreaterThan(0);
    expect(report.totals.wastePercentage).toBeGreaterThan(0);
    expect(report.totals.wastePercentage).toBeLessThan(60);
    expect(
      relativeDifference(
        report.totals.pieceArea + report.totals.wasteArea,
        report.totals.sheetArea
      )
    ).toBeLessThan(1e-9);
  });

  it('rejects oversized material batches without blocking other materials', () => {
    const report = optimizeCutListByMaterial(rows, {
      sheet: { width: 500, height: 500 },
      kerf: 4
    });

    expect(report.totals.rejected).toBe(4);
    expect(report.totals.placed).toBe(0);
    for (const group of report.groups) {
      expect(group.result.sheets).toEqual([]);
      expect(group.result.rejected.length).toBeGreaterThan(0);
    }
  });
});
