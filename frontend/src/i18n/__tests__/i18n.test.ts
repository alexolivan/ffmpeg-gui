import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '../i18n';

// Mock localStorage in Node/Vitest test environment
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach(key => delete storage[key]); },
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
  });
}

describe('i18n initialization & translations', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('loads English translations by default', () => {
    expect(i18n.language).toBe('en');
    expect(i18n.t('common.save')).toBe('Save Settings');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    expect(i18n.t('settings.title')).toBe('Settings');
  });

  it('switches language to Spanish (es)', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.language).toBe('es');
    expect(i18n.t('common.save')).toBe('Guardar Ajustes');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    expect(i18n.t('settings.title')).toBe('Configuración');
  });

  it('switches language to Catalan (ca)', async () => {
    await i18n.changeLanguage('ca');
    expect(i18n.language).toBe('ca');
    expect(i18n.t('common.save')).toBe('Desar Ajustos');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    expect(i18n.t('settings.title')).toBe('Configuració');
  });

  it('falls back to English when translation key is missing', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('handles fallbackLng when fallback is triggered', () => {
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });
});
