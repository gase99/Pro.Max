import { Fragment } from 'react';
import { AlertTriangle, Coins, Printer, SlidersHorizontal } from 'lucide-react';
import { formatMoneyValue, formatQuantity } from '../lib/pricing';
import type { CostEstimate } from '../lib/pricing';

const EDGE_BAND_NOTES: Record<CostEstimate['edgeBand']['basis'], string> = {
  known: 'متراژ نوار لبه از مجموع لبه‌های واقعی قطعات چیده‌شده محاسبه شده است.',
  perimeter: 'برای قطعات این پروژه طول لبه ثبت نشده؛ متراژ از محیط کامل قطعات چیده‌شده برآورد شده است (محافظه‌کارانه).',
  mixed: 'بخشی از متراژ نوار لبه از لبه‌های واقعی و بخشی از محیط قطعات محاسبه شده است.',
  none: 'قطعه‌ی چیده‌شده‌ای برای محاسبه‌ی نوار لبه وجود ندارد.'
};

const LABOR_UNIT_HINT = 'مقدار دستمزد بر اساس روش انتخاب‌شده در تنظیمات قیمت محاسبه می‌شود.';

export interface CostBreakdownProps {
  estimate: CostEstimate;
  /** True when the optimizer result predates the current cut list. */
  stale?: boolean;
  onEditPrices: () => void;
  onPrint: () => void;
}

export function CostBreakdown({ estimate, stale = false, onEditPrices, onPrint }: CostBreakdownProps) {
  const { currency } = estimate;
  const pricedMaterials = estimate.materials.filter((material) => material.sheets > 0);
  const isEmptyQuote = estimate.total === 0;

  return (
    <section className="card cost-card" aria-labelledby="cost-card-title">
      <div className="cost-head">
        <div className="cost-head-main">
          <div className="cost-head-icon"><Coins size={20} /></div>
          <div>
            <span className="card-overline">پیش‌فاکتور کارگاه</span>
            <h3 id="cost-card-title">برآورد هزینه‌ی پروژه</h3>
            <p>
              {formatQuantity(estimate.totals.sheetsUsed)} ورق، {formatQuantity(estimate.totals.pieceCount)} قطعه و{' '}
              {formatQuantity(estimate.totals.edgeBandMeters)} متر نوار لبه؛ قیمت‌ها از تنظیمات محلی کارگاه خوانده می‌شوند.
            </p>
          </div>
        </div>
        <div className="cost-actions">
          <button type="button" className="button button-outline" onClick={onEditPrices}>
            <SlidersHorizontal size={15} />
            تنظیمات قیمت
          </button>
          <button type="button" className="button button-primary" onClick={onPrint}>
            <Printer size={15} />
            چاپ پیش‌فاکتور
          </button>
        </div>
      </div>

      {stale && (
        <div className="inline-info cost-stale" role="status">
          <AlertTriangle size={16} />
          <span>این برآورد بر اساس نتیجه‌ی قبلی بهینه‌سازی است؛ بعد از تغییر لیست برش دوباره «محاسبه‌ی بهینه‌سازی برش» را بزنید تا هزینه به‌روز شود.</span>
        </div>
      )}

      <div className="cost-metrics">
        <div className="cost-metric cost-metric-total">
          <span>جمع کل برآورد</span>
          <strong>{formatMoneyValue(estimate.total)} <small>{currency}</small></strong>
        </div>
        <div className="cost-metric">
          <span>قیمت هر یونیت</span>
          <strong>
            {estimate.pricePerUnit === null
              ? <span className="muted-dash">—</span>
              : <>{formatMoneyValue(estimate.pricePerUnit)} <small>{currency}</small></>}
          </strong>
          <em>{estimate.totals.unitCount === null ? 'تعداد یونیت مشخص نیست' : `${formatQuantity(estimate.totals.unitCount)} یونیت`}</em>
        </div>
        <div className="cost-metric">
          <span>ورق مصرفی</span>
          <strong>{formatQuantity(estimate.totals.sheetsUsed)} <small>ورق</small></strong>
          <em>{formatQuantity(estimate.totals.materialCount)} متریال</em>
        </div>
        <div className="cost-metric">
          <span>نوار لبه</span>
          <strong>{formatQuantity(estimate.totals.edgeBandMeters)} <small>m</small></strong>
          <em>{formatMoneyValue(estimate.edgeBandCost)} {currency}</em>
        </div>
      </div>

      <div className="cost-table-wrap">
        <table className="cost-table">
          <thead>
            <tr>
              <th>شرح</th>
              <th>مقدار</th>
              <th>واحد</th>
              <th>قیمت واحد ({currency})</th>
              <th>مبلغ ({currency})</th>
            </tr>
          </thead>
          <tbody>
            {estimate.lines.map((line) => (
              <Fragment key={line.key}>
                <tr className={`cost-line cost-line-${line.key}`}>
                  <td><strong>{line.label}</strong></td>
                  <td>{formatQuantity(line.quantity)}</td>
                  <td>{line.unit}</td>
                  <td>{line.key === 'mdf' ? <span className="cost-weighted">میانگین وزنی</span> : formatMoneyValue(line.unitPrice)}</td>
                  <td className="cost-amount">{formatMoneyValue(line.amount)}</td>
                </tr>
                {line.key === 'mdf' && pricedMaterials.map((material) => (
                  <tr className="cost-material-line" key={`mdf-${material.material}`}>
                    <td>
                      <span className="cost-material-bullet" />
                      <span>{material.material}</span>
                      {!material.usesDefaultPrice && <span className="cost-badge">قیمت اختصاصی</span>}
                    </td>
                    <td>{formatQuantity(material.sheets)}</td>
                    <td>ورق</td>
                    <td>{formatMoneyValue(material.unitPrice)}</td>
                    <td className="cost-amount">{formatMoneyValue(material.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="cost-total-row">
              <th colSpan={4}>جمع کل</th>
              <td className="cost-amount">{formatMoneyValue(estimate.total)} <small>{currency}</small></td>
            </tr>
            {estimate.pricePerUnit !== null && (
              <tr className="cost-unit-row">
                <th colSpan={4}>قیمت هر یونیت ({formatQuantity(estimate.totals.unitCount ?? 0)} یونیت)</th>
                <td className="cost-amount">{formatMoneyValue(estimate.pricePerUnit)} <small>{currency}</small></td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {isEmptyQuote && (
        <div className="inline-info cost-hint" role="status">
          <AlertTriangle size={16} />
          <span>هنوز هیچ قیمتی ثبت نشده است. «تنظیمات قیمت» را باز کنید و قیمت ورق، نوار لبه و دستمزد را وارد کنید تا برآورد واقعی محاسبه شود.</span>
        </div>
      )}

      <div className="cost-notes">
        <p>{EDGE_BAND_NOTES[estimate.edgeBand.basis]}</p>
        <p>{LABOR_UNIT_HINT}</p>
      </div>
    </section>
  );
}
