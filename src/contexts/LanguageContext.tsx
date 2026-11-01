import React, {
  createContext, useContext, useState, useEffect, ReactNode,
} from 'react';

type Lang = 'bn' | 'en';

interface LanguageContextType {
  lang: Lang;
  toggleLang: () => void;
  t: (bn: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'kb_lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'en' ? 'en' : 'bn';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const toggleLang = () => setLang(prev => (prev === 'bn' ? 'en' : 'bn'));
  const t = (bn: string, en: string) => (lang === 'bn' ? bn : en);

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
