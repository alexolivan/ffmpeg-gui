import React from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeLevel, type CapabilityLevel } from '../../utils/permissions';

interface PermissionLevelBadgeProps {
  level?: CapabilityLevel | string | null;
  className?: string;
}

export const PermissionLevelBadge: React.FC<PermissionLevelBadgeProps> = ({
  level,
  className = '',
}) => {
  const { t } = useTranslation();
  const normalized = normalizeLevel(level, 'admin');

  if (normalized === 'admin' || normalized === 'manage') {
    return null;
  }

  const label =
    normalized === 'operate'
      ? t('auth.permissionOperate', 'OPERATE')
      : normalized === 'monitor'
      ? t('auth.permissionMonitor', 'MONITOR')
      : t('auth.permissionNone', 'NONE');

  const styleClass =
    normalized === 'operate'
      ? 'bg-brand-lime/10 text-brand-lime border-brand-lime/30'
      : 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--glass-border)]';

  return (
    <span
      className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded border font-bold tracking-wider ${styleClass} ${className}`}
      title={t('auth.permissionBadgeTitle', 'Effective permission level: {{level}}', {
        level: label,
      })}
    >
      {label}
    </span>
  );
};
