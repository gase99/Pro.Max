import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList } from '../src/lib/engine.js';
import { optimizeCutListByMaterial } from '../src/lib/optimizer';
import type { CutOptimizationReport } from '../src/lib/optimizer';
import {
  DEFAULT_CURRENCY,
  calculateCost,
  costBatchesFromReport,
  createDefaultPriceSettings,
  edgeBandMetersFromPerimeter,
  formatMoney,
  formatMoneyValue,
  formatQuantity,
  LABOR_MODE_LABELS,
  normalizePriceSettings,
  piecePerimeterMeters,
  roundMoney
} from '../src/lib/pricing';
import type { CostBatch, PieceSize, PriceSettings } from '../src/lib/pricing';
import {
  PRICE_SETTINGS_STORAGE_KEY,
  loadPriceSettings,
  savePriceSettings
} from '../src/lib/pricingStorage';
import type { StorageLike } from '../src/lib/pricingStorage';

const samplePieces: PieceSize[] = [
  { width: 580, height: 734 },
  { width: 398, height: 734 }
];

function batch(overrides: Partial<CostBatch> = {}): CostBatch {
  return {
    material: 'سفید ۳۶۶',
    sheetsUsed: 8,
    placedPieceCount: 173,
    ...overrides
  };
}

function settings(overrides: Partial<PriceSettings> = {}): Partial<PriceSettings> {
  return {
    sheetPrice: 2_500_000,
    edgeBandPricePerMeter: 30_000,
    laborMode: 'per-sheet',
    laborRate: 500_000,
    hardwareCost: 1_500_000,
    ...overrides
  };
}

