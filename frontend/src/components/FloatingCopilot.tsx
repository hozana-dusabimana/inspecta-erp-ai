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
  if (!user || isPublic) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="copilot-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ height: '100dvh' }}
            role="dialog"
            aria-label="Inspecta AI Copilot"
            className="fixed z-[55] top-0 bottom-0 right-0 w-full sm:w-[440px] max-w-full overflow-hidden border-l border-brand-outline-variant/30 shadow-2xl bg-brand-surface-container-low flex flex-col"
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

      {!open && (
        <button
          id="btn-floating-copilot"
          onClick={() => setOpen(true)}
          aria-label="Open AI Copilot"
          title="Ask Inspecta AI"
          className="fixed z-[55] bottom-5 right-4 sm:right-6 w-12 h-12 rounded-full bg-brand-primary text-white shadow-xl ring-4 ring-white/70 hover:bg-brand-primary-container hover:scale-105 transition-all flex items-center justify-center cursor-pointer"
        >
          <Sparkles className="w-5 h-5" />
        </button>
      )}
    </>
  );
}
