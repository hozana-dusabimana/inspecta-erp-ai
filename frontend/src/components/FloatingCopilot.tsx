import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useChat } from '../lib/chat';
import { useViewNavigate } from '../lib/routes';
import CopilotWorkspace from './CopilotWorkspace';

/** Pages where a floating button makes no sense (the Copilot page itself, public/auth pages). */
const HIDDEN_PREFIXES = ['/copilot', '/login', '/signup', '/verify-email', '/forgot-password', '/reset-password'];

/**
 * Always-available agentic Copilot: a floating button on every signed-in page that
 * opens the same Copilot (chat, files, voice, create-by-chat) in a side panel.
 */
export default function FloatingCopilot() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigateView = useViewNavigate();
  const { chatHistory, addMessage, setHistory, pageContext } = useChat();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isPublic = pathname === '/' || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  if (!user || isPublic || pathname.startsWith('/platform')) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="copilot-panel"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-label="Inspecta AI Copilot"
            className="fixed z-[55] bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] sm:w-[420px] h-[min(640px,calc(100vh-8rem))] rounded-2xl overflow-hidden border border-brand-outline-variant/30 shadow-2xl bg-brand-surface"
          >
            <CopilotWorkspace
              variant="panel"
              onClose={() => setOpen(false)}
              onNavigate={navigateView}
              chatHistory={chatHistory}
              onAddMessage={addMessage}
              onSetHistory={setHistory}
              pageContext={pageContext}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <button
        id="btn-floating-copilot"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close AI Copilot' : 'Open AI Copilot'}
        title="Ask Inspecta AI"
        className="fixed z-[55] bottom-6 right-4 sm:right-6 h-14 px-5 rounded-full bg-brand-primary text-white shadow-xl hover:bg-brand-primary-container transition-all flex items-center gap-2 cursor-pointer"
      >
        <Sparkles className="w-5 h-5" />
        <span className="hidden sm:inline text-xs font-bold">Ask AI</span>
      </button>
    </>
  );
}
