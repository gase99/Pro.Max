/**
 * Guillotine cut optimizer (2D bin packing) for panel saws.
 *
 * All dimensions are millimetres. Every placed piece can be separated from the
 * raw sheet using straight, edge-to-edge cuts only, so the resulting layout can
 * be reproduced on a real panel saw (unlike free-form MaxRects packings).
 *
 * The packer uses the "Best Short Side Fit" (BSSF) heuristic: every piece is
 * placed in the free rectangle where the shorter leftover side is the smallest.
 * Several deterministic sort orders / guillotine split rules are evaluated and
 * the layout that needs the fewest sheets wins.
 */

export const DEFAULT_SHEET = { width: 1830, height: 3660 } as const;
export const DEFAULT_KERF_MM = 4;

/** A part type that must be cut. `quantity` copies are produced. */
export interface CutPiece {
  id: string;
  name: string;
  /** Finished width in millimetres. */
  width: number;
  /** Finished height (length) in millimetres. */
  height: number;
  /** Number of identical copies. */
  quantity: number;
  /** Overrides the global rotation setting for this part. */
  canRotate?: boolean;
  /** Optional material label, carried through to the output. */
  material?: string;
  /** Optional grouping label (for the UI / tooltip), e.g. the cabinet name. */
  reference?: string;
}

export interface SheetSize {
  width: number;
  height: number;
}

export interface OptimizeOptions {
  /** Raw sheet size. Defaults to the standard 1830 × 3660 mm board. */
  sheet?: Partial<SheetSize>;
  /** Saw blade thickness in millimetres. Defaults to 4 mm. */
  kerf?: number;
  /** Allow 90° rotation of parts (grain direction excluded). Defaults to true. */
  allowRotation?: boolean;
}

export interface OptimizeInput extends OptimizeOptions {
  pieces: readonly CutPiece[];
}

export type RejectionReason = 'invalid-dimensions' | 'invalid-quantity' | 'too-large';

/** A part (or a batch of copies) that could not be scheduled. */
export interface RejectedPiece {
  id: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
  reason: RejectionReason;
  message: string;
}

/** One physical part placed on a sheet, in sheet coordinates (top-left origin). */
export interface PlacedPiece {
  id: string;
  /** Unique id for this individual copy across the whole result. */
  instanceId: string;
  name: string;
  material?: string;
  reference?: string;
  x: number;
  y: number;
  /** Placed width in mm (already swapped when the part is rotated). */
  width: number;
  height: number;
  /** Dimensions as requested, before any rotation. */
  sourceWidth: number;
  sourceHeight: number;
  rotated: boolean;
  /** 1-based copy number of the requested part. */
  copyIndex: number;
}

export interface SheetLayout {
  /** 1-based sheet number. */
  index: number;
  width: number;
  height: number;
  pieces: PlacedPiece[];
  /** Area covered by the parts themselves, in mm². */
  usedArea: number;
  /** Sheet area that is not covered by parts (includes saw kerf), in mm². */
  wasteArea: number;
  /** 0–100. */
  wastePercentage: number;
  /** 0–100. */
  usedPercentage: number;
}

export interface OptimizationResult {
  sheets: SheetLayout[];
  totalSheetsUsed: number;
  /** Number of physical parts requested (after expanding quantities). */
  requestedPieceCount: number;
  /** Number of physical parts actually placed on sheets. */
  placedPieceCount: number;
  /** Sum of part areas, in mm². */
  totalPieceArea: number;
  /** Total raw sheet area, in mm². */
  totalSheetArea: number;
  /** Total sheet area that is not covered by parts, in mm². */
  totalWasteArea: number;
  /** 0–100 (kerf is counted as waste). */
  wastePercentage: number;
  /** 0–1. */
  wasteRatio: number;
  /** Effective sheet size used by this run. */
  sheet: SheetSize;
  kerf: number;
  allowRotation: boolean;
  /** Parts that were not placed; a non-empty list never invalidates the rest. */
  rejected: RejectedPiece[];
}

const EPSILON = 1e-9;
/** Free rectangles smaller than this are discarded (sub-micron). */
const MIN_FREE_SIZE = 1e-6;

const numberFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });

function formatMm(value: number): string {
  return `${numberFormatter.format(value)} mm`;
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} باید عددی متناهی و بزرگ‌تر از صفر باشد.`);
  }
}

function normalizeOptions(options: OptimizeOptions): {
  sheet: SheetSize;
  kerf: number;
  allowRotation: boolean;
} {
  const sheet: SheetSize = {
    width: options.sheet?.width ?? DEFAULT_SHEET.width,
    height: options.sheet?.height ?? DEFAULT_SHEET.height
  };
  assertPositive(sheet.width, 'عرض ورق');
  assertPositive(sheet.height, 'طول ورق');

  const kerf = options.kerf ?? DEFAULT_KERF_MM;
  if (!Number.isFinite(kerf) || kerf < 0) {
    throw new RangeError('ضخامت تیغ اره باید عددی متناهی و بزرگ‌تر یا مساوی صفر باشد.');
  }

  return { sheet, kerf, allowRotation: options.allowRotation ?? true };
}

function isPiecesArray(value: OptimizeInput | readonly CutPiece[]): value is readonly CutPiece[] {
  return Array.isArray(value);
}

interface WorkPiece {
  width: number;
  height: number;
  canRotate: boolean;
  copyIndex: number;
  sourceIndex: number;
  source: CutPiece;
  area: number;
  maxSide: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OpenSheet {
  freeRects: FreeRect[];
  pieces: PlacedPiece[];
}

interface RectCandidate {
  rectIndex: number;
  rotated: boolean;
  shortSide: number;
  longSide: number;
}

type SplitMode = 'vertical' | 'horizontal';
type Comparator = (a: WorkPiece, b: WorkPiece) => number;

interface Attempt {
  compare: Comparator;
  splitMode: SplitMode;
}

function compareIds(a: WorkPiece, b: WorkPiece): number {
  if (a.source.id !== b.source.id) return a.source.id < b.source.id ? -1 : 1;
  if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
  return a.copyIndex - b.copyIndex;
}

const ATTEMPTS: readonly Attempt[] = [
  {
    compare: (a, b) => b.area - a.area || b.maxSide - a.maxSide || compareIds(a, b),
    splitMode: 'vertical'
  },
  {
    compare: (a, b) => b.area - a.area || b.maxSide - a.maxSide || compareIds(a, b),
    splitMode: 'horizontal'
  },
  {
    compare: (a, b) => b.maxSide - a.maxSide || b.area - a.area || compareIds(a, b),
    splitMode: 'vertical'
  },
  {
    compare: (a, b) => b.maxSide - a.maxSide || b.area - a.area || compareIds(a, b),
    splitMode: 'horizontal'
  },
  {
    compare: (a, b) => b.height - a.height || b.width - a.width || compareIds(a, b),
    splitMode: 'vertical'
  },
  {
    compare: (a, b) => b.width - a.width || b.height - a.height || compareIds(a, b),
    splitMode: 'vertical'
  }
];

/** A part fits a free rectangle without reserving kerf at its far edges. */
function rectFits(rect: FreeRect, width: number, height: number): boolean {
  return width <= rect.width + EPSILON && height <= rect.height + EPSILON;
}

function orientationCandidate(
  rect: FreeRect,
  rectIndex: number,
  piece: WorkPiece,
  rotated: boolean
): RectCandidate | null {
  const width = rotated ? piece.height : piece.width;
  const height = rotated ? piece.width : piece.height;
  if (!rectFits(rect, width, height)) return null;
  const leftoverWidth = rect.width - width;
  const leftoverHeight = rect.height - height;
  return {
    rectIndex,
    rotated,
    shortSide: Math.min(leftoverWidth, leftoverHeight),
    longSide: Math.max(leftoverWidth, leftoverHeight)
  };
}

function isBetterCandidate(candidate: RectCandidate, current: RectCandidate | null): boolean {
  if (!current) return true;
  if (candidate.shortSide < current.shortSide - EPSILON) return true;
  if (candidate.shortSide > current.shortSide + EPSILON) return false;
  return candidate.longSide < current.longSide - EPSILON;
}

/** Best orientation + free rectangle inside a single sheet. */
function findBestInSheet(sheet: OpenSheet, piece: WorkPiece): RectCandidate | null {
  let best: RectCandidate | null = null;
  for (let index = 0; index < sheet.freeRects.length; index += 1) {
    const rect = sheet.freeRects[index]!;
    const normal = orientationCandidate(rect, index, piece, false);
    if (normal && isBetterCandidate(normal, best)) best = normal;
    if (piece.canRotate) {
      const rotated = orientationCandidate(rect, index, piece, true);
      if (rotated && isBetterCandidate(rotated, best)) best = rotated;
    }
  }
  return best;
}

/**
 * Replace a used free rectangle with the two guillotine leftovers.
 *
 * The saw blade consumes a `kerf`-wide strip next to every cut:
 *  - `vertical`: cut the free rectangle with a full-height vertical line right
 *    of the part, then cut the strip below the part horizontally;
 *  - `horizontal`: cut a full-width horizontal line below the part, then cut
 *    the strip right of the part vertically.
 *
 * Both variants are valid edge-to-edge guillotine cut sequences.
 */
function splitFreeRect(
  rect: FreeRect,
  placedWidth: number,
  placedHeight: number,
  kerf: number,
  mode: SplitMode
): FreeRect[] {
  const remainingWidth = rect.width - placedWidth;
  const remainingHeight = rect.height - placedHeight;
  const rightWidth = remainingWidth - kerf;
  const bottomHeight = remainingHeight - kerf;
  const next: FreeRect[] = [];
  if (mode === 'vertical') {
    // Full-height strip on the right + strip under the part.
    if (rightWidth > MIN_FREE_SIZE) {
      next.push({
        x: rect.x + placedWidth + kerf,
        y: rect.y,
        width: rightWidth,
        height: rect.height
      });
    }
    if (bottomHeight > MIN_FREE_SIZE) {
      next.push({
        x: rect.x,
        y: rect.y + placedHeight + kerf,
        width: placedWidth,
        height: bottomHeight
      });
    }
  } else {
    // Full-width strip at the bottom + strip right of the part.
    if (bottomHeight > MIN_FREE_SIZE) {
      next.push({
        x: rect.x,
        y: rect.y + placedHeight + kerf,
        width: rect.width,
        height: bottomHeight
      });
    }
    if (rightWidth > MIN_FREE_SIZE) {
      next.push({
        x: rect.x + placedWidth + kerf,
        y: rect.y,
        width: rightWidth,
        height: placedHeight
      });
    }
  }

  return next;
}

interface PackResult {
  sheets: OpenSheet[];
  rejected: RejectedPiece[];
}

function pack(
  workPieces: readonly WorkPiece[],
  sheetSize: SheetSize,
  kerf: number,
  attempt: Attempt
): PackResult {
  const sorted = [...workPieces].sort(attempt.compare);
  const openSheets: OpenSheet[] = [];
  const rejected: RejectedPiece[] = [];

  for (const piece of sorted) {
    let targetSheet: OpenSheet | null = null;
    let targetCandidate: RectCandidate | null = null;

    for (const sheet of openSheets) {
      const candidate = findBestInSheet(sheet, piece);
      if (candidate && isBetterCandidate(candidate, targetCandidate)) {
        targetSheet = sheet;
        targetCandidate = candidate;
      }
    }

    if (!targetSheet || !targetCandidate) {
      const freshSheet: OpenSheet = {
        freeRects: [{ x: 0, y: 0, width: sheetSize.width, height: sheetSize.height }],
        pieces: []
      };
      const candidate = findBestInSheet(freshSheet, piece);
      if (!candidate) {
        // Pieces are pre-validated, so this is a safety net only.
        rejected.push({
          id: piece.source.id,
          name: piece.source.name,
          width: piece.source.width,
          height: piece.source.height,
          quantity: 1,
          reason: 'too-large',
          message: `«${piece.source.name}» در ورق ${formatMm(sheetSize.width)} × ${formatMm(sheetSize.height)} جای نمی‌گیرد.`
        });
        continue;
      }
      openSheets.push(freshSheet);
      targetSheet = freshSheet;
      targetCandidate = candidate;
    }

    const rect = targetSheet.freeRects[targetCandidate.rectIndex];
    if (!rect) continue;

    const placedWidth = targetCandidate.rotated ? piece.height : piece.width;
    const placedHeight = targetCandidate.rotated ? piece.width : piece.height;

    targetSheet.pieces.push({
      id: piece.source.id,
      instanceId: `${piece.sourceIndex}-${piece.copyIndex}`,
      name: piece.source.name,
      ...(piece.source.material !== undefined ? { material: piece.source.material } : {}),
      ...(piece.source.reference !== undefined ? { reference: piece.source.reference } : {}),
      x: rect.x,
      y: rect.y,
      width: placedWidth,
      height: placedHeight,
      sourceWidth: piece.source.width,
      sourceHeight: piece.source.height,
      rotated: targetCandidate.rotated,
      copyIndex: piece.copyIndex
    });

    targetSheet.freeRects.splice(targetCandidate.rectIndex, 1);
    targetSheet.freeRects.push(
      ...splitFreeRect(rect, placedWidth, placedHeight, kerf, attempt.splitMode)
    );
  }

  return { sheets: openSheets, rejected };
}

function buildSheetLayouts(openSheets: readonly OpenSheet[], sheetSize: SheetSize): SheetLayout[] {
  const sheetArea = sheetSize.width * sheetSize.height;
  return openSheets.map((sheet, index) => {
    const usedArea = sheet.pieces.reduce((sum, piece) => sum + piece.width * piece.height, 0);
    const wasteArea = sheetArea - usedArea;
    return {
      index: index + 1,
      width: sheetSize.width,
      height: sheetSize.height,
      pieces: sheet.pieces,
      usedArea,
      wasteArea,
      wastePercentage: sheetArea > 0 ? (wasteArea / sheetArea) * 100 : 0,
      usedPercentage: sheetArea > 0 ? (usedArea / sheetArea) * 100 : 0
    };
  });
}

/**
 * Optimize a cut list on raw sheets.
 *
 * Accepts either an options object (`optimizeCuts({ pieces, sheet, kerf })`) or
 * the positional form (`optimizeCuts(pieces, { sheet, kerf })`).
 *
 * Invalid parts (zero/negative dimensions, bad quantities, parts larger than the
 * sheet) are reported in `rejected` and do not stop the rest of the layout.
 * Invalid sheet/kerf configuration throws a `RangeError`.
 */
export function optimizeCuts(input: OptimizeInput): OptimizationResult;
export function optimizeCuts(pieces: readonly CutPiece[], options?: OptimizeOptions): OptimizationResult;
export function optimizeCuts(
  inputOrPieces: OptimizeInput | readonly CutPiece[],
  maybeOptions: OptimizeOptions = {}
): OptimizationResult {
  const isArray = isPiecesArray(inputOrPieces);
  const pieces = isArray ? inputOrPieces : inputOrPieces.pieces;
  const options: OptimizeOptions = isArray ? maybeOptions : inputOrPieces;
  const { sheet, kerf, allowRotation } = normalizeOptions(options);

  const workPieces: WorkPiece[] = [];
  const rejected: RejectedPiece[] = [];
  let requestedPieceCount = 0;

  pieces.forEach((piece, sourceIndex) => {
    const rawQuantity: unknown = piece?.quantity;

    if (typeof rawQuantity !== 'number' || !Number.isFinite(rawQuantity) || rawQuantity < 0) {
      rejected.push({
        id: String(piece?.id ?? ''),
        name: String(piece?.name ?? ''),
        width: Number.isFinite(piece?.width) ? piece.width : 0,
        height: Number.isFinite(piece?.height) ? piece.height : 0,
        quantity: 0,
        reason: 'invalid-quantity',
        message: `تعداد «${piece?.name ?? 'قطعه بدون نام'}» نامعتبر است و در محاسبه قرار نگرفت.`
      });
      return;
    }

    const quantity = Math.floor(rawQuantity);
    if (quantity === 0) return;

    const width = piece.width;
    const height = piece.height;
    const dimensionsValid =
      typeof width === 'number' && Number.isFinite(width) && width > 0 &&
      typeof height === 'number' && Number.isFinite(height) && height > 0;

    if (!dimensionsValid) {
      rejected.push({
        id: String(piece.id ?? ''),
        name: String(piece.name ?? ''),
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
        quantity,
        reason: 'invalid-dimensions',
        message: `«${piece.name || 'قطعه بدون نام'}» ابعاد معتبر ندارد؛ عرض و طول باید بزرگ‌تر از صفر باشند.`
      });
      return;
    }

    requestedPieceCount += quantity;
    const canRotate = piece.canRotate ?? allowRotation;
    const fitsNormally = width <= sheet.width + EPSILON && height <= sheet.height + EPSILON;
    const fitsRotated =
      canRotate && height <= sheet.width + EPSILON && width <= sheet.height + EPSILON;

    if (!fitsNormally && !fitsRotated) {
      rejected.push({
        id: String(piece.id ?? ''),
        name: String(piece.name ?? ''),
        width,
        height,
        quantity,
        reason: 'too-large',
        message: `«${piece.name || 'قطعه بدون نام'}» با ابعاد ${formatMm(width)} × ${formatMm(height)} در ورق ${formatMm(sheet.width)} × ${formatMm(sheet.height)} جای نمی‌گیرد.`
      });
      return;
    }

    for (let copyIndex = 1; copyIndex <= quantity; copyIndex += 1) {
      workPieces.push({
        width,
        height,
        canRotate,
        copyIndex,
        sourceIndex,
        source: piece,
        area: width * height,
        maxSide: Math.max(width, height)
      });
    }
  });

  let bestPack: PackResult | null = null;
  for (const attempt of ATTEMPTS) {
    const candidate = pack(workPieces, sheet, kerf, attempt);
    if (!bestPack || candidate.sheets.length < bestPack.sheets.length) {
      bestPack = candidate;
    }
  }

  const openSheets = bestPack?.sheets ?? [];
  const sheets = buildSheetLayouts(openSheets, sheet);
  const totalSheetArea = sheet.width * sheet.height * sheets.length;
  const totalPieceArea = sheets.reduce((sum, layout) => sum + layout.usedArea, 0);
  const totalWasteArea = totalSheetArea - totalPieceArea;
  const placedPieceCount = sheets.reduce((sum, layout) => sum + layout.pieces.length, 0);
  const wasteRatio = totalSheetArea > 0 ? totalWasteArea / totalSheetArea : 0;
  const rejectedPieces = rejected.concat(bestPack?.rejected ?? []);

  return {
    sheets,
    totalSheetsUsed: sheets.length,
    requestedPieceCount,
    placedPieceCount,
    totalPieceArea,
    totalSheetArea,
    totalWasteArea,
    wastePercentage: wasteRatio * 100,
    wasteRatio,
    sheet,
    kerf,
    allowRotation,
    rejected: rejectedPieces
  };
}

/**
 * Expand the cut-list rows produced by `buildCutList` into optimiser input.
 * Cut-list dimensions are stored in centimetres, the optimiser works in
 * millimetres.
 */
export interface CutListRowLike {
  id: string;
  unitName: string;
  part: string;
  width: number;
  length: number;
  quantity: number;
  material: string;
}

export function cutRowsToPieces(rows: readonly CutListRowLike[], cmToMillimetreFactor = 10): CutPiece[] {
  // Round to 0.001 mm so 73.4 cm becomes exactly 734 mm instead of
  // 734.0000000000001, which would otherwise reserve hairline gaps.
  const toMillimetres = (value: number): number =>
    Math.round(value * cmToMillimetreFactor * 1000) / 1000;

  return rows.map((row) => ({
    id: row.id,
    name: row.part,
    reference: row.unitName,
    width: toMillimetres(row.width),
    height: toMillimetres(row.length),
    quantity: row.quantity,
    material: row.material
  }));
}

/** Group cut-list rows by material; each material gets its own sheet stock. */
export function groupRowsByMaterial<T extends { material: string }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.material || 'بدون متریال';
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export interface MaterialOptimization {
  material: string;
  rowCount: number;
  result: OptimizationResult;
}

export interface OptimizationTotals {
  sheets: number;
  placed: number;
  requested: number;
  /** Total number of physical copies that could not be placed. */
  rejected: number;
  pieceArea: number;
  sheetArea: number;
  wasteArea: number;
  /** 0–100 across all materials. */
  wastePercentage: number;
}

export interface CutOptimizationReport {
  groups: MaterialOptimization[];
  totals: OptimizationTotals;
  settings: {
    sheet: SheetSize;
    kerf: number;
    allowRotation: boolean;
  };
}

/**
 * Full workshop pipeline: take the centimetre cut-list rows from the project
 * engine, group them by material, optimise each material on its own sheet
 * stock and aggregate the totals.
 */
export function optimizeCutListByMaterial(
  rows: readonly CutListRowLike[],
  options: OptimizeOptions = {}
): CutOptimizationReport {
  const normalized = normalizeOptions(options);
  const groups: MaterialOptimization[] = [...groupRowsByMaterial(rows)]
    .map(([material, materialRows]) => ({
      material,
      rowCount: materialRows.length,
      result: optimizeCuts({
        pieces: cutRowsToPieces(materialRows),
        sheet: normalized.sheet,
        kerf: normalized.kerf,
        allowRotation: normalized.allowRotation
      })
    }))
    .sort((a, b) => b.result.totalPieceArea - a.result.totalPieceArea);

  const totals = groups.reduce<OptimizationTotals>(
    (accumulator, group) => {
      accumulator.sheets += group.result.totalSheetsUsed;
      accumulator.placed += group.result.placedPieceCount;
      accumulator.requested += group.result.requestedPieceCount;
      accumulator.rejected += group.result.rejected.reduce((sum, item) => sum + item.quantity, 0);
      accumulator.pieceArea += group.result.totalPieceArea;
      accumulator.sheetArea += group.result.totalSheetArea;
      accumulator.wasteArea += group.result.totalWasteArea;
      return accumulator;
    },
    {
      sheets: 0,
      placed: 0,
      requested: 0,
      rejected: 0,
      pieceArea: 0,
      sheetArea: 0,
      wasteArea: 0,
      wastePercentage: 0
    }
  );
  totals.wastePercentage = totals.sheetArea > 0 ? (totals.wasteArea / totals.sheetArea) * 100 : 0;

  return {
    groups,
    totals,
    settings: {
      sheet: normalized.sheet,
      kerf: normalized.kerf,
      allowRotation: normalized.allowRotation
    }
  };
}