describe('calculateCost — itemised totals', () => {
  it('prices sheets, edge banding, labor and hardware', () => {
    const estimate = calculateCost({
      batches: [batch({ edgeBandMeters: 127.43 })],
      settings: settings(),
      unitCount: 11
    });

    expect(estimate.mdfCost).toBe(20_000_000);
    expect(estimate.edgeBandCost).toBe(3_822_900);
    expect(estimate.laborCost).toBe(4_000_000);
    expect(estimate.hardwareCost).toBe(1_500_000);
    expect(estimate.total).toBe(29_322_900);
    expect(estimate.pricePerUnit).toBe(2_665_718);
    expect(estimate.currency).toBe(DEFAULT_CURRENCY);

    expect(estimate.lines.map((line) => line.key)).toEqual([
      'mdf',
      'edge-band',
      'labor',
      'hardware'
    ]);
    expect(estimate.lines.map((line) => line.amount)).toEqual([
      20_000_000,
      3_822_900,
      4_000_000,
      1_500_000
    ]);
    expect(estimate.lines[0]).toMatchObject({ label: 'هزینه تخته MDF', quantity: 8, unit: 'ورق' });
    expect(estimate.lines[1]).toMatchObject({ label: 'هزینه نوار لبه', quantity: 127.43, unit: 'متر' });
    expect(estimate.lines[2]).toMatchObject({ label: 'دستمزد / CNC', quantity: 8, unit: 'ورق' });

    expect(estimate.totals).toEqual({
      sheetsUsed: 8,
      pieceCount: 173,
      edgeBandMeters: 127.43,
      materialCount: 1,
      unitCount: 11
    });
    expect(estimate.edgeBand.basis).toBe('known');
  });

  it('keeps total exactly equal to the sum of the rounded lines', () => {
    const estimate = calculateCost({
      batches: [
        batch({ material: 'سفید ۳۶۶', sheetsUsed: 3, edgeBandMeters: 0.1 }),
        batch({ material: 'درب', sheetsUsed: 2, edgeBandMeters: 0.2 }),
        batch({ material: 'MDF سه‌میل', sheetsUsed: 1, edgeBandMeters: 0.3 })
      ],
      settings: settings({ sheetPrice: 333_333, edgeBandPricePerMeter: 1_000, laborRate: 0 })
    });

    const sum = estimate.lines.reduce((total, line) => total + line.amount, 0);
    expect(estimate.total).toBe(sum);
    expect(Number.isInteger(estimate.total)).toBe(true);
    for (const line of estimate.lines) expect(Number.isInteger(line.amount)).toBe(true);
  });

  it('uses per-material sheet prices and merges repeated materials', () => {
    const estimate = calculateCost({
      batches: [
        batch({ material: 'سفید ۳۶۶', sheetsUsed: 5 }),
        batch({ material: 'MDF سه‌میل', sheetsUsed: 4 }),
        batch({ material: 'سفید ۳۶۶', sheetsUsed: 3 })
      ],
      settings: settings({
        sheetPrice: 1_000_000,
        materialSheetPrices: { 'MDF سه‌میل': 400_000 },
        edgeBandPricePerMeter: 0,
        laborRate: 0,
        hardwareCost: 0
      })
    });

    expect(estimate.materials).toEqual([
      {
        material: 'سفید ۳۶۶',
        sheets: 8,
        unitPrice: 1_000_000,
        amount: 8_000_000,
        usesDefaultPrice: true
      },
      {
        material: 'MDF سه‌میل',
        sheets: 4,
        unitPrice: 400_000,
        amount: 1_600_000,
        usesDefaultPrice: false
      }
    ]);
    expect(estimate.mdfCost).toBe(9_600_000);
    expect(estimate.total).toBe(9_600_000);
    expect(estimate.totals.materialCount).toBe(2);
    expect(estimate.totals.sheetsUsed).toBe(12);
  });

  it('supports flat, per-sheet and per-piece labor modes', () => {
    const common = {
      batches: [batch({ sheetsUsed: 4, placedPieceCount: 40, edgeBandMeters: 10 })],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 0, laborRate: 1_000 })
    };

    expect(calculateCost({ ...common, settings: settings({ laborMode: 'flat', laborRate: 1_000, sheetPrice: 0, edgeBandPricePerMeter: 0, hardwareCost: 0 }) }).laborCost).toBe(1_000);
    expect(calculateCost({ ...common, settings: settings({ laborMode: 'per-sheet', laborRate: 1_000, sheetPrice: 0, edgeBandPricePerMeter: 0, hardwareCost: 0 }) }).laborCost).toBe(4_000);
    expect(calculateCost({ ...common, settings: settings({ laborMode: 'per-piece', laborRate: 1_000, sheetPrice: 0, edgeBandPricePerMeter: 0, hardwareCost: 0 }) }).laborCost).toBe(40_000);

    const perPiece = calculateCost({
      ...common,
      settings: settings({ laborMode: 'per-piece', laborRate: 1_000, sheetPrice: 0, edgeBandPricePerMeter: 0, hardwareCost: 0 })
    });
    expect(perPiece.lines[2]).toMatchObject({ quantity: 40, unit: 'قطعه' });
    expect(LABOR_MODE_LABELS['per-piece']).toBe('به ازای هر قطعه');
  });

  it('adds manual hardware as a flat line', () => {
    const estimate = calculateCost({
      batches: [batch({ sheetsUsed: 1 })],
      settings: settings({ sheetPrice: 1_000, edgeBandPricePerMeter: 0, laborRate: 0, hardwareCost: 2_450_000 })
    });
    expect(estimate.hardwareCost).toBe(2_450_000);
    expect(estimate.lines[3]).toMatchObject({ unitPrice: 2_450_000, amount: 2_450_000, quantity: 1 });
    expect(estimate.total).toBe(2_451_000);
  });
});

