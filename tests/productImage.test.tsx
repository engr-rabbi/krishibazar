// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ProductImage } from '../src/components/ui/ProductImage';
import { PLACEHOLDER_IMAGE } from '../src/lib/domain';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(images?: string[]) {
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ProductImage images={images} alt="Potato" />));
  return host.querySelector('img')!;
}
const fail = (img: HTMLImageElement) => act(() => { img.dispatchEvent(new Event('error')); });

describe('ProductImage', () => {
  it('shows the photo when it loads', () => {
    const img = mount(['https://drive.google.com/thumbnail?id=ABCDEFGHIJKLMNOP&sz=w800']);
    expect(img.getAttribute('src')).toContain('drive.google.com');
    expect(img.dataset.fallback).toBe('false');
  });

  it('tries the next photo when the first fails, then falls back to the bundled placeholder', () => {
    const img = mount(['https://a.example/1.jpg', 'https://b.example/2.jpg']);
    expect(img.getAttribute('src')).toBe('https://a.example/1.jpg');
    fail(img);
    expect(img.getAttribute('src')).toBe('https://b.example/2.jpg');
    fail(img);
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_IMAGE);
    expect(img.dataset.fallback).toBe('true');
    fail(img);                                        // a failing placeholder must not loop forever
    expect(img.getAttribute('src')).toBe(PLACEHOLDER_IMAGE);
  });

  it('uses the placeholder immediately when the product has no photos', () => {
    for (const none of [undefined, [], ['']]) {
      act(() => root?.unmount()); host?.remove();
      expect(mount(none as string[] | undefined).getAttribute('src')).toBe(PLACEHOLDER_IMAGE);
    }
  });

  it('never leaks the referrer to the image host', () => {
    expect(mount(['https://x.example/a.jpg']).getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
