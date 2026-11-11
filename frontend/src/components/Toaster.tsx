import { useEffect, useState } from 'react';
import type { ToastDetail } from '../lib/toast';

interface Item extends ToastDetail { id: number }

/** Renders messages sent through toast(); errors stay longer so the rule's message can be read. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      const id = ++n;
      setItems((cur) => [...cur.slice(-3), { ...d, id }]);
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), d.kind === 'error' ? 8000 : 4000);
    };
    window.addEventListener('inspecta:toast', onToast);
    return () => window.removeEventListener('inspecta:toast', onToast);
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
      {items.map((i) => (
        <div
          key={i.id}
          onClick={() => setItems((cur) => cur.filter((x) => x.id !== i.id))}
          className={`cursor-pointer rounded-lg border px-4 py-3 text-xs font-semibold shadow-lg ${
            i.kind === 'error' ? 'bg-red-50 border-red-200 text-red-800'
            : i.kind === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-white border-zinc-200 text-zinc-800'}`}
        >
          {i.message}
        </div>
      ))}
    </div>
  );
}
