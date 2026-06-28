import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppView, ChatMessage } from '../types';
import { viewForPath } from './routes';

interface ChatState {
  chatHistory: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  setHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** Label of the last non-Copilot page, so the Copilot knows the page context. */
  pageContext: string;
}

const ChatContext = createContext<ChatState | undefined>(undefined);

const GREETING: ChatMessage = {
  id: 'greeting',
  sender: 'assistant',
  text: "Hello. I am Inspecta Copilot, your construction-intelligence partner. I can analyze productivity, cost, schedule, inventory and compliance across your projects. How can I help today?",
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chatHistory, setHistory] = useState<ChatMessage[]>([GREETING]);
  const location = useLocation();
  const lastView = useRef<string>('Dashboard');

  // Remember the last non-Copilot view so the Copilot gets useful page context.
  useEffect(() => {
    const view = viewForPath(location.pathname);
    if (view && view !== AppView.COPILOT && view !== AppView.LANDING && view !== AppView.LOGIN) {
      lastView.current = String(view);
    }
  }, [location.pathname]);

  const addMessage = (msg: ChatMessage) => setHistory((prev) => [...prev, msg]);

  return (
    <ChatContext.Provider value={{ chatHistory, addMessage, setHistory, pageContext: lastView.current }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