describe('calculateCost — edge banding basis', () => {
  it('uses the known banded length when provided', () => {
    const estimate = calculateCost({
      batches: [batch({ edgeBandMeters: 12.5, pieces: samplePieces })],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 10_000, laborRate: 0, hardwareCost: 0 })
    });
    expect(estimate.totals.edgeBandMeters).toBe(12.5);
    expect(estimate.edgeBandCost).toBe(125_000);
    expect(estimate.edgeBand.basis).toBe('known');
  });

  it('falls back to the perimeter of the placed pieces', () => {
    const estimate = calculateCost({
      batches: [batch({ sheetsUsed: 1, pieces: samplePieces })],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 10_000, laborRate: 0, hardwareCost: 0 })
    });

    expect(piecePerimeterMeters(samplePieces[0]!)).toBeCloseTo(2.628, 9);
    expect(edgeBandMetersFromPerimeter(samplePieces)).toBeCloseTo(4.892, 9);
    expect(estimate.totals.edgeBandMeters).toBeCloseTo(4.892, 9);
    expect(estimate.edgeBandCost).toBe(48_920);
    expect(estimate.edgeBand.basis).toBe('perimeter');
  });

  it('reports a mixed basis and zero when there is no data', () => {
    const mixed = calculateCost({
      batches: [
        batch({ material: 'سفید ۳۶۶', edgeBandMeters: 3 }),
        batch({ material: 'درب', pieces: samplePieces })
      ],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 1_000, laborRate: 0, hardwareCost: 0 })
    });
    expect(mixed.edgeBand.basis).toBe('mixed');
    expect(mixed.totals.edgeBandMeters).toBeCloseTo(3 + 4.892, 9);

    const none = calculateCost({
      batches: [batch({ sheetsUsed: 1 })],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 1_000, laborRate: 0, hardwareCost: 0 })
    });
    expect(none.edgeBand.basis).toBe('none');
    expect(none.totals.edgeBandMeters).toBe(0);
    expect(none.edgeBandCost).toBe(0);
  });

  it('treats an explicit zero as known (no accidental perimeter charge)', () => {
    const estimate = calculateCost({
      batches: [batch({ edgeBandMeters: 0, pieces: samplePieces })],
      settings: settings({ sheetPrice: 0, edgeBandPricePerMeter: 10_000, laborRate: 0, hardwareCost: 0 })
    });
    expect(estimate.totals.edgeBandMeters).toBe(0);
    expect(estimate.edgeBand.basis).toBe('known');
  });
});

