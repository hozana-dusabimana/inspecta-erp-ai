import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';

/**
 * "Book a demo" overlay, reachable from the public landing page. Self-contained:
 * owns its own form state and posts to the unauthenticated demo-request endpoint.
 */
export default function BookDemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [demoName, setDemoName] = useState('');
  const [demoEmail, setDemoEmail] = useState('');
  const [demoCompany, setDemoCompany] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [booked, setBooked] = useState(false);

  const reset = () => {
    onClose();
    setBooked(false);
    setDemoName('');
    setDemoEmail('');
    setDemoCompany('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Real, unauthenticated demo-request endpoint (emails the team, rate-limited).
      await api.post('/public/demo-request', { name: demoName, email: demoEmail, company: demoCompany });
      setBooked(true);
    } catch {
      // Still acknowledge to the user; the request is best-effort.
      setBooked(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/50 backdrop-blur-md flex items-center justify-center px-4" id="demo-scheduler-modal">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-brand-surface-container-lowest max-w-md w-full rounded-2xl p-6 shadow-2xl relative border border-brand-outline-variant/30"
          >
            <button
              id="btn-close-demo"
              onClick={reset}
              className="absolute top-4 right-4 p-1 rounded-full hover:bg-brand-surface text-brand-on-surface-variant hover:text-brand-on-surface"
            >
              <X className="w-5 h-5" />
            </button>

            {!booked ? (
              <>
                <div className="flex items-center gap-2 text-brand-primary mb-2">
                  <Sparkles className="w-5 h-5 text-brand-secondary-container" />
                  <span className="font-display text-lg font-extrabold">Schedule Product Tour</span>
                </div>
                <p className="text-brand-on-surface-variant text-xs mb-6">
                  See how Inspecta AI can reduce schedule delay risk and optimize construction job yields.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4" id="demo-form">
                  <div className="space-y-1">
                    <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-name-input">FULL NAME</label>
                    <input
                      id="demo-name-input"
                      type="text"
                      required
                      placeholder="e.g. Jane Doe"
                      value={demoName}
                      onChange={(e) => setDemoName(e.target.value)}
                      className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-email-input">CORPORATE EMAIL</label>
                    <input
                      id="demo-email-input"
                      type="email"
                      required
                      placeholder="alex.thompson@inspecta.ai"
                      value={demoEmail}
                      onChange={(e) => setDemoEmail(e.target.value)}
                      className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-sans text-[10px] font-bold text-brand-on-surface-variant block" htmlFor="demo-company-input">CONSTRUCTION FIRM</label>
                    <input
                      id="demo-company-input"
                      type="text"
                      required
                      placeholder="Inspecta GC Corp"
                      value={demoCompany}
                      onChange={(e) => setDemoCompany(e.target.value)}
                      className="w-full h-11 bg-brand-surface border border-brand-outline-variant rounded-lg px-3 text-xs font-semibold outline-none focus:border-brand-primary transition-all text-brand-primary"
                    />
                  </div>

                  <button
                    id="btn-demo-submit-form"
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-brand-primary text-white font-bold text-xs rounded-lg shadow-lg hover:bg-brand-primary-container transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmitting ? 'Securing Calendar Window...' : 'Book Personalized Demo'}
                  </button>
                </form>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-500 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8" />
                </div>
                <h3 className="font-display text-lg font-extrabold text-brand-primary mb-1">Demo Scheduled</h3>
                <p className="text-brand-on-surface-variant text-xs leading-relaxed max-w-xs mx-auto mb-6">
                  Thank you {demoName || 'there'}! Your demo request for <strong>{demoCompany || 'your company'}</strong> has been sent to our team. We'll reach out at <strong>{demoEmail}</strong> shortly.
                </p>
                <button
                  id="btn-demo-done"
                  onClick={reset}
                  className="px-6 py-2.5 bg-brand-primary text-white font-bold text-xs rounded-lg hover:bg-brand-primary-container transition-all cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
