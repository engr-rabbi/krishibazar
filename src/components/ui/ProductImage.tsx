import React, { useEffect, useState } from 'react';
import { PLACEHOLDER_IMAGE } from '../../lib/domain';

interface Props {
  images?: string[];
  alt: string;
  className?: string;
}

/**
 * Shows a product photo. If a photo fails to load (host unreachable, file removed, bad data) it
 * tries the next one and finally falls back to a placeholder bundled with the site, so the
 * UI never shows a broken-image icon and every role always sees something.
 */
export function ProductImage({ images, alt, className = '' }: Props) {
  const list = (images ?? []).filter(Boolean);
  const key = list.join('|');
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setIndex(0); setLoaded(false); }, [key]);

  const failed = index >= list.length;
  const src = failed ? PLACEHOLDER_IMAGE : list[index];

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      data-fallback={failed ? 'true' : 'false'}
      onLoad={() => setLoaded(true)}
      onError={() => { if (!failed) setIndex(i => i + 1); }}
      className={`${className} ${loaded || failed ? '' : 'animate-pulse bg-gray-100'} object-cover`}
    />
  );
}
