import React, { useRef, useState } from 'react';
import { Camera, X, Loader2 } from 'lucide-react';
import { ProductImage } from './ProductImage';
import { Alert } from './index';
import { useLanguage } from '../../contexts/LanguageContext';
import { SHEETS_ENABLED, uploadImageRequest } from '../../lib/sheetsApi';
import { compressImage } from '../../lib/domain';

const MAX_PHOTOS = 3;
const INLINE_MAX_CHARS = 20_000;   // must match the server's limit for photos stored directly in the sheet

interface Props {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}

/** Tiny preview that is guaranteed to fit inside a spreadsheet cell (used only if Drive is unavailable) */
async function inlineThumbnail(file: File): Promise<string> {
  for (const side of [240, 180, 120]) {
    const url = await compressImage(file, side, 0.6);
    if (url.length <= INLINE_MAX_CHARS) return url;
  }
  throw new Error('image too complex');
}

/**
 * Photo picker. Each photo is resized in the browser (≤ 800 px) and stored in Google Drive through the
 * backend; only the resulting URL is kept in the database, so every user can load it. If Drive can't be
 * reached we keep a small inline preview instead, so adding a product never fails because of a photo.
 */
export function PhotoUploader({ value, onChange, disabled }: Props) {
  const { t } = useLanguage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'warning' | 'error'; text: string } | null>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/')).slice(0, MAX_PHOTOS - value.length);
    e.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setNotice(null);
    const added: string[] = [];
    let usedFallback = false;
    for (const file of files) {
      try {
        if (SHEETS_ENABLED) {
          const res = await uploadImageRequest(await compressImage(file));
          if (res.success && res.data) { added.push(res.data.url); continue; }
          usedFallback = true;           // Drive refused or unreachable → keep a small preview instead
        }
        added.push(await inlineThumbnail(file));
      } catch {
        setNotice({ kind: 'error', text: t('এই ছবিটি প্রসেস করা যায়নি। অন্য ছবি চেষ্টা করুন।', 'That image could not be processed. Please try another one.') });
      }
    }
    if (usedFallback) {
      setNotice({ kind: 'warning', text: t('ছবি সার্ভারে আপলোড হয়নি; ছোট প্রিভিউ সংরক্ষিত হয়েছে। পরে আবার চেষ্টা করুন।', 'The photo could not be uploaded, so a small preview was saved instead. You can replace it later.') });
    }
    if (added.length) onChange([...value, ...added].slice(0, MAX_PHOTOS));
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      {value.length < MAX_PHOTOS && (
        <button
          type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-5 text-sm text-gray-500 transition-colors hover:border-green-400 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 className="mb-1 h-7 w-7 animate-spin text-green-500" /> : <Camera className="mb-1 h-7 w-7 text-gray-400" />}
          <span>{busy ? t('আপলোড হচ্ছে...', 'Uploading...') : t('ছবি যোগ করুন (সর্বোচ্চ ৩টি)', 'Add photos (up to 3)')}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" data-testid="photo-input" onChange={pick} />
      {notice && <Alert variant={notice.kind}>{notice.text}</Alert>}
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((url, i) => (
            <div key={url + i} className="relative">
              <ProductImage images={[url]} alt="" className="h-20 w-full rounded-lg" />
              <button type="button" aria-label={t('ছবি সরান', 'Remove photo')} onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 rounded-full bg-red-600 p-0.5 text-white shadow">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
