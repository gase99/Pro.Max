import { Fragment } from 'react';
import { formatMoneyValue, formatQuantity } from '../lib/pricing';
import type { CostEstimate } from '../lib/pricing';
import type { CutOptimizationReport } from '../lib/optimizer';

/** Minimal cut-list row shape needed by the printed invoice. */
export interface InvoiceCutRow {
  id: string;
  unitName: string;
  part: string;
  material: string;
  width: number;
  length: number;
  quantity: number;
  edgeTapeCm: number;
}

export interface InvoiceProject {
  name?: string;
  customer?: string;
  sourceFile?: string;
  notes?: string;
}

export interface InvoiceSheetProps {
  estimate: CostEstimate;
  project: InvoiceProject;
  cutList: readonly InvoiceCutRow[];
  report: CutOptimizationReport | null;
  issuedOn: Date;
}

/**
 * Print-only invoice. It is hidden on screen and becomes visible only for
 * `body.printing-invoice` inside `@media print`, so «چاپ پیش‌فاکتور» produces a
 * clean A4 sheet with the cost breakdown and the full cut list — no app chrome.
 */
export function InvoiceSheet({ estimate, project, cutList, report, issuedOn }: InvoiceSheetProps) {
  const { currency } = estimate;
  const pieceCount = cutList.reduce((sum, row) => sum + (Number.isFinite(row.quantity) ? row.quantity : 0), 0);
  const edgeMeters = cutList.reduce((sum, row) => sum + (Number.isFinite(row.edgeTapeCm) ? row.edgeTapeCm : 0), 0) / 100;
  const pricedMaterials = estimate.materials.filter((material) => material.sheets > 0);
  const dateLabel = issuedOn.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <article className="invoice-sheet" dir="rtl" aria-hidden="true">
      <header className="invoice-header">
        <div className="invoice-brand">
          <div className="invoice-logo">PM</div>
          <div>
            <strong>Pro.Max</strong>
            <span>کابینت استودیو · پیش‌فاکتور برآورد هزینه</span>
          </div>
        </div>
        <div className="invoice-meta">
          <div><span>پروژه</span><strong>{project.name || 'بدون نام'}</strong></div>
          <div><span>مشتری</span><strong>{project.customer || '—'}</strong></div>
          <div><span>تاریخ</span><strong>{dateLabel}</strong></div>
          <div><span>شماره</span><strong dir="ltr">PM-{issuedOn.getTime().toString().slice(-6)}</strong></div>
        </div>
      </header>

      <section className="invoice-block">
        <h2>خلاصه‌ی هزینه</h2>
        <table className="invoice-table invoice-cost-table">
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
                <tr className="invoice-line">
                  <td>{line.label}</td>
                  <td>{formatQuantity(line.quantity)}</td>
                  <td>{line.unit}</td>
                  <td>{line.key === 'mdf' ? 'میانگین وزنی' : formatMoneyValue(line.unitPrice)}</td>
                  <td>{formatMoneyValue(line.amount)}</td>
                </tr>
                {line.key === 'mdf' && pricedMaterials.map((material) => (
                  <tr key={`invoice-material-${material.material}`} className="invoice-subline">
                    <td>— {material.material}{!material.usesDefaultPrice ? ' (قیمت اختصاصی)' : ''}</td>
                    <td>{formatQuantity(material.sheets)}</td>
                    <td>ورق</td>
                    <td>{formatMoneyValue(material.unitPrice)}</td>
                    <td>{formatMoneyValue(material.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="invoice-total-row">
              <th colSpan={4}>جمع کل</th>
              <th>{formatMoneyValue(estimate.total)} {currency}</th>
            </tr>
            {estimate.pricePerUnit !== null && (
              <tr>
                <th colSpan={4}>قیمت هر یونیت ({formatQuantity(estimate.totals.unitCount ?? 0)} یونیت)</th>
                <th>{formatMoneyValue(estimate.pricePerUnit)} {currency}</th>
              </tr>
            )}
          </tfoot>
        </table>
        {project.notes && <p className="invoice-project-notes">یادداشت: {project.notes}</p>}
      </section>

      <section className="invoice-block">
        <h2>لیست برش</h2>
        <p className="invoice-block-summary">
          {formatQuantity(cutList.length)} ردیف · {formatQuantity(pieceCount)} قطعه · {formatQuantity(edgeMeters)} متر نوار لبه
          {project.sourceFile ? ` · منبع: ${project.sourceFile}` : ''}
        </p>
        <table className="invoice-table invoice-cut-table">
          <thead>
            <tr>
              <th>#</th>
              <th>یونیت</th>
              <th>قطعه</th>
              <th>متریال</th>
              <th>ابعاد (عرض × طول)</th>
              <th>تعداد</th>
              <th>نوار لبه</th>
            </tr>
          </thead>
          <tbody>
            {cutList.map((row, index) => (
              <tr key={row.id}>
                <td>{formatQuantity(index + 1)}</td>
                <td>{row.unitName}</td>
                <td>{row.part}</td>
                <td>{row.material}</td>
                <td dir="ltr">{formatQuantity(row.width)} × {formatQuantity(row.length)} cm</td>
                <td>{formatQuantity(row.quantity)}</td>
                <td>{row.edgeTapeCm > 0 ? `${formatQuantity(row.edgeTapeCm / 100)} m` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report && report.groups.length > 0 && (
        <section className="invoice-block">
          <h2>چیدمان ورق</h2>
          <table className="invoice-table invoice-sheet-table">
            <thead>
              <tr><th>متریال</th><th>ورق مصرفی</th><th>قطعات چیده‌شده</th><th>درصد پرت</th></tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <tr key={`invoice-sheet-${group.material}`}>
                  <td>{group.material}</td>
                  <td>{formatQuantity(group.result.totalSheetsUsed)}</td>
                  <td>{formatQuantity(group.result.placedPieceCount)}</td>
                  <td>{formatQuantity(group.result.wastePercentage)}٪</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>جمع</th>
                <th>{formatQuantity(report.totals.sheets)} ورق</th>
                <th>{formatQuantity(report.totals.placed)} قطعه</th>
                <th>{formatQuantity(report.totals.wastePercentage)}٪</th>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <footer className="invoice-footer">
        <p className="invoice-note">
          این پیش‌فاکتور برآوردی است و بر اساس قیمت‌های ثبت‌شده در همین برنامه در تاریخ بالا محاسبه شده است.
          قیمت نهایی پس از تأیید ابعاد، موجودی متریال و هزینه‌ی نصب اعلام می‌شود.
        </p>
        <div className="invoice-signatures">
          <div><span>مهر و امضای فروشنده</span></div>
          <div><span>امضای مشتری</span></div>
        </div>
      </footer>
    </article>
  );
}
