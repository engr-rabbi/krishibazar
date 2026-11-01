import React, { ReactNode } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useData } from '../../contexts/DataContext';

/** Marks figures that are illustrative placeholders, not computed from real data */
export function SampleBadge() {
  const { t } = useLanguage();
  return (
    <span
      title={t('এই তথ্য উদাহরণস্বরূপ — প্রকৃত ডেটা থেকে নয়', 'Illustrative figures — not computed from real data')}
      className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
    >
      {t('নমুনা তথ্য', 'Sample data')}
    </span>
  );
}

export interface PanelColumn {
  title: string;
  lines: ReactNode[];
  sample?: boolean;
}

/** The "Real-time Updates" banner used on every role dashboard */
export function RealtimePanel({ title, icon, columns, gradient = 'from-green-600 to-blue-600' }: {
  title: string; icon: ReactNode; columns: PanelColumn[]; gradient?: string;
}) {
  return (
    <section className={`rounded-xl bg-gradient-to-r ${gradient} p-6 text-white shadow-lg`}>
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-lg font-bold">{title}</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {columns.map(col => (
          <div key={col.title} className="rounded-lg bg-white/15 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="font-semibold">{col.title}</h4>
              {col.sample && <SampleBadge />}
            </div>
            <div className="space-y-1 text-sm opacity-95">
              {col.lines.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const CROP_NAMES: Record<string, [string, string]> = {
  Potato: ['আলু', 'Potato'], Tomato: ['টমেটো', 'Tomato'], Rice: ['চাল', 'Rice'],
  Onion: ['পেঁয়াজ', 'Onion'], Carrot: ['গাজর', 'Carrot'], Eggplant: ['বেগুন', 'Eggplant'], Cucumber: ['শসা', 'Cucumber'],
};

/** Localised product name: uses the admin-managed Categories list, then the built-in names */
export function useCropName() {
  const { lang } = useLanguage();
  const { categories } = useData();
  return (type: string) => {
    if (lang !== 'bn') return type;
    const fromCats = categories.find(c => c.name.toLowerCase() === type.toLowerCase())?.nameBn;
    return fromCats || CROP_NAMES[type]?.[0] || type;
  };
}
