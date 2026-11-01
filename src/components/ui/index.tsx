import React, { ReactNode, ButtonHTMLAttributes } from 'react';
import { X, Loader2 } from 'lucide-react';

// ─── Button ───────────────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type BtnSize    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

const variantClasses: Record<BtnVariant, string> = {
  primary:   'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 focus:ring-gray-400',
  danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  ghost:     'text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
};

const sizeClasses: Record<BtnSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({
  variant = 'primary', size = 'md', loading = false,
  icon, children, disabled, className = '', ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
    >
      {loading
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : icon}
      {children}
    </button>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  children: ReactNode;
  className?: string;
  accentColor?: string; // Tailwind border colour e.g. 'border-green-500'
}

export function Card({ children, className = '', accentColor }: CardProps) {
  return (
    <div className={[
      'bg-white rounded-xl shadow-md p-6',
      accentColor ? `border-l-4 ${accentColor}` : '',
      className,
    ].join(' ')}>
      {children}
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  accentColor: string;
}

export function StatCard({ label, value, sub, icon, accentColor }: StatCardProps) {
  return (
    <Card accentColor={accentColor}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-gray-500">{sub}</p>}
        </div>
        <div className="opacity-70">{icon}</div>
      </div>
    </Card>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-3 py-4 sm:px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} max-h-[92vh] overflow-y-auto`}>
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-gray-200 bg-white p-5 sm:p-6">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}

export function FormField({ label, error, children, required }: FormFieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
        disabled:bg-gray-50 disabled:cursor-not-allowed ${className}`}
    />
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────

export function Select({ className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent ${className}`}
    >
      {children}
    </select>
  );
}

// ─── Textarea ─────────────────────────────────────────────────────────────────

export function Textarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent ${className}`}
    />
  );
}

// ─── Alert ────────────────────────────────────────────────────────────────────

type AlertVariant = 'info' | 'success' | 'warning' | 'error';

const alertClasses: Record<AlertVariant, string> = {
  info:    'bg-blue-50  border-blue-200  text-blue-800',
  success: 'bg-green-50 border-green-200 text-green-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  error:   'bg-red-50   border-red-200   text-red-800',
};

export function Alert({ variant = 'info', children }: { variant?: AlertVariant; children: ReactNode }) {
  return (
    <div className={`border rounded-lg p-4 text-sm ${alertClasses[variant]}`}>
      {children}
    </div>
  );
}

// ─── LoadingSpinner ───────────────────────────────────────────────────────────

export function LoadingSpinner({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[200px] gap-3">
      <Loader2 className="h-10 w-10 text-green-500 animate-spin" />
      {message && <p className="text-sm text-gray-500">{message}</p>}
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{label}</span><span>{pct}%</span>
        </div>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="h-2 bg-green-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action }: {
  icon: ReactNode; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-gray-300 mb-4">{icon}</div>
      <h3 className="text-lg font-medium text-gray-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-4">{description}</p>}
      {action}
    </div>
  );
}
