import React from 'react';

/** One badge for every SPI / CPI / margin / burn status coming from the backend rule set. */
export type IndexStatus = 'NO_DATA' | 'ON_TRACK' | 'AT_RISK' | 'CRITICAL';

const STYLE: Record<IndexStatus, { label: string; cls: string; dot: string }> = {
  ON_TRACK: { label: 'ON TRACK', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  AT_RISK: { label: 'AT RISK', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  CRITICAL: { label: 'CRITICAL', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  NO_DATA: { label: 'NO DATA', cls: 'bg-brand-surface-container text-brand-on-surface-variant border-brand-outline-variant/30', dot: 'bg-brand-outline-variant' },
};

export function StatusBadge({ status }: { status?: IndexStatus | null }) {
  const s = STYLE[status ?? 'NO_DATA'] ?? STYLE.NO_DATA;
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap text-[9px] font-bold border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
    </span>
  );
}

/** Format a possibly-missing number: null/undefined renders "No data" instead of a misleading 0. */
export function orNoData(v: number | null | undefined, fmt: (n: number) => string): string {
  return v == null || !Number.isFinite(Number(v)) ? 'No data' : fmt(Number(v));
}