describe('calculateCost — edge cases', () => {
  it('returns a zero estimate for an empty cut list', () => {
    const estimate = calculateCost({ batches: [] });

    expect(estimate.total).toBe(0);
    expect(estimate.mdfCost).toBe(0);
    expect(estimate.edgeBandCost).toBe(0);
    expect(estimate.laborCost).toBe(0);
    expect(estimate.hardwareCost).toBe(0);
    expect(estimate.pricePerUnit).toBeNull();
    expect(estimate.materials).toEqual([]);
    expect(estimate.edgeBand.basis).toBe('none');
    expect(estimate.totals).toEqual({
      sheetsUsed: 0,
      pieceCount: 0,
      edgeBandMeters: 0,
      materialCount: 0,
      unitCount: null
    });
    expect(estimate.lines).toHaveLength(4);
    expect(estimate.lines.every((line) => line.amount === 0)).toBe(true);
    expect(estimate.settings).toEqual(createDefaultPriceSettings());
  });

  it('supports all-zero prices and still reports the quantities', () => {
    const estimate = calculateCost({
      batches: [batch({ sheetsUsed: 3, placedPieceCount: 20, edgeBandMeters: 15 })],
      settings: {
        sheetPrice: 0,
        edgeBandPricePerMeter: 0,
        laborMode: 'per-piece',
        laborRate: 0,
        hardwareCost: 0
      },
      unitCount: 4
    });

    expect(estimate.total).toBe(0);
    expect(estimate.pricePerUnit).toBe(0);
    expect(estimate.totals.sheetsUsed).toBe(3);
    expect(estimate.totals.pieceCount).toBe(20);
    expect(estimate.totals.edgeBandMeters).toBe(15);
    expect(estimate.lines.map((line) => line.amount)).toEqual([0, 0, 0, 0]);
    expect(estimate.materials[0]).toMatchObject({ unitPrice: 0, amount: 0, sheets: 3 });
  });

  it('is free of floating-point drift for currency amounts', () => {
    const estimate = calculateCost({
      batches: [
        batch({ material: 'A', sheetsUsed: 0.1, edgeBandMeters: 0.1 }),
        batch({ material: 'B', sheetsUsed: 0.2, edgeBandMeters: 0.2 })
      ],
      settings: settings({ sheetPrice: 1_000, edgeBandPricePerMeter: 1_000, laborRate: 0, hardwareCost: 0 })
    });

    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754; the invoice must show 300.
    expect(estimate.totals.sheetsUsed).toBeCloseTo(0.3, 12);
    expect(estimate.mdfCost).toBe(300);
    expect(estimate.edgeBandCost).toBe(300);
    expect(estimate.total).toBe(600);
    expect(Number.isInteger(estimate.total)).toBe(true);
  });

  it('rounds halves up and normalises negative zero', () => {
    expect(roundMoney(0.4)).toBe(0);
    expect(roundMoney(0.5)).toBe(1);
    expect(roundMoney(2.5)).toBe(3);
    expect(roundMoney(1_234.49)).toBe(1_234);
    expect(roundMoney(1_234.5)).toBe(1_235);
    expect(Object.is(roundMoney(-0), 0)).toBe(true);
    expect(Object.is(roundMoney(-0.4), 0)).toBe(true);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);

    const estimate = calculateCost({
      batches: [batch({ sheetsUsed: 1 })],
      settings: settings({ sheetPrice: 1_000.5, edgeBandPricePerMeter: 0, laborRate: 0, hardwareCost: 0 })
    });
    expect(estimate.mdfCost).toBe(1_001);
  });

  it('rounds the per-unit price and ignores invalid unit counts', () => {
    const base = {
      batches: [batch({ sheetsUsed: 1, edgeBandMeters: 0 })],
      settings: settings({
        sheetPrice: 10_000_001,
        edgeBandPricePerMeter: 0,
        laborMode: 'flat',
        laborRate: 0,
        hardwareCost: 0
      })
    };

    expect(calculateCost({ ...base, unitCount: 3 }).pricePerUnit).toBe(3_333_334);
    expect(calculateCost({ ...base, unitCount: 0 }).pricePerUnit).toBeNull();
    expect(calculateCost({ ...base, unitCount: -2 }).pricePerUnit).toBeNull();
    expect(calculateCost({ ...base, unitCount: Number.NaN }).pricePerUnit).toBeNull();
    expect(calculateCost(base).pricePerUnit).toBeNull();
    expect(calculateCost(base).totals.unitCount).toBeNull();
  });

  it('falls back to zero settings when they are omitted', () => {
    const estimate = calculateCost({
      batches: [batch({ sheetsUsed: 2, edgeBandMeters: 5 })]
    });
    expect(estimate.total).toBe(0);
    expect(estimate.settings).toEqual(createDefaultPriceSettings());
    expect(estimate.lines[0]?.unitPrice).toBe(0);
  });

  it('throws on invalid settings or batch data instead of producing nonsense', () => {
    expect(() => calculateCost({ batches: [], settings: { sheetPrice: -1 } })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [], settings: { sheetPrice: Number.NaN } })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [], settings: { edgeBandPricePerMeter: Number.NaN } })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [], settings: { laborRate: -5 } })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [], settings: { hardwareCost: Number.POSITIVE_INFINITY } })).toThrow(RangeError);
    expect(() =>
      calculateCost({
        batches: [],
        settings: { materialSheetPrices: { 'سفید ۳۶۶': -10 } }
      })
    ).toThrow(RangeError);
    expect(() =>
      calculateCost({ batches: [], settings: { laborMode: 'per-hour' as never } })
    ).toThrow(RangeError);
    expect(() => calculateCost({ batches: [batch({ sheetsUsed: -1 })] })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [batch({ placedPieceCount: Number.NaN })] })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [batch({ edgeBandMeters: -0.5 })] })).toThrow(RangeError);
    expect(() => calculateCost({ batches: [batch({ pieces: [{ width: -5, height: 10 }] })] })).toThrow(RangeError);
    expect(() => calculateCost({ batches: null as never })).toThrow(TypeError);
  });
});

