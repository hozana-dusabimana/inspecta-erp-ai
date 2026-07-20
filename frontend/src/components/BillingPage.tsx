import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard, Smartphone, Landmark, Check, Clock, X, AlertTriangle, Copy, Send,
} from 'lucide-react';
import { AppView } from '../types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { BillingState } from '../lib/billingStore';
import ErpLayout from './ErpLayout';

interface Props {
  onNavigate: (view: AppView) => void;
  onLogout: () => void;
}

type Period = 'MONTHLY' | 'ANNUAL';

interface PlanOption {
  plan: string;
  label: string;
  monthlyPrice: string;
  annualPrice: string;
  currency: string;
  description: string | null;
  limits: { maxUsers: number | null; maxProjects: number | null };
  current: boolean;
}

interface PaymentAccount {
  id: string;
  type: 'MOBILE_MONEY' | 'BANK';
  label: string;
  accountName: string;
  accountNumber: string;
  bankName: string | null;
  instructions: string | null;
}

interface PaymentRequest {
  id: string;
  plan: string;
  period: Period;
  amount: string;
  currency: string;
  payerName: string;
  payerPhone: string;
  reference: string;
  paidAt: string | null;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedAt: string | null;
  reviewNote: string | null;
  activatedUntil: string | null;
  createdAt: string;
  paymentAccount: { id: string; label: string; accountNumber: string } | null;
}

interface BillingPayload {
  company: string;
  state: BillingState;
  usage: { plan: string; users: { used: number; limit: number | null }; projects: { used: number; limit: number | null } };
  plans: PlanOption[];
  paymentAccounts: PaymentAccount[];
  requests: PaymentRequest[];
  pendingRequest: PaymentRequest | null;
}

const cardCls = 'bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-sm';
const inputCls =
  'w-full h-10 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold text-brand-primary outline-none focus:border-brand-primary transition-all';
const labelCls = 'font-sans text-[10px] font-bold text-brand-on-surface-variant block mb-1';
const btnCls = 'bg-brand-primary text-white font-bold text-xs rounded-lg px-4 py-2.5 hover:bg-brand-primary-container transition-all disabled:opacity-60';

