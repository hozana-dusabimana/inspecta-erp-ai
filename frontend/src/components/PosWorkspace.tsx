import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Plus, Minus, Trash2, Receipt, LockOpen, Lock } from 'lucide-react';
import { api } from '../lib/api';

const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const dt = (d: unknown) => (d ? new Date(String(d)).toLocaleString() : '—');

interface Product { id: string; name: string; unit: string; unitPrice: number; vatApplicable: boolean; productType: string }
interface Session { id: string; openingFloat: number; openedAt: string; status: string; countedCash?: number; expectedCash?: number; variance?: number; _count?: { transactions: number } }
interface CartLine { product: Product; quantity: number }

export default function PosWorkspace({ canWrite }: { projectId?: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [clientName, setClientName] = useState('');
  const [method, setMethod] = useState('CASH');
  const [openingFloat, setOpeningFloat] = useState('');
  const [counted, setCounted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: productsData } = useQuery({ queryKey: ['/pos/products'], queryFn: () => api.get<Product[]>('/pos/products?pageSize=200') });
  const { data: sessionsData } = useQuery({ queryKey: ['/pos/sessions'], queryFn: () => api.get<Session[]>('/pos/sessions?pageSize=50') });
  const products = productsData?.data ?? [];
  const sessions = sessionsData?.data ?? [];
  const openSession = sessions.find((s) => s.status === 'OPEN');

  const { data: txnData } = useQuery({
    queryKey: ['/pos/transactions', openSession?.id ?? 'none'],
    queryFn: () => api.get<any[]>(`/pos/transactions${openSession ? `?tillSessionId=${openSession.id}` : ''}&pageSize=25`),
    enabled: Boolean(openSession),
  });
  const txns = txnData?.data ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['/pos/summary'] });
    qc.invalidateQueries({ queryKey: ['/pos/sessions'] });
    qc.invalidateQueries({ queryKey: ['/pos/transactions'] });
  };

  const openTill = useMutation({
    mutationFn: () => api.post('/pos/sessions', { openingFloat: Number(openingFloat || 0) }),
    onSuccess: () => { setOpeningFloat(''); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed'),
  });
  const closeTill = useMutation({
    mutationFn: (id: string) => api.post(`/pos/sessions/${id}/close`, { countedCash: Number(counted || 0) }),
    onSuccess: () => { setCounted(''); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed'),
  });
  const checkout = useMutation({
    mutationFn: () => api.post('/pos/transactions', {
      tillSessionId: openSession!.id,
      clientName: clientName || undefined,
      paymentMethod: method,
      lines: cart.map((l) => ({ posProductId: l.product.id, quantity: l.quantity })),
    }),
    onSuccess: () => { setCart([]); setClientName(''); setError(null); invalidate(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Checkout failed'),
  });

  const totals = useMemo(() => {
    let subtotal = 0, vat = 0;
    for (const l of cart) {
      const lt = l.product.unitPrice * l.quantity;
      subtotal += lt;
      if (l.product.vatApplicable) vat += lt * 0.18;
    }
    return { subtotal, vat, total: subtotal + vat };
  }, [cart]);

  const addToCart = (p: Product) => setCart((c) => {
    const existing = c.find((l) => l.product.id === p.id);
    return existing ? c.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { product: p, quantity: 1 }];
  });
  const setQty = (id: string, delta: number) => setCart((c) => c.flatMap((l) => {
    if (l.product.id !== id) return [l];
    const q = l.quantity + delta;
    return q <= 0 ? [] : [{ ...l, quantity: q }];
  }));

  return (
    <div className="space-y-5">
      {/* KPI cards render above the tabs via the module summary banner (PosSummary). */}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</div>}

      {!openSession ? (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-5">
          <h3 className="font-bold text-sm text-brand-primary mb-3 flex items-center gap-2"><LockOpen className="w-4 h-4" /> Open a till session to start selling</h3>
          {canWrite ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-brand-on-surface-variant uppercase block">Opening float</label>
                <input type="number" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} className="h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              </div>
              <button onClick={() => openTill.mutate()} disabled={openTill.isPending} className="h-10 px-4 rounded-lg bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary-container disabled:opacity-50">Open till</button>
            </div>
          ) : <p className="text-xs text-brand-on-surface-variant">No open till session.</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Products */}
          <div className="lg:col-span-2 bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 overflow-hidden">
            <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-sm text-brand-primary">Products</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-4">
              {products.length === 0 && <p className="text-xs text-brand-on-surface-variant col-span-3">No POS products yet — add them in the Products tab.</p>}
              {products.map((p) => (
                <button key={p.id} disabled={!canWrite} onClick={() => addToCart(p)} className="text-left p-3 rounded-lg border border-brand-outline-variant/30 hover:border-brand-primary hover:bg-brand-primary/5 transition-all disabled:opacity-50">
                  <p className="font-bold text-xs text-brand-primary truncate">{p.name}</p>
                  <p className="text-[10px] text-brand-on-surface-variant">{p.unit} · {p.productType}</p>
                  <p className="font-mono text-sm font-extrabold mt-1">{money(p.unitPrice)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Cart */}
          <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 flex flex-col">
            <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-sm text-brand-primary flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Cart</div>
            <div className="flex-1 p-3 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
              {cart.length === 0 && <p className="text-xs text-brand-on-surface-variant px-2 py-4 text-center">Tap a product to add it.</p>}
              {cart.map((l) => (
                <div key={l.product.id} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{l.product.name}</p>
                    <p className="text-[10px] text-brand-on-surface-variant font-mono">{money(l.product.unitPrice)} × {l.quantity}</p>
                  </div>
                  <button onClick={() => setQty(l.product.id, -1)} className="p-1 rounded bg-brand-surface hover:bg-brand-outline-variant/20"><Minus className="w-3 h-3" /></button>
                  <span className="w-5 text-center font-mono">{l.quantity}</span>
                  <button onClick={() => setQty(l.product.id, 1)} className="p-1 rounded bg-brand-surface hover:bg-brand-outline-variant/20"><Plus className="w-3 h-3" /></button>
                  <button onClick={() => setCart((c) => c.filter((x) => x.product.id !== l.product.id))} className="p-1 rounded text-red-600 hover:bg-red-50"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-brand-outline-variant/15 space-y-2">
              <Row label="Subtotal" value={money(totals.subtotal)} />
              <Row label="VAT (18%)" value={money(totals.vat)} />
              <Row label="Total" value={money(totals.total)} bold />
              <input placeholder="Client name (optional)" value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary font-semibold">
                <option value="CASH">Cash</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
              <button disabled={!canWrite || cart.length === 0 || checkout.isPending} onClick={() => checkout.mutate()} className="w-full h-10 rounded-lg bg-brand-primary text-white font-bold text-xs hover:bg-brand-primary-container disabled:opacity-50 flex items-center justify-center gap-2">
                <Receipt className="w-4 h-4" /> {checkout.isPending ? 'Processing…' : 'Complete Sale'}
              </button>
            </div>
          </div>
        </div>
      )}

      {openSession && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 p-4 flex flex-wrap items-end justify-between gap-3">
          <div className="text-xs text-brand-on-surface-variant">
            <span className="font-bold text-brand-primary">Open till</span> — opened {dt(openSession.openedAt)} · float {money(openSession.openingFloat)} · {openSession._count?.transactions ?? txns.length} sales
          </div>
          {canWrite && (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-brand-on-surface-variant uppercase block">Counted cash</label>
                <input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} className="h-9 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs outline-none focus:border-brand-primary" />
              </div>
              <button onClick={() => closeTill.mutate(openSession.id)} disabled={!counted || closeTill.isPending} className="h-9 px-4 rounded-lg bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Close till</button>
            </div>
          )}
        </div>
      )}

      {/* Recent transactions */}
      <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 overflow-hidden">
        <div className="px-5 py-3 border-b border-brand-outline-variant/15 font-bold text-sm text-brand-primary">Recent Receipts</div>
        {txns.length === 0 ? (
          <div className="p-6 text-center text-xs text-brand-on-surface-variant">No receipts in this session yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-brand-on-surface-variant font-bold text-left border-b border-brand-outline-variant/20">
                <th className="px-5 py-2">Receipt</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">VAT</th><th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-b border-brand-outline-variant/10">
                  <td className="px-5 py-2 font-mono font-semibold">{t.receiptNumber}</td>
                  <td className="px-3 py-2">{t.clientName}</td>
                  <td className="px-3 py-2">{String(t.paymentMethod).replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(t.vatAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-brand-primary">{money(t.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-xs ${bold ? 'font-extrabold text-brand-primary text-sm' : 'text-brand-on-surface-variant'}`}>
      <span>{label}</span><span className="font-mono">{value}</span>
    </div>
  );
}
