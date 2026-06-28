import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Bot, 
  Send, 
  Mic, 
  Sparkles, 
  MicOff, 
  Plus,
  Clock,
  TrendingUp, 
  FileText, 
  HardHat, 
  Calendar,
  Layers,
  Brain,
  MessageSquareCode,
  Globe,
  Loader2,
  AlertTriangle,
  Play,
  Info
} from 'lucide-react';
import { AppView, ChatMessage } from '../types';
import { api } from '../lib/api';

interface CopilotWorkspaceProps {
  onNavigate: (view: AppView) => void;
  chatHistory: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => void;
  onSetHistory?: (msgs: ChatMessage[]) => void;
  pageContext?: string;
}

export default function CopilotWorkspace({ onNavigate, chatHistory, onAddMessage, onSetHistory, pageContext }: CopilotWorkspaceProps) {
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [listeningTimer, setListeningTimer] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isLoading, isListening]);

  const fetchAiResponse = async (userText: string) => {
    setIsLoading(true);
    setStreamingText('');
    let acc = '';
    try {
      // Streamed Copilot — grounded strictly on the organization's live data (SSE).
      await api.stream('/ai/chat/stream', { prompt: userText, conversationId: conversationId ?? undefined, pageContext }, (evt) => {
        if (evt.delta) { acc += evt.delta; setStreamingText(acc); }
        else if (evt.done) {
          if (evt.conversationId) setConversationId(evt.conversationId);
          const sourceNote = evt.sources?.length ? `\n\nSources: ${evt.sources.map((s: any) => s.source).join(' · ')}` : '';
          const confidenceNote = typeof evt.confidence === 'number'
            ? `\n\n— ${evt.offline ? 'Direct data read' : `${evt.provider} · ${evt.model}`} · Confidence ${evt.confidence}%`
            : '';
          onAddMessage({
            id: Math.random().toString(),
            sender: 'assistant',
            text: acc + sourceNote + confidenceNote,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
          setStreamingText('');
        }
      });
    } catch (err) {
      onAddMessage({
        id: Math.random().toString(),
        sender: 'assistant',
        text: err instanceof Error
          ? `I couldn't reach the analysis service: ${err.message}. Please ensure the backend is running and you are signed in.`
          : 'The Copilot service is currently unavailable.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      setStreamingText('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = (textToSend?: string) => {
    const prompt = textToSend || input;
    if (!prompt.trim()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(),
      sender: 'user',
      text: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    onAddMessage(userMessage);
    if (!textToSend) setInput('');

    fetchAiResponse(prompt);
  };

  // ── Conversation history ──────────────────────────────────────
  const loadHistory = async () => {
    try {
      const res = await api.get<{ id: string; title: string }[]>('/ai/conversations');
      setHistory(res.data);
    } catch { /* ignore */ }
  };
  useEffect(() => { loadHistory(); }, []);

  const openConversation = async (id: string) => {
    setShowHistory(false);
    try {
      const res = await api.get<{ id: string; messages: { role: string; content: string; createdAt: string }[] }>(`/ai/conversations/${id}`);
      setConversationId(id);
      onSetHistory?.(res.data.messages.map((m, i) => ({
        id: `${id}-${i}`,
        sender: m.role === 'user' ? 'user' : 'assistant',
        text: m.content,
        timestamp: new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })));
    } catch { /* ignore */ }
  };

  const newChat = () => {
    setConversationId(null);
    setShowHistory(false);
    onSetHistory?.([{
      id: 'greeting',
      sender: 'assistant',
      text: "New conversation. Ask me about productivity, cost, schedule, inventory or compliance across your projects.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }]);
  };

  // Real voice input via the browser Web Speech API (Chrome/Edge). Falls back
  // gracefully with a notice when the API is unavailable.
  const handleMicClick = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      onAddMessage({
        id: Math.random().toString(),
        sender: 'assistant',
        text: 'Voice input requires a browser with the Web Speech API (Chrome or Edge). Please type your question instead.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    }

    if (isListening && listeningTimer) {
      listeningTimer.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript as string;
      setInput(transcript);
      handleSend(transcript);
      setInput('');
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    setListeningTimer(recognition);
    setIsListening(true);
    recognition.start();
  };

  const SUGGESTIONS: Record<string, string> = {
    'Productivity': 'Which activities or crews are underperforming on productivity, and why?',
    'Cost & EVM': 'Analyze cost variance and EVM (CPI/SPI/EAC) — are we trending over budget?',
    'Forecast Profit': 'What is the forecast profit and margin, and what is eroding it?',
    'Schedule Delays': 'Which activities are delaying the project and what is the completion outlook?',
    'Inventory': 'Which materials should we reorder and where is material waste highest?',
    'Compliance Risks': 'What are our biggest quality and safety risks right now?',
  };
  const handleSuggestionClick = (suggestion: string) => {
    handleSend(SUGGESTIONS[suggestion] ?? suggestion);
  };

  return (
    <div className="min-h-screen bg-brand-surface text-brand-on-surface font-sans flex flex-col h-screen overflow-hidden" id="copilot-workspace-root">
      {/* Top Header */}
      <header className="h-16 w-full bg-brand-surface-container-lowest/90 backdrop-blur-md flex justify-between items-center px-6 border-b border-brand-outline-variant/10 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <button 
            id="btn-copilot-back"
            onClick={() => onNavigate(AppView.DASHBOARD)}
            className="p-2 rounded-lg hover:bg-brand-surface transition-all text-brand-primary cursor-pointer flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="h-6 w-[1px] bg-brand-outline-variant/30"></div>
          
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center shadow-md">
              <Bot className="text-white w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-extrabold text-brand-primary">Inspecta AI Copilot</h2>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider">Analyzing: Skyline Tower A</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={newChat} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white bg-brand-primary font-bold text-xs hover:bg-brand-primary-container transition-all">
            <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New</span>
          </button>
          <div className="relative">
            <button onClick={() => { setShowHistory((s) => !s); loadHistory(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-primary font-bold text-xs hover:bg-brand-primary/5 transition-all border border-brand-primary/10">
              <Clock className="w-3.5 h-3.5" /> <span className="hidden sm:inline">History</span>
            </button>
            {showHistory && (
              <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto custom-scrollbar bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-xl z-50 py-1">
                {history.length === 0 ? <p className="px-4 py-3 text-xs text-brand-on-surface-variant">No past conversations.</p> : history.map((c) => (
                  <button key={c.id} onClick={() => openConversation(c.id)} className="w-full text-left px-4 py-2 text-xs hover:bg-brand-surface text-brand-on-surface truncate">{c.title}</button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onNavigate(AppView.DASHBOARD)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-primary font-bold text-xs hover:bg-brand-primary/5 transition-all"
          >
            <Layers className="w-4 h-4" />
            <span>ERP Console</span>
          </button>
        </div>
      </header>

      {/* Messages Canvas Log Area */}
      <main className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar space-y-6 bg-slate-50/50">
        <div className="max-w-2xl mx-auto space-y-6">
          {chatHistory.map((msg) => (
            <motion.div 
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Bot Avatar */}
              {msg.sender === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-brand-primary-container/10 border border-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0 self-start shadow-sm">
                  <Bot className="w-4.5 h-4.5" />
                </div>
              )}

              {/* Chat bubble body container */}
              <div className={`max-w-[85%] rounded-2xl p-4 relative ${
                msg.sender === 'user' 
                  ? 'bg-brand-primary text-white rounded-tr-none shadow-md' 
                  : 'bg-brand-surface-container-lowest text-brand-on-surface rounded-tl-none border border-brand-outline-variant/20 shadow-sm'
              }`}>
                {msg.sender === 'assistant' && (
                  <div className="ai-shimmer absolute inset-0 opacity-5 pointer-events-none rounded-2xl"></div>
                )}
                
                <p className="font-sans text-xs leading-relaxed font-semibold">
                  {msg.text}
                </p>

                {/* Sub-widget Renderer (e.g. detailed trend mini-bars) */}
                {msg.widgetData && (
                  <div className="mt-4 p-4 bg-brand-surface rounded-xl border border-brand-outline-variant/30 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-extrabold text-brand-primary uppercase tracking-wider flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5 text-brand-secondary-container" />
                        {msg.widgetData.caption}
                      </span>
                      <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                        msg.widgetData.trendType === 'critical' ? 'bg-red-50 text-brand-status-critical border border-red-100' :
                        msg.widgetData.trendType === 'warning' ? 'bg-amber-50 text-brand-status-warning border border-amber-100' :
                        'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}>
                        {msg.widgetData.trendValue}
                      </span>
                    </div>

                    {/* Simple Custom Bar Graph */}
                    <div className="h-16 flex items-end justify-between px-2 gap-2 pt-2 border-b border-brand-outline-variant/20">
                      {msg.widgetData.heights.map((h, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
                          <div 
                            className={`w-full rounded-t-sm transition-all duration-300 ${
                              h < 50 ? 'bg-brand-status-critical' :
                              h < 85 ? 'bg-brand-status-warning' :
                              'bg-brand-primary'
                            }`} 
                            style={{ height: `${(h / 120) * 100}%` }} 
                          />
                          <span className="text-[8px] font-mono font-bold text-brand-on-surface-variant">H{i+1}</span>
                          <div className="absolute bottom-full mb-1 bg-brand-primary text-white text-[8px] font-bold py-0.5 px-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap">
                            Index: {h/100}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2 items-start text-[10px] text-brand-on-surface-variant font-medium leading-relaxed">
                      <Info className="w-3.5 h-3.5 text-brand-primary shrink-0 mt-0.5" />
                      <p>Hour 4 and 5 drop caused by concrete logistics backup and sudden gale warning. Site rebounded at Hour 6.</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end mt-2">
                  <span className={`text-[8px] font-mono ${msg.sender === 'user' ? 'text-white/60' : 'text-brand-on-surface-variant/60'}`}>
                    {msg.timestamp}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}

          {/* AI Loader/Thinking state indicator */}
          {isLoading && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4 justify-start"
            >
              <div className="w-8 h-8 rounded-full bg-brand-primary-container/10 border border-brand-primary/10 flex items-center justify-center text-brand-primary shrink-0">
                <Bot className="w-4.5 h-4.5" />
              </div>
              <div className="bg-brand-surface-container-lowest text-brand-on-surface rounded-2xl rounded-tl-none border border-brand-outline-variant/20 shadow-sm p-4 max-w-xl">
                {streamingText ? (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{streamingText}<span className="inline-block w-1.5 h-3.5 bg-brand-primary/70 ml-0.5 align-middle animate-pulse" /></p>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="w-1.5 h-1.5 bg-brand-primary rounded-full animate-bounce [animation-delay:0.4s]"></span>
                    </div>
                    <span className="text-[11px] font-medium text-brand-on-surface-variant">Thinking... consulting construction files...</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Listening State Overlay/Visualizer */}
          {isListening && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-4 justify-end"
            >
              <div className="bg-brand-secondary-container/10 text-brand-on-secondary-container rounded-2xl rounded-tr-none border border-brand-secondary-container/20 shadow-sm p-4 flex flex-col items-center gap-2 max-w-[80%]">
                <div className="flex items-center gap-2 text-xs font-bold text-brand-secondary-container">
                  <Mic className="w-4 h-4 animate-pulse" />
                  <span>Listening... Speak construction query now</span>
                </div>
                <div className="flex items-end h-6 gap-0.5 px-4">
                  <div className="w-0.5 bg-brand-secondary-container h-2 animate-bounce"></div>
                  <div className="w-0.5 bg-brand-secondary-container h-5 animate-bounce [animation-delay:0.1s]"></div>
                  <div className="w-0.5 bg-brand-secondary-container h-3 animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-0.5 bg-brand-secondary-container h-6 animate-bounce [animation-delay:0.3s]"></div>
                  <div className="w-0.5 bg-brand-secondary-container h-4 animate-bounce [animation-delay:0.4s]"></div>
                  <div className="w-0.5 bg-brand-secondary-container h-1 animate-bounce [animation-delay:0.5s]"></div>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Floating Prompt Suggestion Chips & Bottom Chat Input */}
      <footer className="bg-brand-surface-container-lowest border-t border-brand-outline-variant/10 p-4 shrink-0">
        <div className="max-w-2xl mx-auto space-y-3">
          
          {/* Quick chip triggers */}
          <div className="flex flex-wrap gap-2 justify-center">
            {['Productivity', 'Cost & EVM', 'Forecast Profit', 'Schedule Delays', 'Inventory', 'Compliance Risks'].map((chip) => (
              <button 
                key={chip}
                id={`chip-${chip.toLowerCase().replace(' ', '-')}`}
                onClick={() => handleSuggestionClick(chip)}
                className="px-3 py-1.5 rounded-full border border-brand-primary/10 hover:border-brand-primary bg-brand-surface text-brand-primary text-[10px] font-bold tracking-tight transition-all cursor-pointer flex items-center gap-1 hover:bg-brand-primary/5 shadow-sm"
              >
                <Brain className="w-3 h-3 text-brand-secondary-container" />
                <span>{chip}</span>
              </button>
            ))}
          </div>

          {/* Interactive Chat Input form */}
          <div className="flex items-center gap-3">
            <button 
              id="btn-copilot-mic"
              onClick={handleMicClick}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-md ${
                isListening 
                  ? 'bg-brand-status-critical text-white animate-pulse shadow-red-500/15' 
                  : 'bg-brand-secondary-container/10 text-brand-secondary-container border border-brand-secondary-container/10 hover:bg-brand-secondary-container/20'
              }`}
            >
              <Mic className="w-4.5 h-4.5" />
            </button>
            
            <div className="relative flex-1">
              <input 
                id="copilot-input-field"
                type="text"
                placeholder="Ask Copilot about delays, schedules, or safety audits..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                className="w-full h-11 bg-brand-surface border border-brand-outline-variant/30 rounded-xl px-4 pr-11 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/5 text-brand-on-surface"
              />
              <button 
                id="btn-copilot-send"
                onClick={() => handleSend()}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-primary hover:text-brand-secondary-container transition-colors cursor-pointer"
              >
                <Send className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
