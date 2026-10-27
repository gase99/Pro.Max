/**
 * Persistence for the workshop price list.
 *
 * Prices live in `localStorage` (never on a server) and are normalised on every
 * read, so a corrupted or outdated payload can never crash the estimator.
 */

import type { PriceSettings } from './pricing';
import { createDefaultPriceSettings, normalizePriceSettings } from './pricing';

export const PRICE_SETTINGS_STORAGE_KEY = 'promax-cabinet-studio-prices-v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Storage can be disabled (privacy mode, sandboxed frame).
    return null;
  }
}

export function loadPriceSettings(storage: StorageLike | null = browserStorage()): PriceSettings {
  if (!storage) return createDefaultPriceSettings();
  try {
    const raw = storage.getItem(PRICE_SETTINGS_STORAGE_KEY);
    if (!raw) return createDefaultPriceSettings();
    return normalizePriceSettings(JSON.parse(raw));
  } catch (error) {
    console.warn('Could not read saved Pro.Max prices', error);
    return createDefaultPriceSettings();
  }
}

/** Returns false when storage is unavailable or full. */
export function savePriceSettings(
  settings: PriceSettings,
  storage: StorageLike | null = browserStorage()
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PRICE_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePriceSettings(settings)));
    return true;
  } catch (error) {
    console.warn('Could not save Pro.Max prices', error);
    return false;
  }
}
