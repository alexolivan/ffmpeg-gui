import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface AliasFieldProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
  placeholder?: string;
  error?: string;
  helperText?: string;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
}

export const AliasField: React.FC<AliasFieldProps> = ({
  value = '',
  onChange,
  required = false,
  label,
  placeholder,
  error: externalError,
  helperText,
  compact = false,
  disabled = false,
  className = '',
  id = 'service-alias',
  name = 'alias',
  autoFocus = false,
}) => {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);

  const trimmed = value || '';
  const charCount = trimmed.length;
  const isTooLong = charCount > 12;

  // Regex compliant with backend validator: ^[a-zA-Z0-9\s\-_]+$
  const hasInvalidChars = trimmed.length > 0 && !/^[a-zA-Z0-9\s\-_]+$/.test(trimmed);
  const isMissingRequired = required && touched && !trimmed.trim();

  let internalError: string | null = null;
  if (isTooLong) {
    internalError = t('common.aliasTooLong', 'Alias cannot exceed 12 characters');
  } else if (hasInvalidChars) {
    internalError = t(
      'common.aliasInvalidChars',
      'Only letters, numbers, spaces, hyphens (-), and underscores (_) allowed'
    );
  } else if (isMissingRequired) {
    internalError = t('common.aliasRequired', 'Alias is required (max 12 characters)');
  }

  const activeError = externalError || internalError;
  const hasError = Boolean(activeError);

  const defaultLabel = required
    ? t('common.alias', 'LCD / Display Alias')
    : t('common.aliasOptional', 'Custom Alias (Optional)');

  const defaultPlaceholder = placeholder || (required ? 'LCD-01' : 'STUDIO-1');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    if (val.length > 12) {
      val = val.slice(0, 12);
    }
    onChange(val);
  };

  const handleBlur = () => {
    setTouched(true);
  };

  if (compact) {
    return (
      <div className={`flex flex-col ${className}`}>
        <div className="relative flex items-center">
          <input
            type="text"
            id={id}
            name={name}
            maxLength={12}
            disabled={disabled}
            autoFocus={autoFocus}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={defaultPlaceholder}
            className={`w-full bg-[var(--input-bg)] border rounded-lg px-2.5 py-2 text-xs font-mono transition-all outline-none pr-12 ${
              hasError
                ? 'border-red-500/60 focus:border-red-500 bg-red-500/5 text-red-300'
                : 'border-[var(--glass-border)] focus:border-brand-lime text-brand-lime placeholder-white/20'
            }`}
            title={t(
              'forge.lcdAliasTitle',
              'LCD Display Alias (max 12 alphanumeric characters, spaces, hyphens, underscores)'
            )}
          />
          <span
            className={`absolute right-2 text-[10px] font-mono pointer-events-none select-none transition-colors ${
              charCount >= 12
                ? 'text-brand-lime font-bold'
                : charCount > 0
                ? 'text-[var(--text-secondary)] font-medium'
                : 'text-[var(--text-secondary)]/50'
            }`}
          >
            {charCount}/12
          </span>
        </div>
        {activeError && (
          <span className="text-[10px] text-red-400 font-medium mt-1 leading-tight animate-fadeIn">
            {activeError}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-xs font-semibold text-[var(--text-secondary)]">
          {label || defaultLabel} {required && <span className="text-red-400">*</span>}
        </label>
        <span
          className={`text-[10px] font-mono transition-colors ${
            charCount >= 12
              ? 'text-brand-lime font-bold'
              : charCount > 0
              ? 'text-[var(--text-secondary)] font-medium'
              : 'text-[var(--text-secondary)]/50'
          }`}
        >
          {charCount}/12
        </span>
      </div>

      <div className="relative">
        <input
          type="text"
          id={id}
          name={name}
          maxLength={12}
          disabled={disabled}
          autoFocus={autoFocus}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={defaultPlaceholder}
          className={`w-full bg-[var(--input-bg)] border rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] transition-all outline-none ${
            hasError
              ? 'border-red-500/60 focus:border-red-500 bg-red-500/5 text-red-300'
              : 'border-[var(--glass-border)] focus:border-brand-lime'
          }`}
        />
      </div>

      {activeError ? (
        <p className="text-[11px] text-red-400 font-medium leading-tight animate-fadeIn">
          {activeError}
        </p>
      ) : helperText ? (
        <p className="text-[10px] text-[var(--text-secondary)] leading-tight">
          {helperText}
        </p>
      ) : null}
    </div>
  );
};
