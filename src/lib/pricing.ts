/**
 * Pure costing model for a Pro.Max quote.
 *
 * The estimator turns the output of the cut optimizer (sheets per material and
 * the banded edge length of the placed parts) plus a set of workshop prices
 * into an itemised, currency-rounded estimate.
 *
 * Money policy: every line item is rounded to a whole currency unit (تومان has
 * no practical subunit) exactly once, and the total is the integer sum of the
 * rounded lines. That guarantees `total === sum(lines)` with no floating-point
 * drift on an invoice, where ۰٫۰۰۰۰۰۰۱ differences look like bugs.
 */

import type { CutOptimizationReport } from './optimizer';

export const DEFAULT_CURRENCY = 'تومان';

export type LaborMode = 'flat' | 'per-sheet' | 'per-piece';

export const LABOR_MODE_LABELS: Record<LaborMode, string> = {
  flat: 'مبلغ ثابت',
  'per-sheet': 'به ازای هر ورق',
  'per-piece': 'به ازای هر قطعه'
};

export const LABOR_MODE_UNITS: Record<LaborMode, string> = {
  flat: 'فاکتور',
  'per-sheet': 'ورق',
  'per-piece': 'قطعه'
};

const LABOR_MODES = new Set<LaborMode>(['flat', 'per-sheet', 'per-piece']);

export interface PriceSettings {
  /** Price of one raw sheet for materials without an override. */
  sheetPrice: number;
  /** Optional per-material sheet prices (e.g. 3 mm backing board is cheaper). */
  materialSheetPrices: Record<string, number>;
  /** Edge banding tape price per metre. */
  edgeBandPricePerMeter: number;
  laborMode: LaborMode;
  /** Flat amount, amount per sheet, or amount per piece — see `laborMode`. */
  laborRate: number;
  /** Manual hardware / fittings total (hinges, slides, screws…). */
  hardwareCost: number;
  /** Currency label used by the UI and the invoice. */
  currency: string;
}

export interface PieceSize {
  /** Placed width in millimetres. */
  width: number;
  /** Placed height in millimetres. */
  height: number;
}

/**
 * One material group produced by the optimizer.
 *
 * `edgeBandMeters` is the known banded-edge length. When it is omitted the
 * estimator falls back to the full perimeter of the placed parts, which is a
 * safe over-estimate.
 */
export interface CostBatch {
  material: string;
  sheetsUsed: number;
  placedPieceCount: number;
  edgeBandMeters?: number;
  /** Placed parts, used only for the perimeter fallback. */
  pieces?: readonly PieceSize[];
}

export interface MaterialCostLine {
  material: string;
  sheets: number;
  /** Price applied to one sheet of this material. */
  unitPrice: number;
  amount: number;
  /** True when the shared `sheetPrice` was used instead of an override. */
  usesDefaultPrice: boolean;
}

export type CostLineKey = 'mdf' | 'edge-band' | 'labor' | 'hardware';

export interface CostLineItem {
  key: CostLineKey;
  label: string;
  quantity: number;
  unit: string;
  /** Price of one unit; for a flat fee this equals the amount. */
  unitPrice: number;
  amount: number;
}

export type EdgeBandBasis = 'known' | 'perimeter' | 'mixed' | 'none';

export interface CostEstimate {
  lines: CostLineItem[];
  /** Per-material sheet rows behind the MDF line. */
  materials: MaterialCostLine[];
  currency: string;
  mdfCost: number;
  edgeBandCost: number;
  laborCost: number;
  hardwareCost: number;
  /** Integer currency units. */
  total: number;
  /** Rounded `total / unitCount`, or `null` when no unit count is given. */
  pricePerUnit: number | null;
  totals: {
    sheetsUsed: number;
    pieceCount: number;
    edgeBandMeters: number;
    materialCount: number;
    unitCount: number | null;
  };
  edgeBand: {
    meters: number;
    basis: EdgeBandBasis;
  };
  /** Snapshot of the prices used, so an old invoice keeps its numbers. */
  settings: PriceSettings;
}

export interface CostInput {
  batches: readonly CostBatch[];
  settings?: Partial<PriceSettings>;
  unitCount?: number | null;
}

const EPSILON = 1e-9;
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Round to whole currency units without producing `-0`. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Digits-only parser for prices: grouping commas are separators, not decimals. */
function parsePriceInput(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== 'string') return Number.NaN;
  const normalized = value
    .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(AR_DIGITS.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/[٬,\s]/g, '');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

