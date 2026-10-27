import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { OptimizationResult, PlacedPiece, SheetLayout } from '../lib/optimizer';

const faNumber = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const faDimensionNumber = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 0,
  useGrouping: false
});
const faDecimal = new Intl.NumberFormat('fa-IR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const PIECE_COLORS = [
  { fill: '#dcefec', stroke: '#5c9a90', text: '#234c47' },
  { fill: '#f7e8d7', stroke: '#c08a51', text: '#5c4329' },
  { fill: '#e2ebf5', stroke: '#6f90b9', text: '#2e4867' },
  { fill: '#ece6f5', stroke: '#8a75b2', text: '#453960' },
  { fill: '#e2f0e6', stroke: '#6d9d79', text: '#2e5138' },
  { fill: '#f4e8e4', stroke: '#b88377', text: '#5b3c35' },
  { fill: '#eef2e2', stroke: '#94a263', text: '#474e2c' },
  { fill: '#e3eef0', stroke: '#6d98a0', text: '#2a4950' }
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncate(value: string, maxCharacters: number): string {
  if (maxCharacters <= 1) return '';
  if (value.length <= maxCharacters) return value;
  if (maxCharacters <= 2) return value.slice(0, maxCharacters);
  return `${value.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${faDecimal.format(value)}٪`;
}

function formatArea(area: number): string {
  if (!Number.isFinite(area) || area <= 0) return '۰';
  return faDecimal.format(area / 1_000_000);
}

function formatDimension(value: number): string {
  return faDimensionNumber.format(Math.round(value));
}

function utilizationTone(percentage: number): string {
  if (percentage >= 85) return 'good';
  if (percentage >= 65) return 'medium';
  return 'low';
}

interface PieceShapeProps {
  piece: PlacedPiece;
  sheetIndex: number;
  mapId: string;
}

/**
 * A single part inside the sheet SVG. Labels are sized in sheet millimetres so
 * they stay readable after the SVG is scaled down; very small offcuts omit the
 * text but keep a native tooltip.
 */
function PieceShape({ piece, sheetIndex, mapId }: PieceShapeProps) {
  const color = PIECE_COLORS[hashString(piece.id || piece.name) % PIECE_COLORS.length]!;
  const clipId = `${mapId}-clip-${piece.instanceId}`.replace(/[^\w-]/g, '-');
  const centerX = piece.x + piece.width / 2;
  const centerY = piece.y + piece.height / 2;

  // Font sizes are expressed in sheet millimetres. A 1830 mm sheet is rendered
  // roughly 250 px wide, so 50 mm of text is about 7 px on screen.
  const horizontal = piece.width >= 240 && piece.height >= 130;
  const vertical = !horizontal && piece.width >= 48 && piece.height >= 210;
  const fontSize = horizontal
    ? clamp(Math.min(piece.width * 0.13, piece.height * 0.2), 40, 80)
    : clamp(piece.width * 0.62, 30, 68);

  const dimensions = `${formatDimension(piece.sourceWidth)} × ${formatDimension(piece.sourceHeight)}`;
  let nameLine = '';
  let showDimensions = false;

  if (horizontal) {
    const charactersPerLine = Math.max(3, Math.floor((piece.width * 0.9) / (fontSize * 0.54)));
    const dimensionCharacters = Math.max(
      3,
      Math.floor((piece.width * 0.9) / (fontSize * 0.72 * 0.54))
    );
    nameLine = truncate(piece.name, charactersPerLine);
    showDimensions =
      piece.height >= fontSize * 2.55 &&
      dimensions.length <= dimensionCharacters &&
      piece.width >= 330;
  } else if (vertical) {
    const charactersPerLine = Math.max(3, Math.floor((piece.height * 0.86) / (fontSize * 0.54)));
    nameLine = truncate(piece.name, charactersPerLine);
    showDimensions = piece.width >= fontSize * 1.95 && piece.height >= fontSize * 3.4;
  }

  const tooltip = [
    piece.name,
    piece.reference,
    `${formatDimension(piece.sourceWidth)} × ${formatDimension(piece.sourceHeight)} میلی‌متر`,
    piece.rotated ? 'چرخیده ۹۰ درجه' : '',
    `موقعیت: ${formatDimension(piece.x)} ، ${formatDimension(piece.y)}`,
    `ورق ${faNumber.format(sheetIndex)}`
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <g className="cutmap-piece" data-piece-id={piece.instanceId}>
      <rect
        x={piece.x}
        y={piece.y}
        width={piece.width}
        height={piece.height}
        fill={color.fill}
        stroke={color.stroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        rx={Math.min(6, piece.width * 0.01, piece.height * 0.01)}
      />
      <title>{tooltip}</title>
      <clipPath id={clipId}>
        <rect x={piece.x} y={piece.y} width={piece.width} height={piece.height} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
      {nameLine && horizontal && (
        <>
          <text
            x={centerX}
            y={showDimensions ? centerY - fontSize * 0.62 : centerY}
            textAnchor="middle"
            dominantBaseline="middle"
            direction="rtl"
            fill={color.text}
            fontSize={fontSize}
            fontWeight={600}
            pointerEvents="none"
          >
            {nameLine}
          </text>
          {showDimensions && (
            <text
              x={centerX}
              y={centerY + fontSize * 0.72}
              textAnchor="middle"
              dominantBaseline="middle"
              direction="rtl"
              fill={color.stroke}
              fontSize={fontSize * 0.78}
              pointerEvents="none"
            >
              {dimensions}
            </text>
          )}
        </>
      )}
      {nameLine && vertical && (
        <>
          <text
            x={showDimensions ? centerX - fontSize * 0.5 : centerX}
            y={centerY}
            textAnchor="middle"
            dominantBaseline="middle"
            direction="rtl"
            fill={color.text}
            fontSize={fontSize}
            fontWeight={600}
            pointerEvents="none"
            transform={`rotate(-90 ${showDimensions ? centerX - fontSize * 0.5 : centerX} ${centerY})`}
          >
            {nameLine}
          </text>
          {showDimensions && (
            <text
              x={centerX + fontSize * 0.55}
              y={centerY}
              textAnchor="middle"
              dominantBaseline="middle"
              direction="rtl"
              fill={color.stroke}
              fontSize={fontSize * 0.72}
              pointerEvents="none"
              transform={`rotate(-90 ${centerX + fontSize * 0.55} ${centerY})`}
            >
              {dimensions}
            </text>
          )}
        </>
      )}
      </g>
    </g>
  );
}

interface SheetFigureProps {
  sheet: SheetLayout;
  mapId: string;
}

function SheetFigure({ sheet, mapId }: SheetFigureProps) {
  return (
    <figure className="cutmap-sheet">
      <figcaption className="cutmap-sheet-head">
        <div>
          <strong>ورق {faNumber.format(sheet.index)}</strong>
          <span>{faNumber.format(sheet.pieces.length)} قطعه</span>
        </div>
        <span className={`cutmap-util cutmap-util-${utilizationTone(sheet.usedPercentage)}`}>
          {formatPercent(sheet.usedPercentage)} استفاده
        </span>
      </figcaption>
      <div className="cutmap-canvas">
        <svg
          className="cutmap-svg"
          viewBox={`0 0 ${sheet.width} ${sheet.height}`}
          role="img"
          aria-label={`نقشه برش ورق ${sheet.index} با ${sheet.pieces.length} قطعه`}
          xmlns={SVG_NS}
          preserveAspectRatio="xMidYMid meet"
        >
          <rect
            x={0}
            y={0}
            width={sheet.width}
            height={sheet.height}
            fill="#fbfdfd"
            stroke="#cfdcde"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {sheet.pieces.map((piece) => (
            <PieceShape
              key={piece.instanceId}
              piece={piece}
              sheetIndex={sheet.index}
              mapId={mapId}
            />
          ))}
        </svg>
      </div>
      <div className="cutmap-sheet-foot">
        <span>پرت {formatPercent(sheet.wastePercentage)}</span>
        <span dir="ltr">
          {formatDimension(sheet.width)} × {formatDimension(sheet.height)} mm
        </span>
      </div>
    </figure>
  );
}

interface StatItemProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

function StatItem({ label, value, detail, tone = 'neutral' }: StatItemProps) {
  return (
    <div className={`cutmap-stat cutmap-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export interface CutMapResult extends OptimizationResult {
  /** Signature of the cut list this layout was calculated from. */
  signature?: string;
  /** Wall-clock time of the calculation. */
  computedAt?: Date;
}

export interface CutMapProps {
  result: CutMapResult;
  /** Material or job title shown above the map. */
  title?: string;
  /** Optional one-line note below the title. */
  subtitle?: string;
  className?: string;
}

/**
 * Renders the optimizer output as printable, RTL sheet maps using plain SVG.
 * No canvas, no charting dependency; one <figure> per raw sheet.
 */
export function CutMap({ result, title = 'نقشه برش', subtitle, className }: CutMapProps) {
  const mapId = useId().replace(/[^\w-]/g, '-');
  const wasteTone =
    result.wastePercentage <= 15 ? 'good' : result.wastePercentage <= 30 ? 'warn' : 'bad';
  const pieceDetail =
    result.rejected.length > 0
      ? `از ${faNumber.format(result.requestedPieceCount)} قطعه‌ی درخواستی`
      : 'تمام قطعات درخواستی چیده شدند';
  const kerfLabel = Number.isInteger(result.kerf)
    ? faNumber.format(result.kerf)
    : faDecimal.format(result.kerf);
  const rootClassName = className ? `cutmap ${className}` : 'cutmap';

  return (
    <section
      className={rootClassName}
      dir="rtl"
      lang="fa"
      aria-label={`نقشه برش ${title}`}
    >
      <header className="cutmap-heading">
        <div>
          <span className="cutmap-eyebrow">چیدمان بهینه‌ی ورق</span>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="cutmap-sheet-chip">
          {faNumber.format(result.totalSheetsUsed)} ورق
        </span>
      </header>

      <div className="cutmap-stats" role="group" aria-label="آمار بهینه‌سازی برش">
        <StatItem
          label="ورق‌های مصرفی"
          value={faNumber.format(result.totalSheetsUsed)}
          detail={`${formatArea(result.totalSheetArea)} متر مربع ورق خام`}
        />
        <StatItem
          label="درصد پرت"
          value={formatPercent(result.wastePercentage)}
          detail={`${formatArea(result.totalWasteArea)} متر مربع پرت و تیغ`}
          tone={wasteTone}
        />
        <StatItem
          label="قطعات چیده‌شده"
          value={faNumber.format(result.placedPieceCount)}
          detail={pieceDetail}
          tone={result.rejected.length > 0 ? 'warn' : 'neutral'}
        />
        <StatItem
          label="مشخصات ورق"
          value={`${formatDimension(result.sheet.width)} × ${formatDimension(result.sheet.height)}`}
          detail={`میلی‌متر · تیغ ${kerfLabel} میلی‌متر`}
        />
      </div>

      {result.rejected.length > 0 && (
        <div className="cutmap-rejected" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>{faNumber.format(result.rejected.length)} قطعه چیده نشد</strong>
            <ul>
              {result.rejected.map((item, index) => (
                <li key={`${item.id}-${item.reason}-${index}`}>{item.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {result.sheets.length > 0 ? (
        <div className="cutmap-sheets">
          {result.sheets.map((sheet) => (
            <SheetFigure key={sheet.index} sheet={sheet} mapId={mapId} />
          ))}
        </div>
      ) : (
        <div className="cutmap-empty">
          {result.rejected.length > 0
            ? 'هیچ قطعه‌ای قابل چیدمان نبود؛ ابعاد ورق یا اندازه‌ی قطعات را بررسی کنید.'
            : 'قطعه‌ای برای چیدمان روی ورق وجود ندارد.'}
        </div>
      )}

      <p className="cutmap-legend">
        هر رنگ فقط برای تفکیک قطعات است. فاصله‌ی بین قطعات معادل ضخامت تیغ اره در نظر گرفته
        شده و نقشه با برش‌های سرتاسری (گیوتین) قابل اجرا است.
      </p>
    </section>
  );
}

export default CutMap;