const money = (v: string | number, currency = 'RWF') =>
  `${currency} ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

const STATUS_TONE: Record<string, string> = {
  EXEMPT: 'bg-brand-surface text-brand-on-surface-variant',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  TRIAL: 'bg-sky-100 text-sky-700',
  GRACE: 'bg-amber-100 text-amber-700',
  LAPSED: 'bg-red-100 text-red-700',
};

const REQUEST_TONE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const STATUS_LABEL: Record<string, string> = {
  EXEMPT: 'No billing',
  ACTIVE: 'Active',
  TRIAL: 'Free trial',
  GRACE: 'Payment overdue',
  LAPSED: 'Read-only',
};

/** Click-to-copy for account numbers — these get typed into a phone keypad. */
function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="inline-flex items-center gap-1.5 font-mono text-sm font-bold text-brand-primary hover:text-brand-secondary-container transition-colors"
      title="Copy"
    >
      {value}
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 opacity-50" />}
    </button>
  );
}

function quota(used: number, limit: number | null) {
  return `${used} / ${limit ?? '∞'}`;
}

export default function BillingPage({ onNavigate, onLogout }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingPayload>('/billing'),
  });
  const b = data?.data;

  // Read the RAW permission list rather than hasPermission(): a lapsed workspace
  // withholds every ':write', and that is precisely when paying must still work.
  const canPay = Boolean(user?.permissions.includes('user:write'));

  const [period, setPeriod] = useState<Period>('MONTHLY');
  const [chosenPlan, setChosenPlan] = useState<string | null>(null);
  const [form, setForm] = useState({ paymentAccountId: '', payerName: '', payerPhone: '', reference: '', note: '' });

  const submit = useMutation({
    mutationFn: () => api.post('/billing/requests', { plan: chosenPlan, period, ...form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      setChosenPlan(null);
      setForm({ paymentAccountId: '', payerName: '', payerPhone: '', reference: '', note: '' });
    },
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => api.del(`/billing/requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }),
  });
  const err = submit.error instanceof ApiError ? submit.error.message : submit.isError ? 'Could not submit your payment' : null;

  if (isLoading || !b) {
    return (
      <ErpLayout active={AppView.BILLING} title="Billing & Plan" subtitle="Your subscription, plans and payments." onNavigate={onNavigate} onLogout={onLogout}>
        <p className="text-brand-on-surface-variant text-xs">Loading billing…</p>
      </ErpLayout>
    );
  }

  const selected = b.plans.find((p) => p.plan === chosenPlan);
  const selectedPrice = selected ? (period === 'ANNUAL' ? selected.annualPrice : selected.monthlyPrice) : null;

  return (
    <ErpLayout
      active={AppView.BILLING}
      title="Billing & Plan"
      subtitle="Your subscription, what it includes, and how to pay for it."
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {/* ── Current state ─────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <div className={`${cardCls} p-5 lg:col-span-2`}>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <CreditCard className="w-5 h-5 text-brand-secondary-container" />
            <h3 className="font-display text-lg font-extrabold text-brand-primary">{b.state.planLabel} plan</h3>
            <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${STATUS_TONE[b.state.status]}`}>
              {STATUS_LABEL[b.state.status]}
            </span>
          </div>

          {b.state.message && (
            <div className={`flex gap-2 p-3 rounded-lg mb-4 ${b.state.readOnly ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
              <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${b.state.readOnly ? 'text-red-600' : 'text-amber-600'}`} />
              <p className={`text-[11px] leading-relaxed ${b.state.readOnly ? 'text-red-700' : 'text-amber-700'}`}>{b.state.message}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className={labelCls}>{b.state.status === 'TRIAL' ? 'TRIAL ENDS' : 'RENEWS / ENDS'}</p>
              <p className="font-mono text-sm font-extrabold text-brand-primary">{fmtDate(b.state.expiresAt)}</p>
            </div>
            <div>
              <p className={labelCls}>DAYS LEFT</p>
              <p className={`font-mono text-sm font-extrabold ${(b.state.daysRemaining ?? 1) <= 0 ? 'text-brand-status-critical' : 'text-brand-primary'}`}>
                {b.state.daysRemaining === null ? '—' : Math.max(0, b.state.daysRemaining)}
              </p>
            </div>
            <div>
              <p className={labelCls}>USERS</p>
              <p className="font-mono text-sm font-extrabold text-brand-primary">{quota(b.usage.users.used, b.usage.users.limit)}</p>
            </div>
            <div>
              <p className={labelCls}>PROJECTS</p>
              <p className="font-mono text-sm font-extrabold text-brand-primary">{quota(b.usage.projects.used, b.usage.projects.limit)}</p>
            </div>
          </div>
        </div>

        {/* Pending claim */}
        <div className={`${cardCls} p-5`}>
          <h3 className="font-display text-sm font-extrabold text-brand-primary mb-3">Payment status</h3>
          {b.pendingRequest ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-amber-700">Awaiting approval</span>
              </div>
              <p className="text-[11px] text-brand-on-surface-variant leading-relaxed">
                We received your payment of <strong>{money(b.pendingRequest.amount, b.pendingRequest.currency)}</strong> for the{' '}
                {b.pendingRequest.plan.toLowerCase()} plan (ref <span className="font-mono">{b.pendingRequest.reference}</span>).
                It will be activated once our team confirms the transfer.
              </p>
              {canPay && (
                <button
                  onClick={() => withdraw.mutate(b.pendingRequest!.id)}
                  disabled={withdraw.isPending}
                  className="text-[11px] font-bold text-brand-on-surface-variant hover:text-brand-status-critical disabled:opacity-50"
                >
                  Withdraw this request
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-brand-on-surface-variant leading-relaxed">
              No payment awaiting approval.{' '}
              {canPay ? 'Choose a plan below, pay to one of the accounts, then submit the reference.' : 'Ask an administrator to manage the subscription.'}
            </p>
          )}
        </div>
      </div>

      {/* ── Plans ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-display text-sm font-extrabold text-brand-primary">Choose a plan</h3>
        <div className="flex gap-1.5 bg-brand-surface-container p-1 rounded-lg border border-brand-outline-variant/10">
          {(['MONTHLY', 'ANNUAL'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                period === p ? 'bg-brand-surface-container-lowest shadow-sm text-brand-primary' : 'text-brand-on-surface-variant hover:text-brand-primary'
              }`}
            >
              {p === 'MONTHLY' ? 'Monthly' : 'Annual'}
            </button>
          ))}
        </div>
      </div>

      {b.plans.length === 0 ? (
        <div className={`${cardCls} p-6 text-center text-brand-on-surface-variant text-xs mb-6`}>
          No plans are published yet. Please contact us to arrange your subscription.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
          {b.plans.map((p) => {
            const price = period === 'ANNUAL' ? p.annualPrice : p.monthlyPrice;
            const unavailable = Number(price) <= 0;
            const isChosen = chosenPlan === p.plan;
            return (
              <div
                key={p.plan}
                className={`${cardCls} p-5 flex flex-col ${isChosen ? 'ring-2 ring-brand-secondary-container' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-display text-base font-extrabold text-brand-primary">{p.label}</h4>
                  {p.current && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-700">Current</span>}
                </div>
                <p className="font-mono text-xl font-extrabold text-brand-primary">
                  {unavailable ? 'On request' : money(price, p.currency)}
                </p>
                <p className="text-[10px] text-brand-on-surface-variant mb-3">{period === 'ANNUAL' ? 'per year' : 'per month'}</p>
                {p.description && <p className="text-[11px] text-brand-on-surface-variant mb-3">{p.description}</p>}
                <ul className="text-[11px] text-brand-on-surface-variant space-y-1 mb-4">
                  <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-600" /> {p.limits.maxUsers ?? 'Unlimited'} users</li>
                  <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-600" /> {p.limits.maxProjects ?? 'Unlimited'} projects</li>
                  <li className="flex items-center gap-2"><Check className="w-3 h-3 text-emerald-600" /> All ERP modules</li>
                </ul>
                <button
                  disabled={!canPay || unavailable || Boolean(b.pendingRequest)}
                  onClick={() => setChosenPlan(p.plan)}
                  className={`mt-auto w-full h-10 ${btnCls} disabled:cursor-not-allowed`}
                  title={!canPay ? 'Only a company administrator can do this' : b.pendingRequest ? 'You already have a payment awaiting approval' : undefined}
                >
                  {isChosen ? 'Selected' : 'Choose'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pay & submit ──────────────────────────────────────────── */}
      {canPay && chosenPlan && (
        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <div className={`${cardCls} p-5`}>
            <h3 className="font-display text-sm font-extrabold text-brand-primary mb-1">1 · Send {money(selectedPrice ?? 0, selected?.currency)}</h3>
            <p className="text-[11px] text-brand-on-surface-variant mb-4">
              Pay to any account below, then record the reference on the right.
            </p>
            {b.paymentAccounts.length === 0 ? (
              <p className="text-[11px] text-brand-status-critical font-semibold">
                No payment accounts have been published yet. Please contact support.
              </p>
            ) : (
              <div className="space-y-3">
                {b.paymentAccounts.map((acc) => (
                  <div key={acc.id} className="p-3 rounded-lg border border-brand-outline-variant/30 bg-brand-surface/40">
                    <div className="flex items-center gap-2 mb-1">
                      {acc.type === 'MOBILE_MONEY' ? <Smartphone className="w-3.5 h-3.5 text-brand-secondary-container" /> : <Landmark className="w-3.5 h-3.5 text-brand-secondary-container" />}
                      <span className="text-xs font-bold text-brand-primary">{acc.label}</span>
                      {acc.bankName && <span className="text-[10px] text-brand-on-surface-variant">· {acc.bankName}</span>}
                    </div>
                    <p className="text-[11px] text-brand-on-surface-variant">{acc.accountName}</p>
                    <CopyField value={acc.accountNumber} />
                    {acc.instructions && <p className="text-[10px] text-brand-on-surface-variant mt-1">{acc.instructions}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
            className={`${cardCls} p-5 space-y-3`}
          >
            <h3 className="font-display text-sm font-extrabold text-brand-primary">2 · Confirm your payment</h3>
            <p className="text-[11px] text-brand-on-surface-variant">
              {selected?.label} · {period === 'ANNUAL' ? 'annual' : 'monthly'} · <strong>{money(selectedPrice ?? 0, selected?.currency)}</strong>
            </p>
            <div>
              <label className={labelCls}>PAID TO</label>
              <select className={inputCls} value={form.paymentAccountId} onChange={(e) => setForm({ ...form, paymentAccountId: e.target.value })}>
                <option value="">Select the account you paid</option>
                {b.paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.accountNumber}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>PAYER NAME</label>
                <input className={inputCls} required value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>PAYER PHONE</label>
                <input className={inputCls} required value={form.payerPhone} onChange={(e) => setForm({ ...form, payerPhone: e.target.value })} placeholder="+250…" />
              </div>
            </div>
            <div>
              <label className={labelCls}>TRANSACTION REFERENCE</label>
              <input className={inputCls} required value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. MoMo transaction ID" />
            </div>
            <div>
              <label className={labelCls}>NOTE (OPTIONAL)</label>
              <textarea className={`${inputCls} h-16 py-2 resize-none`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            {err && <p className="text-red-600 text-[11px] font-semibold">{err}</p>}
            <button type="submit" disabled={submit.isPending} className={`w-full h-11 flex items-center justify-center gap-2 ${btnCls}`}>
              <Send className="w-4 h-4" /> {submit.isPending ? 'Submitting…' : 'Submit for approval'}
            </button>
            <p className="text-[10px] text-brand-on-surface-variant">
              Our team verifies the transfer and activates your plan. You will get a notification either way.
            </p>
          </form>
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────── */}
      <div className={`${cardCls} overflow-x-auto`}>
        <h3 className="font-display text-sm font-extrabold text-brand-primary p-4 pb-2">Payment history</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-brand-on-surface-variant border-b border-brand-outline-variant/20">
              <th className="px-4 py-3 font-bold">Submitted</th>
              <th className="px-4 py-3 font-bold">Plan</th>
              <th className="px-4 py-3 font-bold text-right">Amount</th>
              <th className="px-4 py-3 font-bold">Reference</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 font-bold">Active until</th>
            </tr>
          </thead>
          <tbody>
            {b.requests.map((r) => (
              <tr key={r.id} className="border-b border-brand-outline-variant/10 last:border-0">
                <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-3 font-bold text-brand-primary">{r.plan} · {r.period === 'ANNUAL' ? 'Annual' : 'Monthly'}</td>
                <td className="px-4 py-3 text-right font-mono">{money(r.amount, r.currency)}</td>
                <td className="px-4 py-3 font-mono text-[10px] text-brand-on-surface-variant">{r.reference}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${REQUEST_TONE[r.status]}`}>{r.status}</span>
                  {r.reviewNote && <p className="text-[10px] text-brand-on-surface-variant mt-1 max-w-[14rem]">{r.reviewNote}</p>}
                </td>
                <td className="px-4 py-3 text-brand-on-surface-variant">{fmtDate(r.activatedUntil)}</td>
              </tr>
            ))}
            {b.requests.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-on-surface-variant">No payments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ErpLayout>
  );
}