export function createDefaultPriceSettings(): PriceSettings {
  return {
    sheetPrice: 0,
    materialSheetPrices: {},
    edgeBandPricePerMeter: 0,
    laborMode: 'per-sheet',
    laborRate: 0,
    hardwareCost: 0,
    currency: DEFAULT_CURRENCY
  };
}

/**
 * Forgiving normaliser for user input and `localStorage` payloads: unknown or
 * invalid values fall back to defaults and negative prices are clamped to 0.
 * Use `calculateCost` for the strict, throwing variant.
 */
export function normalizePriceSettings(raw: unknown): PriceSettings {
  const defaults = createDefaultPriceSettings();
  if (!isRecord(raw)) return defaults;

  const readPrice = (value: unknown, fallback: number): number => {
    const parsed = parsePriceInput(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed < 0 ? 0 : parsed;
  };

  const materialSheetPrices: Record<string, number> = {};
  if (isRecord(raw.materialSheetPrices)) {
    for (const [material, value] of Object.entries(raw.materialSheetPrices)) {
      const name = material.trim();
      if (!name) continue;
      const parsed = parsePriceInput(value);
      if (!Number.isFinite(parsed)) continue;
      materialSheetPrices[name] = parsed < 0 ? 0 : parsed;
    }
  }

  const laborMode =
    typeof raw.laborMode === 'string' && LABOR_MODES.has(raw.laborMode as LaborMode)
      ? (raw.laborMode as LaborMode)
      : defaults.laborMode;

  const currency =
    typeof raw.currency === 'string' && raw.currency.trim()
      ? raw.currency.trim()
      : defaults.currency;

  return {
    sheetPrice: readPrice(raw.sheetPrice, defaults.sheetPrice),
    materialSheetPrices,
    edgeBandPricePerMeter: readPrice(raw.edgeBandPricePerMeter, defaults.edgeBandPricePerMeter),
    laborMode,
    laborRate: readPrice(raw.laborRate, defaults.laborRate),
    hardwareCost: readPrice(raw.hardwareCost, defaults.hardwareCost),
    currency
  };
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} باید عددی متناهی و بزرگ‌تر یا مساوی صفر باشد.`);
  }
}

function resolveSettings(settings: Partial<PriceSettings> | undefined): PriceSettings {
  const defaults = createDefaultPriceSettings();
  if (settings === undefined) return defaults;

  const laborMode = settings.laborMode ?? defaults.laborMode;
  if (!LABOR_MODES.has(laborMode)) {
    throw new RangeError('روش محاسبه‌ی دستمزد نامعتبر است.');
  }

  const resolved: PriceSettings = {
    sheetPrice: settings.sheetPrice ?? defaults.sheetPrice,
    materialSheetPrices: { ...(settings.materialSheetPrices ?? {}) },
    edgeBandPricePerMeter: settings.edgeBandPricePerMeter ?? defaults.edgeBandPricePerMeter,
    laborMode,
    laborRate: settings.laborRate ?? defaults.laborRate,
    hardwareCost: settings.hardwareCost ?? defaults.hardwareCost,
    currency:
      typeof settings.currency === 'string' && settings.currency.trim()
        ? settings.currency.trim()
        : defaults.currency
  };

  assertNonNegative(resolved.sheetPrice, 'قیمت هر ورق');
  assertNonNegative(resolved.edgeBandPricePerMeter, 'قیمت هر متر نوار لبه');
  assertNonNegative(resolved.laborRate, 'نرخ دستمزد');
  assertNonNegative(resolved.hardwareCost, 'هزینه‌ی یراق‌آلات');
  for (const [material, price] of Object.entries(resolved.materialSheetPrices)) {
    assertNonNegative(price, `قیمت ورق «${material}»`);
  }

  return resolved;
}

/** Full perimeter of a rectangular part in metres. */
export function piecePerimeterMeters(piece: PieceSize): number {
  const width = Number.isFinite(piece.width) ? piece.width : 0;
  const height = Number.isFinite(piece.height) ? piece.height : 0;
  return (2 * (width + height)) / 1000;
}

/** Sum of the perimeters of the given parts, in metres. */
export function edgeBandMetersFromPerimeter(pieces: readonly PieceSize[]): number {
  return pieces.reduce((sum, piece) => sum + piecePerimeterMeters(piece), 0);
}

interface MergedBatch {
  material: string;
  sheetsUsed: number;
  placedPieceCount: number;
  edgeBandMeters: number;
  knownEdgeBatches: number;
  perimeterBatches: number;
}

function readBatch(batch: CostBatch, index: number): MergedBatch {
  const material =
    typeof batch.material === 'string' && batch.material.trim()
      ? batch.material.trim()
      : `بدون متریال ${index + 1}`;

  assertNonNegative(batch.sheetsUsed, `تعداد ورق «${material}»`);
  assertNonNegative(batch.placedPieceCount, `تعداد قطعات «${material}»`);

  const pieces = Array.isArray(batch.pieces) ? batch.pieces : [];
  for (const piece of pieces) {
    assertNonNegative(piece?.width, `عرض قطعه در «${material}»`);
    assertNonNegative(piece?.height, `طول قطعه در «${material}»`);
  }

  const hasKnownEdge = batch.edgeBandMeters !== undefined && batch.edgeBandMeters !== null;
  if (hasKnownEdge) {
    assertNonNegative(batch.edgeBandMeters, `متراژ نوار لبه‌ی «${material}»`);
  }

  return {
    material,
    sheetsUsed: batch.sheetsUsed,
    placedPieceCount: batch.placedPieceCount,
    edgeBandMeters: hasKnownEdge
      ? (batch.edgeBandMeters as number)
      : edgeBandMetersFromPerimeter(pieces),
    knownEdgeBatches: hasKnownEdge ? 1 : 0,
    perimeterBatches: hasKnownEdge ? 0 : pieces.length > 0 ? 1 : 0
  };
}

function mergeBatches(batches: readonly CostBatch[]): MergedBatch[] {
  const merged = new Map<string, MergedBatch>();
  batches.forEach((batch, index) => {
    const current = readBatch(batch, index);
    const existing = merged.get(current.material);
    if (!existing) {
      merged.set(current.material, current);
      return;
    }
    existing.sheetsUsed += current.sheetsUsed;
    existing.placedPieceCount += current.placedPieceCount;
    existing.edgeBandMeters += current.edgeBandMeters;
    existing.knownEdgeBatches += current.knownEdgeBatches;
    existing.perimeterBatches += current.perimeterBatches;
  });
  return [...merged.values()];
}

function edgeBandBasis(materials: readonly MergedBatch[]): EdgeBandBasis {
  const known = materials.reduce((sum, item) => sum + item.knownEdgeBatches, 0);
  const perimeter = materials.reduce((sum, item) => sum + item.perimeterBatches, 0);
  if (known > 0 && perimeter > 0) return 'mixed';
  if (known > 0) return 'known';
  if (perimeter > 0) return 'perimeter';
  return 'none';
}

function normalizeUnitCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * Calculate the itemised cost of a project.
 *
 * @param input.batches One entry per optimized material group.
 * @param input.settings Workshop prices; omitted fields fall back to zero.
 * @param input.unitCount Number of cabinet units for the per-unit price.
 */
export function calculateCost(input: CostInput): CostEstimate {
  const settings = resolveSettings(input.settings);
  if (!Array.isArray(input.batches)) {
    throw new TypeError('ورودی هزینه باید آرایه‌ای از گروه‌های متریال باشد.');
  }

  const materials = mergeBatches(input.batches);
  const sheetsUsed = materials.reduce((sum, item) => sum + item.sheetsUsed, 0);
  const pieceCount = materials.reduce((sum, item) => sum + item.placedPieceCount, 0);
  const edgeBandMeters = materials.reduce((sum, item) => sum + item.edgeBandMeters, 0);

  const materialLines: MaterialCostLine[] = materials.map((item) => {
    const override = settings.materialSheetPrices[item.material];
    const usesDefaultPrice = override === undefined;
    const unitPrice = usesDefaultPrice ? settings.sheetPrice : override;
    return {
      material: item.material,
      sheets: item.sheetsUsed,
      unitPrice,
      amount: roundMoney(item.sheetsUsed * unitPrice),
      usesDefaultPrice
    };
  });

  const mdfCost = materialLines.reduce((sum, line) => sum + line.amount, 0);
  const edgeBandCost = roundMoney(edgeBandMeters * settings.edgeBandPricePerMeter);
  const hardwareCost = roundMoney(settings.hardwareCost);

  let laborQuantity = 1;
  let laborUnit = LABOR_MODE_UNITS[settings.laborMode];
  if (settings.laborMode === 'per-sheet') {
    laborQuantity = sheetsUsed;
    laborUnit = 'ورق';
  } else if (settings.laborMode === 'per-piece') {
    laborQuantity = pieceCount;
    laborUnit = 'قطعه';
  }
  const laborCost =
    settings.laborMode === 'flat'
      ? roundMoney(settings.laborRate)
      : roundMoney(laborQuantity * settings.laborRate);

  const lines: CostLineItem[] = [
    {
      key: 'mdf',
      label: 'هزینه تخته MDF',
      quantity: sheetsUsed,
      unit: 'ورق',
      // Weighted average when several materials share the line.
      unitPrice: sheetsUsed > 0 ? mdfCost / sheetsUsed : settings.sheetPrice,
      amount: mdfCost
    },
    {
      key: 'edge-band',
      label: 'هزینه نوار لبه',
      quantity: edgeBandMeters,
      unit: 'متر',
      unitPrice: settings.edgeBandPricePerMeter,
      amount: edgeBandCost
    },
    {
      key: 'labor',
      label: 'دستمزد / CNC',
      quantity: laborQuantity,
      unit: laborUnit,
      unitPrice: settings.laborRate,
      amount: laborCost
    },
    {
      key: 'hardware',
      label: 'یراق‌آلات',
      quantity: 1,
      unit: 'فاکتور',
      unitPrice: settings.hardwareCost,
      amount: hardwareCost
    }
  ];

  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const unitCount = normalizeUnitCount(input.unitCount);

  return {
    lines,
    materials: materialLines,
    currency: settings.currency,
    mdfCost,
    edgeBandCost,
    laborCost,
    hardwareCost,
    total,
    pricePerUnit: unitCount === null ? null : roundMoney(total / unitCount),
    totals: {
      sheetsUsed,
      pieceCount,
      edgeBandMeters,
      materialCount: materials.length,
      unitCount
    },
    edgeBand: {
      meters: edgeBandMeters,
      basis: edgeBandBasis(materials)
    },
    settings
  };
}

/** Cut-list row shape needed to reuse the workbook's banded-edge flags. */
export interface EdgeAwareCutRow {
  id: string;
  edgeTapePerPieceCm?: number;
}

/**
 * Build estimator batches from the multi-material optimization report.
 *
 * With `edgeBandBasis: 'known'` the exact banded length of the *placed* copies
 * is used (via `edgeTapePerPieceCm`); if the cut list carries no banding data at
 * all it silently falls back to the perimeter of the parts.
 */
export function costBatchesFromReport(
  report: CutOptimizationReport,
  rows: readonly EdgeAwareCutRow[] = [],
  options: { edgeBandBasis?: 'known' | 'perimeter' } = {}
): CostBatch[] {
  const basis = options.edgeBandBasis ?? 'known';
  const edgePerPieceCm = new Map<string, number>();
  for (const row of rows) {
    const value = row.edgeTapePerPieceCm;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      edgePerPieceCm.set(row.id, value);
    }
  }

  const batches: CostBatch[] = report.groups.map((group) => {
    const pieces = group.result.sheets.flatMap((sheet) => sheet.pieces);
    const sizes = pieces.map((piece) => ({ width: piece.width, height: piece.height }));
    const sheetsUsed = group.result.totalSheetsUsed;
    const placedPieceCount = group.result.placedPieceCount;

    if (basis === 'perimeter') {
      return { material: group.material, sheetsUsed, placedPieceCount, pieces: sizes };
    }

    const meters = pieces.reduce(
      (sum, piece) => sum + (edgePerPieceCm.get(piece.id) ?? 0) / 100,
      0
    );
    return {
      material: group.material,
      sheetsUsed,
      placedPieceCount,
      edgeBandMeters: meters,
      pieces: sizes
    };
  });

  if (basis === 'known') {
    const knownTotal = batches.reduce((sum, batch) => sum + (batch.edgeBandMeters ?? 0), 0);
    if (knownTotal <= EPSILON) {
      // No banding flags in the workbook → estimate from the perimeter instead.
      return batches.map((batch) => ({
        material: batch.material,
        sheetsUsed: batch.sheetsUsed,
        placedPieceCount: batch.placedPieceCount,
        pieces: batch.pieces
      }));
    }
  }

  return batches;
}

const moneyFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const quantityFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });

/** Persian grouped number without the currency label. */
export function formatMoneyValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return moneyFormatter.format(roundMoney(value));
}

/** Persian grouped number with the currency label, e.g. «۲٬۵۰۰٬۰۰۰ تومان». */
export function formatMoney(value: number, currency: string = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(value)) return '—';
  const label = currency.trim() || DEFAULT_CURRENCY;
  return `${formatMoneyValue(value)} ${label}`;
}

/** Persian quantity with at most two decimals (metres, sheets, pieces). */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return quantityFormatter.format(value);
}