describe('normalizePriceSettings', () => {
  it('parses Persian/Arabic digits, grouping separators and decimals', () => {
    const normalized = normalizePriceSettings({
      sheetPrice: '۲٬۵۰۰٬۰۰۰',
      edgeBandPricePerMeter: '30,000',
      laborMode: 'per-piece',
      laborRate: '۱۲٫۵',
      hardwareCost: '٠٠٠',
      currency: '  ریال ',
      materialSheetPrices: { 'MDF سه‌میل': '۱٬۲۰۰٬۰۰۰', '': 5, bad: 'x' }
    });

    expect(normalized.sheetPrice).toBe(2_500_000);
    expect(normalized.edgeBandPricePerMeter).toBe(30_000);
    expect(normalized.laborMode).toBe('per-piece');
    expect(normalized.laborRate).toBe(12.5);
    expect(normalized.hardwareCost).toBe(0);
    expect(normalized.currency).toBe('ریال');
    expect(normalized.materialSheetPrices).toEqual({ 'MDF سه‌میل': 1_200_000 });
  });

  it('clamps negatives, drops unknown modes and repairs malformed payloads', () => {
    const normalized = normalizePriceSettings({
      sheetPrice: -100,
      edgeBandPricePerMeter: 'abc',
      laborMode: 'per-hour',
      laborRate: null,
      hardwareCost: {},
      currency: ''
    });

    expect(normalized).toEqual(createDefaultPriceSettings());
    expect(normalizePriceSettings(null)).toEqual(createDefaultPriceSettings());
    expect(normalizePriceSettings([])).toEqual(createDefaultPriceSettings());
    expect(normalizePriceSettings('nope')).toEqual(createDefaultPriceSettings());
    expect(normalizePriceSettings({ sheetPrice: 10 })).toMatchObject({
      sheetPrice: 10,
      laborMode: 'per-sheet',
      currency: DEFAULT_CURRENCY
    });
  });

  it('is idempotent', () => {
    const once = normalizePriceSettings({ sheetPrice: '۱۰۰۰', materialSheetPrices: { A: 2 } });
    expect(normalizePriceSettings(once)).toEqual(once);
  });
});

describe('pricing storage', () => {
  function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      }
    };
  }

  it('round-trips settings through storage', () => {
    const storage = memoryStorage();
    const saved = {
      ...createDefaultPriceSettings(),
      sheetPrice: 4_200_000,
      edgeBandPricePerMeter: 35_000,
      laborMode: 'per-piece' as const,
      laborRate: 25_000,
      hardwareCost: 900_000,
      materialSheetPrices: { 'MDF سه‌میل': 1_100_000 }
    };

    expect(savePriceSettings(saved, storage)).toBe(true);
    expect(storage.data.has(PRICE_SETTINGS_STORAGE_KEY)).toBe(true);
    expect(loadPriceSettings(storage)).toEqual(saved);
  });

  it('returns defaults for missing or corrupted payloads', () => {
    expect(loadPriceSettings(memoryStorage())).toEqual(createDefaultPriceSettings());
    expect(
      loadPriceSettings(memoryStorage({ [PRICE_SETTINGS_STORAGE_KEY]: '{not json' }))
    ).toEqual(createDefaultPriceSettings());
    expect(
      loadPriceSettings(memoryStorage({ [PRICE_SETTINGS_STORAGE_KEY]: '[1,2,3]' }))
    ).toEqual(createDefaultPriceSettings());
  });

  it('survives unavailable or failing storage', () => {
    expect(loadPriceSettings(null)).toEqual(createDefaultPriceSettings());
    expect(savePriceSettings(createDefaultPriceSettings(), null)).toBe(false);

    const failing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      }
    };
    expect(loadPriceSettings(failing)).toEqual(createDefaultPriceSettings());
    expect(savePriceSettings(createDefaultPriceSettings(), failing)).toBe(false);
  });

  it('normalises outdated payloads on read', () => {
    const storage = memoryStorage({
      [PRICE_SETTINGS_STORAGE_KEY]: JSON.stringify({ sheetPrice: '۲٬۰۰۰', laborMode: 'weird' })
    });
    expect(loadPriceSettings(storage)).toMatchObject({
      sheetPrice: 2_000,
      laborMode: 'per-sheet',
      edgeBandPricePerMeter: 0
    });
  });
});

