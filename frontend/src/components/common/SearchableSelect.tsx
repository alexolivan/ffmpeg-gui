import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  computeDropdownPlacement,
  filterSelectOptions,
  type DropdownPlacement,
  type SelectOption,
} from '../../utils/searchableSelectHelper';

export type { SelectOption };

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  maxDropdownHeight?: number;
  minDropdownWidth?: number;
  id?: string;
  'aria-label'?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  searchable,
  disabled = false,
  className = '',
  buttonClassName = '',
  maxDropdownHeight = 280,
  minDropdownWidth = 180,
  id,
  'aria-label': ariaLabel,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [placement, setPlacement] = useState<DropdownPlacement | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const showSearch = searchable ?? options.length > 8;

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(
    () => (showSearch ? filterSelectOptions(options, query) : options),
    [options, query, showSearch]
  );

  const displayLabel = selectedOption
    ? selectedOption.label
    : value
      ? value
      : placeholder || t('common.selectOption', 'Select...');

  const updatePlacement = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPlacement(
      computeDropdownPlacement(
        { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
        { width: window.innerWidth, height: window.innerHeight },
        maxDropdownHeight,
        minDropdownWidth
      )
    );
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePlacement();
  }, [isOpen, filteredOptions.length]);

  useEffect(() => {
    if (!isOpen) return;

    const initialIdx = filteredOptions.findIndex((o) => o.value === value && !o.disabled);
    setHighlightedIndex(initialIdx >= 0 ? initialIdx : filteredOptions.findIndex((o) => !o.disabled));

    const focusTimer = requestAnimationFrame(() => {
      if (showSearch && searchInputRef.current) {
        searchInputRef.current.focus({ preventScroll: true });
      }
      if (initialIdx >= 0 && optionRefs.current[initialIdx]) {
        optionRefs.current[initialIdx]?.scrollIntoView({ block: 'nearest' });
      }
    });

    const handleOutsideMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
        setQuery('');
      }
    };

    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      updatePlacement();
    };

    const handleResize = () => updatePlacement();

    document.addEventListener('mousedown', handleOutsideMouseDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    setQuery('');
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  const selectValue = (nextVal: string) => {
    onChange(nextVal);
    closeMenu(true);
  };

  const moveHighlight = (delta: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    let next = highlightedIndex;
    for (let step = 0; step < filteredOptions.length; step++) {
      next = (next + delta + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next].disabled) {
        setHighlightedIndex(next);
        optionRefs.current[next]?.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveHighlight(-1);
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && filteredOptions[highlightedIndex] && !filteredOptions[highlightedIndex].disabled) {
        e.preventDefault();
        selectValue(filteredOptions[highlightedIndex].value);
      }
    } else if (e.key === 'Tab') {
      closeMenu(false);
    }
  };

  // Group filtered options while tracking flat index for keyboard highlight
  const groupedSections = useMemo(() => {
    const sections: Array<{ group: string | null; items: Array<{ option: SelectOption; flatIndex: number }> }> = [];
    const groupIndexMap = new Map<string, number>();

    filteredOptions.forEach((option, flatIndex) => {
      const gKey = option.group ?? '';
      if (!option.group) {
        const last = sections[sections.length - 1];
        if (last && last.group === null) {
          last.items.push({ option, flatIndex });
        } else {
          sections.push({ group: null, items: [{ option, flatIndex }] });
        }
        return;
      }

      const existingIdx = groupIndexMap.get(gKey);
      if (existingIdx !== undefined) {
        sections[existingIdx].items.push({ option, flatIndex });
      } else {
        groupIndexMap.set(gKey, sections.length);
        sections.push({ group: option.group, items: [{ option, flatIndex }] });
      }
    });

    return sections;
  }, [filteredOptions]);

  return (
    <div className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => {
            if (prev) setQuery('');
            return !prev;
          });
        }}
        className={`w-full flex items-center justify-between gap-2 text-left bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs text-[var(--text-primary)] outline-none transition-colors ${
          isOpen ? 'border-brand-orange' : 'hover:border-[var(--glass-border-hover)] focus:border-brand-orange'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${buttonClassName}`}
      >
        <span className={`truncate ${!selectedOption && !value ? 'text-[var(--text-secondary)]' : ''}`}>
          {displayLabel}
        </span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-brand-orange' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && placement && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: placement.top,
            bottom: placement.bottom,
            left: placement.left,
            width: placement.width,
            maxHeight: placement.maxHeight,
            zIndex: 9999,
          }}
          className="flex flex-col rounded-xl bg-[var(--bg-dark)] border border-[var(--glass-border)] shadow-2xl overflow-hidden text-[var(--text-primary)]"
          onKeyDown={handleKeyDown}
        >
          {showSearch && (
            <div className="p-2 border-b border-[var(--glass-border)] bg-[var(--input-bg)] shrink-0">
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder={searchPlaceholder || t('common.searchPlaceholder', 'Search...')}
                className="w-full rounded-lg px-2.5 py-1.5 text-xs bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none focus:border-brand-orange"
              />
            </div>
          )}

          <div role="listbox" className="overflow-y-auto flex-1 min-h-0 p-1 space-y-0.5 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
                {emptyMessage || t('common.noMatchingOptions', 'No matching options')}
              </div>
            ) : (
              groupedSections.map((section, secIdx) => (
                <div key={section.group ?? `section-${secIdx}`}>
                  {section.group && (
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                      {section.group}
                    </div>
                  )}
                  {section.items.map(({ option, flatIndex }) => {
                    const isSelected = option.value === value;
                    const isHighlighted = flatIndex === highlightedIndex;
                    return (
                      <button
                        key={`${option.value}-${flatIndex}`}
                        ref={(el) => {
                          optionRefs.current[flatIndex] = el;
                        }}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={option.disabled}
                        onMouseEnter={() => setHighlightedIndex(flatIndex)}
                        onClick={() => !option.disabled && selectValue(option.value)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 transition-colors ${
                          option.disabled
                            ? 'opacity-40 cursor-not-allowed'
                            : isSelected
                              ? 'bg-brand-orange/20 text-brand-orange font-semibold cursor-pointer'
                              : isHighlighted
                                ? 'bg-[var(--input-bg)] text-[var(--text-primary)] cursor-pointer'
                                : 'text-[var(--text-primary)] hover:bg-[var(--input-bg)] cursor-pointer'
                        }`}
                      >
                        <span className="truncate">{option.label}</span>
                        {isSelected && <span className="text-[10px] shrink-0">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
