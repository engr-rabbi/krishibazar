import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Sprout, AlertCircle, CheckCircle } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Button, FormField, Select, Textarea, Alert } from '../components/ui';
import type { ComplaintSeverity } from '../types';

export default function ConsumerComplaint() {
  const { retailerId }        = useParams<{ retailerId: string }>();
  const [searchParams]        = useSearchParams();
  const { addComplaint }      = useData();
  const { toggleLang, t } = useLanguage();

  const [description, setDescription] = useState('');
  const [severity,    setSeverity]    = useState<ComplaintSeverity>('medium');
  const [submitted,   setSubmitted]   = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError(t('অভিযোগের বিবরণ লিখুন।', 'Please describe your complaint.'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const ok = await addComplaint({
        consumerId: `consumer-${Date.now()}`,
        retailerId: retailerId ?? 'unknown',
        cropId: searchParams.get('crop') ?? undefined,
        description: description.trim(),
        severity,
        status: 'pending',
      });
      if (!ok) { setError(t('অভিযোগ দাখিল করতে সমস্যা হয়েছে।', 'Failed to submit complaint. Please try again.')); return; }
      setSubmitted(true);
    } catch {
      setError(t('অভিযোগ দাখিল করতে সমস্যা হয়েছে।', 'Failed to submit complaint.'));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-green-50 px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
          <h2 className="text-2xl font-bold text-gray-900">{t('অভিযোগ দাখিল সফল','Complaint Submitted')}</h2>
          <p className="text-gray-600 text-sm">
            {t('আপনার অভিযোগ সফলভাবে গ্রহণ করা হয়েছে। আমরা শীঘ্রই এটি পর্যালোচনা করব।',
               'Your complaint has been received. We will review it shortly.')}
          </p>
          <p className="text-xs text-gray-400">KrishiBazar AI — {t('গ্রাহক সেবা','Customer Service')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-green-500 to-blue-500 rounded-full flex items-center justify-center mb-4 shadow-md">
            <Sprout className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{t('কৃষিবাজার AI','KrishiBazar AI')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('গ্রাহক অভিযোগ পোর্টাল','Consumer Complaint Portal')}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 space-y-5">
          {/* Language toggle */}
          <div className="flex justify-end">
            <button onClick={toggleLang} className="text-sm text-green-600 hover:underline">
              {t('English', 'বাংলা')}
            </button>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="bg-blue-50 rounded-xl p-3 flex gap-2 text-sm text-blue-700">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p>{t('এই ফর্মটি পণ্যের মান বা পরিষেবা সম্পর্কিত অভিযোগের জন্য।','This form is for product quality or service complaints.')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t('সমস্যার গুরুত্ব','Severity')} required>
              <Select value={severity} onChange={e => setSeverity(e.target.value as ComplaintSeverity)}>
                <option value="low">{t('কম','Low')}</option>
                <option value="medium">{t('মাঝারি','Medium')}</option>
                <option value="high">{t('বেশি','High')}</option>
              </Select>
            </FormField>

            <FormField label={t('সমস্যার বিবরণ','Describe the Issue')} required>
              <Textarea
                rows={5} value={description} maxLength={500}
                onChange={e => setDescription(e.target.value)}
                placeholder={t(
                  'পণ্যের মান, ক্ষতি, পরিষেবা বা অন্য কোনো সমস্যা সম্পর্কে লিখুন...',
                  'Describe the product quality, damage, service or any other issue...'
                )}
              />
              <p className="mt-1 text-xs text-gray-400">{description.length}/500</p>
            </FormField>

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {t('অভিযোগ দাখিল করুন','Submit Complaint')}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400">
          {t('আপনার অভিযোগ গোপনীয়ভাবে পরিচালনা করা হবে।','Your complaint will be handled confidentially.')}
        </p>
      </div>
    </div>
  );
}
