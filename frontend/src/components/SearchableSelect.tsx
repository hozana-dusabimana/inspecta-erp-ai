import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Check, Loader2, X } from 'lucide-react';

export interface Option {
  id: string;
  label: string;
  hint?: string; // small leading text, e.g. a flag emoji
  hasChildren?: boolean; // whether a deeper level exists below this option
}

interface SearchableSelectProps {
  value: Option | null;
  onChange: (opt: Option | null) => void;
  /** Async source. Receives the debounced query; returns matching options. */
  fetchOptions: (search: string) => Promise<Option[]>;
  placeholder?: string;
  /** Shown (disabled) e.g. before a parent selection exists. */
  disabled?: boolean;
  disabledText?: string;
  /** Bump this to force a reload of options (e.g. when the parent changes). */
  reloadKey?: string;
}

/**
 * Lightweight API-driven combobox: a button that opens a searchable dropdown.
 * Options are fetched (debounced) from `fetchOptions`, so it scales to large
 * remote lists (countries, cities) without bundling the data.
 */
export default function SearchableSelect({
  value,
  onChange,
  fetchOptions,
  placeholder = 'Select…',
  disabled = false,
  disabledText,
  reloadKey,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchRef = useRef(fetchOptions);
  fetchRef.current = fetchOptions;

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Debounced load whenever the dropdown is open, the query changes, or the
  // parent selection (reloadKey) changes.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const opts = await fetchRef.current(query.trim());
        if (alive) setOptions(opts);
      } catch {
        if (alive) setOptions([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 220);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, query, reloadKey]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [disabled]);

  const select = (opt: Option) => {
    onChange(opt);
    setOpen(false);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        className="w-full h-11 flex items-center justify-between gap-2 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none transition-all focus:border-brand-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={`flex items-center gap-2 truncate ${value ? 'text-brand-primary' : 'text-brand-on-surface-variant font-medium'}`}>
          {value?.hint && <span className="not-italic">{value.hint}</span>}
          <span className="truncate">{value ? value.label : disabled ? disabledText ?? placeholder : placeholder}</span>
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {value && !disabled && (
            <X
              className="w-3.5 h-3.5 text-brand-on-surface-variant hover:text-brand-primary"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            />
          )}
          <ChevronDown className={`w-4 h-4 text-brand-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-brand-surface border border-brand-outline-variant rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 border-b border-brand-outline-variant">
            <Search className="w-3.5 h-3.5 text-brand-on-surface-variant shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to search…"
              className="w-full h-10 bg-transparent text-xs outline-none"
            />
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-on-surface-variant shrink-0" />}
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-xs text-brand-on-surface-variant">No matches</li>
            )}
            {options.map((opt) => {
              const active = value?.id === opt.id;
              return (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => select(opt)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-brand-surface-variant ${active ? 'text-brand-primary font-bold' : 'text-brand-on-surface'}`}
                  >
                    {opt.hint && <span>{opt.hint}</span>}
                    <span className="truncate flex-1">{opt.label}</span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
