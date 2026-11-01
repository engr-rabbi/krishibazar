import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Button } from './index';
import { useLanguage } from '../../contexts/LanguageContext';

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/** Asks "are you sure?" before anything destructive; keeps the dialog open while the request runs. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger = true, onConfirm, onCancel }: Props) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={() => { if (!busy) onCancel(); }} title={title} maxWidth="max-w-md">
      <div className="space-y-5">
        <div className="flex gap-3">
          {danger && <AlertTriangle className="h-6 w-6 flex-shrink-0 text-red-500" />}
          <div className="text-sm text-gray-700">{message}</div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={onCancel}>{t('বাতিল', 'Cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" loading={busy} onClick={run}>
            {confirmLabel ?? t('নিশ্চিত করুন', 'Confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
