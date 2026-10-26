// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList, getProjectStats } from '../src/lib/engine.js';
import { optimizeCutListByMaterial } from '../src/lib/optimizer';
import { calculateCost, costBatchesFromReport, formatMoneyValue } from '../src/lib/pricing';
import type { PriceSettings } from '../src/lib/pricing';
import { PRICE_SETTINGS_STORAGE_KEY } from '../src/lib/pricingStorage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRICES: PriceSettings = {
  sheetPrice: 2_500_000,
  materialSheetPrices: { 'MDF سه‌میل': 1_200_000 },
  edgeBandPricePerMeter: 30_000,
  laborMode: 'per-sheet',
  laborRate: 500_000,
  hardwareCost: 1_500_000,
  currency: 'تومان'
};

const report = optimizeCutListByMaterial(
  buildCutList(createSampleProject().units),
  { sheet: { width: 1830, height: 3660 }, kerf: 4, allowRotation: true }
);

let container: HTMLDivElement;
let root: Root;
let printSpy: ReturnType<typeof vi.fn>;

function clickButton(label: string): void {
  const button = [...container.querySelectorAll('button')].find((item) =>
    (item.textContent ?? '').includes(label)
  );
  if (!button) throw new Error(`button "${label}" was not found`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function openPriceDialog(): void {
  clickButton('تنظیمات قیمت');
  expect(container.querySelector('.modal-prices')).not.toBeNull();
}

function priceInput(label: string): HTMLInputElement {
  // Plain price fields use `label.form-field`, per-material overrides use
  // `label.price-material-row`; matching on the whole label text covers both.
  const field = [...container.querySelectorAll<HTMLLabelElement>('.modal-prices label')]
    .find((item) => (item.textContent ?? '').includes(label));
  if (!field) throw new Error(`price field "${label}" was not found`);
  const input = field.querySelector('input');
  if (!input) throw new Error(`price field "${label}" has no input`);
  return input;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;
  if (!setter) throw new Error('the native input setter is unavailable');
  setter.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function runOptimization(): void {
  clickButton('لیست برش');
  clickButton('محاسبه‌ی بهینه‌سازی برش');
  expect(container.querySelector('.cost-card')).not.toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  printSpy = vi.fn();
  Object.defineProperty(window, 'print', { configurable: true, writable: true, value: printSpy });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.classList.remove('printing-invoice');
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('Pricing — cost breakdown and workshop prices', () => {
  it('shows an empty-price hint after optimization', () => {
    runOptimization();

    const card = container.querySelector('.cost-card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('برآورد هزینه‌ی پروژه');
    expect(card?.querySelector('.cost-hint')?.textContent).toContain('هنوز هیچ قیمتی ثبت نشده است');
    // Zero prices still produce the per-unit row, shown as zero.
    expect(card?.querySelector('.cost-unit-row')?.textContent).toContain('۰');
  });

  it('saves entered prices, persists them and recalculates the itemised table', () => {
    runOptimization();
    openPriceDialog();

    setInputValue(priceInput('قیمت هر ورق MDF'), '2,500,000');
    setInputValue(priceInput('قیمت هر متر نوار لبه'), '۳۰۰۰۰');
    setInputValue(priceInput('MDF سه‌میل'), '1200000');
    setInputValue(priceInput('نرخ دستمزد'), '500000');
    setInputValue(priceInput('یراق‌آلات'), '1500000');
    clickButton('ذخیره‌ی قیمت‌ها');

    expect(container.querySelector('.modal-prices')).toBeNull();
    expect(container.textContent).toContain('قیمت‌های کارگاه ذخیره شد.');

    const saved = JSON.parse(localStorage.getItem(PRICE_SETTINGS_STORAGE_KEY) ?? '{}');
    expect(saved).toMatchObject({
      sheetPrice: 2_500_000,
      edgeBandPricePerMeter: 30_000,
      laborMode: 'per-sheet',
      laborRate: 500_000,
      hardwareCost: 1_500_000
    });
    expect(saved.materialSheetPrices['MDF سه‌میل']).toBe(1_200_000);

    const cutList = buildCutList(createSampleProject().units);
    const batches = costBatchesFromReport(report, cutList);
    const { unitCount } = getProjectStats(createSampleProject().units, cutList);
    const expected = calculateCost({ batches, settings: saved, unitCount });
    const card = container.querySelector('.cost-card');
    expect(card?.textContent).toContain(formatMoneyValue(expected.mdfCost));
    expect(card?.textContent).toContain(formatMoneyValue(expected.edgeBandCost));
    expect(card?.textContent).toContain(formatMoneyValue(expected.laborCost));
    expect(card?.textContent).toContain(formatMoneyValue(expected.hardwareCost));
    expect(card?.querySelector('.cost-total-row')?.textContent).toContain(
      formatMoneyValue(expected.total)
    );
    expect(expected.total).toBe(
      expected.mdfCost + expected.edgeBandCost + expected.laborCost + expected.hardwareCost
    );

    // The custom material price is flagged in the breakdown.
    expect(card?.querySelectorAll('.cost-badge').length).toBeGreaterThan(0);
  });

  it('restores saved prices into the dialog after a remount', () => {
    localStorage.setItem(PRICE_SETTINGS_STORAGE_KEY, JSON.stringify({ ...PRICES }));

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    act(() => {
      root.render(<App />);
    });

    openPriceDialog();
    expect(priceInput('قیمت هر ورق MDF').value).toBe('2500000');
    expect(priceInput('نرخ دستمزد').value).toBe('500000');
    expect(priceInput('یراق‌آلات').value).toBe('1500000');
  });

  it('renders a print-only invoice and toggles the print body class', () => {
    localStorage.setItem(PRICE_SETTINGS_STORAGE_KEY, JSON.stringify({ ...PRICES }));
    runOptimization();

    const invoice = container.querySelector('.invoice-sheet');
    expect(invoice).not.toBeNull();
    expect(invoice?.textContent).toContain('پیش‌فاکتور برآورد هزینه');
    expect(invoice?.textContent).toContain('لیست برش');
    expect(invoice?.querySelectorAll('.invoice-cut-table tbody tr').length).toBe(
      buildCutList(createSampleProject().units).length
    );
    expect(invoice?.textContent).toContain('مهر و امضای فروشنده');

    clickButton('چاپ پیش‌فاکتور');
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains('printing-invoice')).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(document.body.classList.contains('printing-invoice')).toBe(false);
  });
});
