// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateId, formatDate, statusLabel, pct, clamp, buildComplaintUrl } from '../src/lib/utils';

describe('utils', () => {
  it('generates unique, Sheets-safe ids (no spaces or slashes)', () => {
    const ids = new Set(Array.from({ length: 2000 }, generateId));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[\w-]+$/);
  });
  it('formatDate handles empty and invalid input', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
    expect(() => formatDate('not a date')).not.toThrow();
  });
  it('statusLabel is bilingual', () => {
    expect(statusLabel('in_transit', 'en')).toBe('In Transit');
    expect(statusLabel('in_transit', 'bn')).toBe('পরিবহনে');
  });
  it('pct and clamp', () => {
    expect(pct(1, 0)).toBe(0);
    expect(pct(1, 4)).toBe(25);
    expect(clamp(10, 0, 5)).toBe(5);
  });
  it('builds a complaint URL that works with HashRouter on a GitHub Pages sub-path', () => {
    window.history.pushState({}, '', '/krishibazar-ai/');
    const url = buildComplaintUrl('4', 'order 1', 'Potato');
    expect(url).toContain('/krishibazar-ai/#/complaint/4?');
    expect(url).toContain('order=order+1');
    expect(url).toContain('crop=Potato');
  });
});
