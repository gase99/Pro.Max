import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CutMap } from '../src/components/CutMap';
import { optimizeCuts } from '../src/lib/optimizer';

function buildResult() {
  return optimizeCuts({
    pieces: [
      { id: 'side', name: 'بدنه جانبی', width: 580, height: 734, quantity: 2 },
      { id: 'door', name: 'درب', width: 398, height: 734, quantity: 2 },
      { id: 'rail', name: 'قید', width: 70, height: 768, quantity: 2 }
    ],
    sheet: { width: 1830, height: 3660 },
    kerf: 4
  });
}

describe('CutMap', () => {
  it('renders one SVG sheet per optimizer sheet in RTL', () => {
    const result = buildResult();
    const markup = renderToStaticMarkup(<CutMap result={result} title="سفید ۳۶۶" />);

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="fa"');
    expect(markup).toContain('سفید ۳۶۶');
    expect(markup).toContain('نقشه برش');
    expect(markup).toContain('ورق‌های مصرفی');
    expect(markup).toContain('درصد پرت');
    expect(markup).toContain('بدنه جانبی');
    expect(markup).toContain('چیدمان بهینه‌ی ورق');
    expect(markup.match(/cutmap-svg/g)?.length).toBe(result.totalSheetsUsed);
    expect(markup.match(/<figure/g)?.length).toBe(result.totalSheetsUsed);
    expect(markup).not.toContain('قطعه چیده نشد');
  });

  it('shows the Persian statistics and waste value of the result', () => {
    const result = buildResult();
    const markup = renderToStaticMarkup(<CutMap result={result} />);
    const waste = new Intl.NumberFormat('fa-IR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(result.wastePercentage);

    expect(markup).toContain(`${waste}٪`);
    expect(markup).toContain(new Intl.NumberFormat('fa-IR').format(result.placedPieceCount));
    expect(markup).toContain('تیغ ۴ میلی‌متر');
  });

  it('lists oversized parts and still renders the remaining sheets', () => {
    const result = optimizeCuts({
      pieces: [
        { id: 'ok', name: 'طبقه', width: 500, height: 700, quantity: 1 },
        { id: 'huge', name: 'قطعه بزرگ', width: 1200, height: 2500, quantity: 1 }
      ],
      sheet: { width: 1000, height: 2000 }
    });
    const markup = renderToStaticMarkup(<CutMap result={result} title="تست" />);

    expect(result.rejected).toHaveLength(1);
    expect(markup).toContain('۱ قطعه چیده نشد');
    expect(markup).toContain('قطعه بزرگ');
    expect(markup.match(/cutmap-svg/g)?.length).toBe(1);
  });

  it('renders an empty state when nothing can be placed', () => {
    const result = optimizeCuts({ pieces: [] });
    const markup = renderToStaticMarkup(<CutMap result={result} />);

    expect(markup).toContain('قطعه‌ای برای چیدمان روی ورق وجود ندارد');
    expect(markup).not.toContain('cutmap-svg');
    expect(markup).toContain('۰ ورق');
  });
});
