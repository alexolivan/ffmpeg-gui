import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EngineLogo } from '../common/EngineLogo';
import { ForgeIcon, RefreshIcon } from '../Icons';
import { getDomainLevel, hasMinLevel, type EdgePermissionsSummary } from '../../utils/permissions';

export type TaskCategory = 'ffmpeg' | 'service_restart' | 'forge_build';

interface TaskTypePickerModalProps {
  API?: string;
  permissions?: EdgePermissionsSummary | null;
  onClose: () => void;
  onSelectTaskType: (category: TaskCategory) => void;
}

interface TaskTypeOption {
  category: TaskCategory;
  badge: string;
  name: string;
  description: string;
}

export const TaskTypePickerModal: React.FC<TaskTypePickerModalProps> = ({
  API = '',
  permissions,
  onClose,
  onSelectTaskType,
}) => {
  const { t } = useTranslation();
  const canOperateForge = hasMinLevel(getDomainLevel(permissions, 'forge'), 'operate');

  const options: TaskTypeOption[] = [
    {
      category: 'ffmpeg',
      badge: t('tasks.picker.categoryMedia', 'MEDIA & TRANSCODING'),
      name: t('tasks.serviceRestart.taskTypeMedia', 'FFmpeg Media Task'),
      description: t(
        'tasks.serviceRestart.taskTypeMediaDesc',
        'Transcode, bridge, stream or file conversion using FFmpeg.'
      ),
    },
    {
      category: 'service_restart',
      badge: t('tasks.picker.categoryOrchestration', 'SERVICE ORCHESTRATION'),
      name: t('tasks.serviceRestart.taskTypeServiceRestart', 'Service Maintenance Restart'),
      description: t(
        'tasks.serviceRestart.taskTypeServiceRestartDesc',
        'Preventive staggered restart of 24/7 services to reset memory and clocks.'
      ),
    },
    ...(canOperateForge
      ? [
          {
            category: 'forge_build' as const,
            badge: t('tasks.picker.categoryForge', 'FORGE AUTOMATION'),
            name: t('tasks.forgeBuild.tabLabel', 'Forge Nightly Build'),
            description: t(
              'tasks.picker.forgeBuildDesc',
              'Schedule deferred or nightly binary compilations with controlled CPU cores and low disk/CPU priority.'
            ),
          },
        ]
      : []),
  ];

  const [selectedCategory, setSelectedCategory] = useState<TaskCategory>(options[0].category);

  const renderIcon = (category: TaskCategory) => {
    if (category === 'ffmpeg') {
      return <EngineLogo softwareType="ffmpeg" size={28} API={API} />;
    }
    if (category === 'service_restart') {
      return <RefreshIcon size={22} className="text-cyan-400" />;
    }
    return <ForgeIcon size={22} className="text-brand-orange" />;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-2xl p-6 shadow-2xl relative flex flex-col gap-5 overflow-hidden text-[var(--text-primary)]">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-7 h-7 bg-[var(--input-bg)] rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-all z-10 text-xs cursor-pointer"
        >
          ✕
        </button>

        {/* Header */}
        <div className="border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⏱️</span>
            <h3 className="text-sm font-black tracking-wide uppercase">
              {t('tasks.picker.title', 'Create New Task: Select Type')}
            </h3>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t(
              'tasks.picker.subtitle',
              'Choose the execution workflow or automation routine for this scheduled task.'
            )}
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[55vh] overflow-y-auto custom-scrollbar p-0.5">
          {options.map((opt) => {
            const isSelected = selectedCategory === opt.category;
            return (
              <div
                key={opt.category}
                onClick={() => setSelectedCategory(opt.category)}
                onDoubleClick={() => onSelectTaskType(opt.category)}
                className={`border rounded-xl p-4 flex flex-col justify-between gap-3 cursor-pointer transition-all relative overflow-hidden select-none ${
                  isSelected
                    ? 'bg-brand-lime/10 border-brand-lime shadow-md shadow-brand-lime/10 ring-1 ring-brand-lime/30 scale-[1.01]'
                    : 'bg-[var(--input-bg)] border-[var(--glass-border)] hover:border-brand-lime/40 hover:bg-[var(--bg-card)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center p-1.5 shrink-0 transition-transform ${
                        isSelected
                          ? 'bg-brand-lime/20 border border-brand-lime/40 scale-105'
                          : 'bg-[var(--bg-card)] border border-[var(--glass-border)]'
                      }`}
                    >
                      {renderIcon(opt.category)}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[9px] font-mono font-bold tracking-wider text-brand-lime block uppercase">
                        {opt.badge}
                      </span>
                      <h4 className="text-xs font-black uppercase text-[var(--text-primary)] tracking-wide truncate">
                        {opt.name}
                      </h4>
                    </div>
                  </div>

                  {/* Radio indicator */}
                  <div className="shrink-0 pt-0.5">
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                        isSelected
                          ? 'border-brand-lime bg-brand-lime text-black'
                          : 'border-[var(--glass-border)] bg-[var(--bg-card)]'
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
                  {opt.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--glass-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-[var(--input-bg)] border border-[var(--glass-border)] hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
          >
            {t('common.cancel', 'Cancel')}
          </button>

          <button
            type="button"
            onClick={() => onSelectTaskType(selectedCategory)}
            className="px-6 py-2 rounded-xl text-xs font-black uppercase tracking-wider bg-brand-lime text-black shadow-lg shadow-brand-lime/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-2"
          >
            <span>{t('tasks.picker.continue', 'Continue')}</span>
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
};