describe('costBatchesFromReport', () => {
  function sampleReport(): { report: CutOptimizationReport; rows: ReturnType<typeof buildCutList> } {
    const rows = buildCutList(createSampleProject().units);
    const report = optimizeCutListByMaterial(rows, { kerf: 4 });
    return { report, rows };
  }

  it('reuses the workbook banded-edge flags for placed pieces', () => {
    const { report, rows } = sampleReport();
    const batches = costBatchesFromReport(report, rows);

    expect(batches).toHaveLength(report.groups.length);
    expect(batches.map((item) => item.material)).toEqual(report.groups.map((item) => item.material));
    expect(batches.reduce((sum, item) => sum + item.sheetsUsed, 0)).toBe(report.totals.sheets);
    expect(batches.reduce((sum, item) => sum + item.placedPieceCount, 0)).toBe(report.totals.placed);

    const meters = batches.reduce((sum, item) => sum + (item.edgeBandMeters ?? 0), 0);
    expect(meters).toBeGreaterThan(0);

    const estimate = calculateCost({
      batches,
      settings: settings({ sheetPrice: 4_000_000, edgeBandPricePerMeter: 40_000, laborMode: 'per-sheet', laborRate: 600_000, hardwareCost: 0 })
    });
    expect(estimate.edgeBand.basis).toBe('known');
    expect(estimate.totals.sheetsUsed).toBe(report.totals.sheets);
    expect(estimate.mdfCost).toBe(report.totals.sheets * 4_000_000);
    expect(estimate.total).toBe(
      estimate.mdfCost + estimate.edgeBandCost + estimate.laborCost + estimate.hardwareCost
    );
  });

  it('falls back to the perimeter when the cut list has no banding data', () => {
    const { report } = sampleReport();
    const batches = costBatchesFromReport(report, []);
    const meters = batches.reduce((sum, item) => sum + (item.edgeBandMeters ?? 0), 0);

    expect(meters).toBe(0);
    const perimeter = report.groups.reduce(
      (sum, group) =>
        sum +
        edgeBandMetersFromPerimeter(
          group.result.sheets.flatMap((sheet) =>
            sheet.pieces.map((piece) => ({ width: piece.width, height: piece.height }))
          )
        ),
      0
    );
    const estimate = calculateCost({ batches, settings: settings({ edgeBandPricePerMeter: 1_000 }) });
    expect(estimate.edgeBand.basis).toBe('perimeter');
    expect(estimate.totals.edgeBandMeters).toBeCloseTo(perimeter, 9);
  });

  it('can force the perimeter basis', () => {
    const { report, rows } = sampleReport();
    const batches = costBatchesFromReport(report, rows, { edgeBandBasis: 'perimeter' });
    expect(batches.every((item) => item.edgeBandMeters === undefined)).toBe(true);
    const estimate = calculateCost({ batches, settings: settings() });
    expect(estimate.edgeBand.basis).toBe('perimeter');
  });
});

describe('formatting helpers', () => {
  it('formats money with Persian digits and no decimals', () => {
    expect(formatMoneyValue(0)).toBe('۰');
    expect(formatMoneyValue(2_500_000)).toContain('۲');
    expect(formatMoneyValue(2_500_000)).toContain('۵');
    expect(formatMoneyValue(1_234.6)).toBe(formatMoneyValue(1_235));
    expect(formatMoney(2_500_000)).toBe(`${formatMoneyValue(2_500_000)} تومان`);
    expect(formatMoney(2_500_000, 'ریال')).toBe(`${formatMoneyValue(2_500_000)} ریال`);
    expect(formatMoney(2_500_000, '  ')).toBe(`${formatMoneyValue(2_500_000)} تومان`);
    expect(formatMoneyValue(Number.NaN)).toBe('—');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('formats quantities with at most two decimals', () => {
    expect(formatQuantity(127.43)).toBe(formatQuantity(127.43));
    expect(formatQuantity(127.4300)).not.toContain('،');
    expect(formatQuantity(12)).toBe(formatQuantity(12));
    expect(formatQuantity(Number.NaN)).toBe('—');
  });
});
