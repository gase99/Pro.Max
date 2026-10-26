// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App.jsx';
import { createSampleProject } from '../src/data/sampleProject.js';
import { buildCutList } from '../src/lib/engine.js';
import { optimizeCutListByMaterial } from '../src/lib/optimizer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const faNumber = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });

let container: HTMLDivElement;
let root: Root;

function clickButton(label: string): void {
  const button = [...container.querySelectorAll('button')].find((item) =>
    (item.textContent ?? '').includes(label)
  );
  if (!button) throw new Error(`button "${label}" was not found`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
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

beforeEach(() => {
  localStorage.clear();
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
  localStorage.clear();
});

describe('Cut List — cut optimisation integration', () => {
  it('opens the cut list, runs the optimiser and renders sheet maps', () => {
    const expected = optimizeCutListByMaterial(
      buildCutList(createSampleProject().units),
      { sheet: { width: 1830, height: 3660 }, kerf: 4, allowRotation: true }
    );

    clickButton('لیست برش');
    expect(container.querySelector('.optimizer-panel')).not.toBeNull();
    expect(container.textContent).toContain('محاسبه‌ی بهینه‌سازی برش');
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(0);

    clickButton('محاسبه‌ی بهینه‌سازی برش');

    const summary = container.querySelector('.optimizer-summary');
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain('نتیجه‌ی محاسبه');
    expect(summary?.textContent).toContain(`${faNumber.format(expected.totals.sheets)} ورق`);
    expect(summary?.textContent).toContain(`${faNumber.format(expected.totals.placed)} قطعه`);

    expect(container.querySelectorAll('.cutmap')).toHaveLength(expected.groups.length);
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(expected.totals.sheets);
    expect(container.querySelectorAll('.cutmap-sheet')).toHaveLength(expected.totals.sheets);
    expect(container.textContent).toContain('سفید ۳۶۶');
    expect(container.textContent).toContain('MDF سه‌میل');
    expect(container.textContent).toContain('درب');
    expect(container.textContent).toContain('درصد پرت');
    expect(container.textContent).toContain('چیدمان بهینه‌ی ورق');
  });

  it('keeps the calculated layout when navigating away and back', () => {
    clickButton('لیست برش');
    clickButton('محاسبه‌ی بهینه‌سازی برش');
    const sheetCount = container.querySelectorAll('.cutmap-svg').length;
    expect(sheetCount).toBeGreaterThan(0);

    clickButton('نمای کلی');
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(0);

    clickButton('لیست برش');
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(sheetCount);
    expect(container.querySelector('.optimizer-stale-info')).toBeNull();
  });

  it('flags the result as stale once the cut list changes', () => {
    clickButton('لیست برش');
    clickButton('محاسبه‌ی بهینه‌سازی برش');
    const sheetCount = container.querySelectorAll('.cutmap-svg').length;

    clickButton('کابینت‌ها');
    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="کپی یونیت"]');
    expect(copyButton).not.toBeNull();
    act(() => {
      copyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    clickButton('لیست برش');
    expect(container.querySelector('.optimizer-stale-info')?.textContent).toContain(
      'لیست برش بعد از این محاسبه تغییر کرده است'
    );
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(sheetCount);
  });

  it('shows a Persian validation error instead of mapping an invalid sheet', () => {
    clickButton('لیست برش');
    const widthInput = container.querySelector<HTMLInputElement>(
      '.optimizer-controls input[type="text"]'
    );
    expect(widthInput).not.toBeNull();
    setInputValue(widthInput!, '0');

    clickButton('محاسبه‌ی بهینه‌سازی برش');

    expect(container.querySelector('.optimizer-panel .form-error')?.textContent).toContain(
      'عرض و طول ورق باید عددی بزرگ‌تر از صفر باشند'
    );
    expect(container.querySelectorAll('.cutmap-svg')).toHaveLength(0);
  });
});
