import { useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Coins, RotateCcw, X } from 'lucide-react';
import {
  LABOR_MODE_LABELS,
  LABOR_MODE_UNITS,
  calculateCost,
  createDefaultPriceSettings,
  formatMoney,
  formatMoneyValue,
  normalizePriceSettings
} from '../lib/pricing';
import type { CostBatch, CostEstimate, LaborMode, PriceSettings } from '../lib/pricing';

const LABOR_MODE_ORDER: readonly LaborMode[] = ['flat', 'per-sheet', 'per-piece'];

interface PriceDraft {
  sheetPrice: string;
  edgeBandPricePerMeter: string;
  laborRate: string;
  hardwareCost: string;
  laborMode: LaborMode;
  materialSheetPrices: Record<string, string>;
}

interface PriceInputProps {
  label: string;
  hint?: string;
  value: string;
  unit: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function PriceInput({ label, hint, value, unit, placeholder, onChange }: PriceInputProps) {
  return (
    <label className="form-field price-field">
      <span>{label}</span>
      <div className="numeric-input-wrap">
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <em>{unit}</em>
      </div>
      {hint && <small className="price-field-hint">{hint}</small>}
    </label>
  );
}

function priceToInput(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : '';
}

function toDraft(settings: PriceSettings, materials: readonly string[]): PriceDraft {
  const materialSheetPrices: Record<string, string> = {};
  for (const material of materials) {
    materialSheetPrices[material] = priceToInput(settings.materialSheetPrices[material]);
  }
  return {
    sheetPrice: priceToInput(settings.sheetPrice),
    edgeBandPricePerMeter: priceToInput(settings.edgeBandPricePerMeter),
    laborRate: priceToInput(settings.laborRate),
    hardwareCost: priceToInput(settings.hardwareCost),
    laborMode: settings.laborMode,
    materialSheetPrices
  };
}

export interface PriceSettingsDialogProps {
  /** Current, already saved prices. */
  settings: PriceSettings;
  /** Material names discovered in the cut list, for per-material overrides. */
  materials: readonly string[];
  /** Optimiser batches used for the live preview; empty before optimization. */
  batches: readonly CostBatch[];
  unitCount: number | null;
  onClose: () => void;
  onSave: (next: PriceSettings) => void;
}

export function PriceSettingsDialog({
  settings,
  materials,
  batches,
  unitCount,
  onClose,
  onSave
}: PriceSettingsDialogProps) {
  const [draft, setDraft] = useState<PriceDraft>(() => toDraft(settings, materials));

  const rawSettings = {
    sheetPrice: draft.sheetPrice,
    materialSheetPrices: draft.materialSheetPrices,
    edgeBandPricePerMeter: draft.edgeBandPricePerMeter,
    laborMode: draft.laborMode,
    laborRate: draft.laborRate,
    hardwareCost: draft.hardwareCost,
    currency: settings.currency
  };
  const normalized = normalizePriceSettings(rawSettings);

  let preview: CostEstimate | null = null;
  if (batches.length > 0) {
    try {
      preview = calculateCost({ batches, settings: normalized, unitCount });
    } catch {
      preview = null;
    }
  }

  const change = (key: keyof Omit<PriceDraft, 'materialSheetPrices' | 'laborMode'>, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const changeMaterial = (material: string, value: string) => {
    setDraft((current) => ({
      ...current,
      materialSheetPrices: { ...current.materialSheetPrices, [material]: value }
    }));
  };

  const reset = () => {
    setDraft(toDraft(createDefaultPriceSettings(), materials));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(normalized);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal modal-prices" role="dialog" aria-modal="true" aria-labelledby="price-dialog-title">
        <div className="modal-header">
          <div>
            <span className="modal-eyebrow">تنظیمات کارگاه</span>
            <h2 id="price-dialog-title">قیمت‌های برآورد هزینه</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="بستن تنظیمات قیمت">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body price-form-body">
            <div className="price-intro">
              <Coins size={18} />
              <div>
                <strong>این قیمت‌ها فقط روی همین دستگاه ذخیره می‌شوند.</strong>
                <span>هر عدد را به {normalized.currency} وارد کنید؛ رقم‌های فارسی، جداکننده‌ی هزار و خالی‌گذاشتن فیلدها هم پذیرفته می‌شود.</span>
              </div>
            </div>

            <div className="form-section-heading">
              <div>
                <span>مواد و نوار لبه</span>
                <small>قیمت هر ورق برای متریال‌هایی که قیمت اختصاصی ندارند استفاده می‌شود.</small>
              </div>
              <span className="unit-unit-chip">{normalized.currency}</span>
            </div>
            <div className="form-grid price-grid">
              <PriceInput
                label="قیمت هر ورق MDF"
                value={draft.sheetPrice}
                unit={normalized.currency}
                placeholder="مثلاً 2,500,000"
                onChange={(value) => change('sheetPrice', value)}
              />
              <PriceInput
                label="قیمت هر متر نوار لبه"
                value={draft.edgeBandPricePerMeter}
                unit={`${normalized.currency} / متر`}
                placeholder="مثلاً 30,000"
                onChange={(value) => change('edgeBandPricePerMeter', value)}
              />
            </div>

            {materials.length > 0 && (
              <div className="price-material-list">
                <div className="form-section-heading">
                  <div>
                    <span>قیمت اختصاصی هر متریال</span>
                    <small>خالی بگذارید تا قیمت مشترک بالا اعمال شود.</small>
                  </div>
                </div>
                <div className="price-material-rows">
                  {materials.map((material) => {
                    const value = draft.materialSheetPrices[material] ?? '';
                    const isOverride = normalizePriceSettings({ materialSheetPrices: { [material]: value } })
                      .materialSheetPrices[material] !== undefined;
                    return (
                      <label className="price-material-row" key={material}>
                        <span className="price-material-copy">
                          <strong>{material}</strong>
                          <small>{isOverride ? 'قیمت اختصاصی این متریال' : 'استفاده از قیمت مشترک هر ورق'}</small>
                        </span>
                        <div className="numeric-input-wrap">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={value}
                            placeholder={normalized.sheetPrice > 0 ? formatMoneyValue(normalized.sheetPrice) : 'قیمت مشترک'}
                            onChange={(event) => changeMaterial(material, event.target.value)}
                          />
                          <em>{normalized.currency} / ورق</em>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="form-section-heading">
              <div>
                <span>دستمزد و یراق‌آلات</span>
                <small>اجرت برش، CNC و مونتاژ را می‌توانید ثابت یا بر مبنای ورق و قطعه حساب کنید.</small>
              </div>
            </div>
            <div className="segmented-control price-labor-modes" role="group" aria-label="روش محاسبه‌ی دستمزد">
              {LABOR_MODE_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={draft.laborMode === mode ? 'selected' : ''}
                  aria-pressed={draft.laborMode === mode}
                  onClick={() => setDraft((current) => ({ ...current, laborMode: mode }))}
                >
                  {LABOR_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
            <div className="form-grid price-grid">
              <PriceInput
                label={`نرخ دستمزد (${LABOR_MODE_LABELS[draft.laborMode]})`}
                value={draft.laborRate}
                unit={`${normalized.currency} / ${LABOR_MODE_UNITS[draft.laborMode]}`}
                placeholder="۰"
                onChange={(value) => change('laborRate', value)}
              />
              <PriceInput
                label="یراق‌آلات (هزینه‌ی کل فاکتور)"
                hint="لولا، ریل کشو، دستگیره و پیچ‌ها؛ به‌صورت دستی."
                value={draft.hardwareCost}
                unit={normalized.currency}
                placeholder="۰"
                onChange={(value) => change('hardwareCost', value)}
              />
            </div>

            {preview ? (
              <div className="price-preview" role="status" aria-live="polite">
                <div>
                  <span>جمع برآورد با این قیمت‌ها</span>
                  <strong>{formatMoney(preview.total, preview.currency)}</strong>
                </div>
                {preview.pricePerUnit !== null && (
                  <div>
                    <span>قیمت هر یونیت</span>
                    <strong>{formatMoney(preview.pricePerUnit, preview.currency)}</strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="price-preview price-preview-muted">
                <span>برای پیش‌نمایش زنده‌ی جمع کل، ابتدا از صفحه‌ی «لیست برش» بهینه‌سازی برش را اجرا کنید.</span>
              </div>
            )}

            <div className="local-data-note">
              <Coins size={15} />
              <span>قیمت‌ها به‌صورت محلی در همین مرورگر نگه‌داری می‌شوند و با فایل پشتیبان پروژه جابه‌جا نمی‌شوند.</span>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="button button-quiet" onClick={reset}>
              <RotateCcw size={15} />
              پاک کردن قیمت‌ها
            </button>
            <div>
              <button type="button" className="button button-quiet" onClick={onClose}>انصراف</button>
              <button type="submit" className="button button-primary">
                <Check size={16} />
                ذخیره‌ی قیمت‌ها
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
