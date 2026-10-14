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
  Info,
  Paperclip,
  X
} from 'lucide-react';
import { AppView, ChatMessage, CopilotField, CopilotPreview } from '../types';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { useChat } from '../lib/chat';
import Markdown from './Markdown';

interface GuidedResult {
  text?: string;
  field?: CopilotField;
  preview?: CopilotPreview;
  created?: { entity: string; id?: string; fields: Record<string, unknown> };
  error?: string;
}

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const rid = () => Math.random().toString(36).slice(2);

/** A single guided-create input (text / number / date / select + "add new"). */
function CreateFieldWidget({ field, disabled, onSubmit }: {
  field: CopilotField;
  disabled: boolean;
  onSubmit: (field: CopilotField, value: string, action: 'value' | 'skip' | 'addNew') => void;
}) {
  const [val, setVal] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const submit = () => {
    if (adding) { if (newName.trim()) onSubmit(field, newName.trim(), 'addNew'); return; }
    if (field.required && !String(val).trim()) return;
    onSubmit(field, val, 'value');
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-brand-outline-variant/40 bg-brand-surface text-xs outline-none focus:border-brand-primary';
  return (
    <div className="mt-3 p-3 rounded-xl border border-brand-primary/15 bg-brand-primary/5 space-y-2">
      <label className="block text-[11px] font-bold text-brand-primary">
        {field.label}{field.required && <span className="text-brand-status-critical"> *</span>}
      </label>

      {field.type === 'select' && !adding && (
        <select
          className={inputCls}
          value={val}
          disabled={disabled}
          onChange={(e) => { if (e.target.value === '__add__') { setAdding(true); setVal(''); } else setVal(e.target.value); }}
        >
          <option value="">Select…</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {field.allowAdd && <option value="__add__">➕ {field.addLabel ?? 'Add new'}</option>}
        </select>
      )}
      {adding && (
        <input className={inputCls} autoFocus placeholder={`New ${field.label.toLowerCase()} name`} value={newName} disabled={disabled} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      )}
      {field.type === 'text' && <input className={inputCls} autoFocus value={val} disabled={disabled} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />}
      {field.type === 'number' && <input className={inputCls} type="number" autoFocus value={val} disabled={disabled} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />}
      {field.type === 'date' && <input className={inputCls} type="date" value={val} disabled={disabled} onChange={(e) => setVal(e.target.value)} />}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={submit} disabled={disabled} className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-[11px] font-bold hover:bg-brand-primary-container disabled:opacity-50">
          {adding ? 'Add & continue' : 'Next'}
        </button>
        {!field.required && !adding && (
          <button onClick={() => onSubmit(field, '', 'skip')} disabled={disabled} className="px-3 py-1.5 rounded-lg text-brand-on-surface-variant text-[11px] font-bold hover:bg-brand-surface disabled:opacity-50">Skip</button>
        )}
        {adding && (
          <button onClick={() => { setAdding(false); setNewName(''); }} disabled={disabled} className="px-3 py-1.5 rounded-lg text-brand-on-surface-variant text-[11px] font-bold hover:bg-brand-surface">Back</button>
        )}
      </div>
    </div>
  );
}

/** The final preview card with Create / Cancel actions. */
function CreatePreviewCard({ preview, disabled, onCreate, onCancel }: {
  preview: CopilotPreview;
  disabled: boolean;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 p-3 rounded-xl border border-brand-secondary-container/30 bg-brand-secondary-container/5 space-y-2">
      <p className="text-[11px] font-bold text-brand-primary uppercase tracking-wide">New {preview.title} — review</p>
      <div className="space-y-1">
        {Object.entries(preview.fields).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-[11px]">
            <span className="text-brand-on-surface-variant capitalize">{k.replace(/Id$/, '')}</span>
            <span className="font-semibold text-brand-on-surface text-right break-all">{String(v)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCreate} disabled={disabled} className="px-3 py-1.5 rounded-lg bg-brand-primary text-white text-[11px] font-bold hover:bg-brand-primary-container disabled:opacity-50">Create</button>
        <button onClick={onCancel} disabled={disabled} className="px-3 py-1.5 rounded-lg text-brand-on-surface-variant text-[11px] font-bold hover:bg-brand-surface disabled:opacity-50">Cancel</button>
      </div>
    </div>
  );
}

interface CopilotWorkspaceProps {
  onNavigate: (view: AppView) => void;
  chatHistory: ChatMessage[];
  onAddMessage: (msg: ChatMessage) => void;
  onSetHistory?: (msgs: ChatMessage[]) => void;
  pageContext?: string;
  /** `panel` = compact floating window (no page chrome); default is the full page. */
  variant?: 'page' | 'panel';
  onClose?: () => void;
}

/** A file/voice clip queued on the composer, sent as base64 with the next message. */
interface PendingAttachment { filename: string; mime: string; data: string; }

const MAX_ATTACH_BYTES = 4 * 1024 * 1024; // keeps a message (base64 inflates ~33%) under the API's ~10 MB request limit
const MAX_ATTACHMENTS = 6;

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split('base64,')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function CopilotWorkspace({ onNavigate, chatHistory, onAddMessage, onSetHistory, pageContext, variant = 'page', onClose }: CopilotWorkspaceProps) {
  const panel = variant === 'panel';
  const [input, setInput] = useState('');
  const { conversationId, setConversationId } = useChat();
  const routerNavigate = useNavigate();
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [listeningTimer, setListeningTimer] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [credits, setCredits] = useState<{ balance: number; monthlyAllowance: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const notice = (text: string) =>
    onAddMessage({ id: Math.random().toString(), sender: 'assistant', text, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: PendingAttachment[] = [];
    for (const f of Array.from(files)) {
      if (pending.length + next.length >= MAX_ATTACHMENTS) { notice(`You can attach up to ${MAX_ATTACHMENTS} files per message.`); break; }
      if (f.size > MAX_ATTACH_BYTES) { notice(`"${f.name}" is larger than 4 MB — please attach a smaller file.`); continue; }
      next.push({ filename: f.name, mime: f.type, data: await fileToBase64(f) });
    }
    if (next.length) setPending((p) => [...p, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadCredits = () => {
    api.get<{ balance: number; monthlyAllowance: number }>('/ai/credits')
      .then((res) => setCredits(res.data))
      .catch(() => { /* meter is a nice-to-have, not worth erroring the chat over */ });
  };
  useEffect(() => { loadCredits(); }, []);

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory, isLoading, isListening]);

  const fetchAiResponse = async (userText: string, attachments: PendingAttachment[] = []) => {
    setIsLoading(true);
    setStreamingText('');
    let acc = '';
    try {
      // Streamed Copilot — grounded strictly on the organization's live data (SSE).
      await api.stream('/ai/chat/stream', { prompt: userText, conversationId: conversationId ?? undefined, pageContext, attachments: attachments.length ? attachments : undefined }, (evt) => {
        if (evt.transcript && attachments.some((a) => a.mime.startsWith('audio/'))) {
          onAddMessage({ id: Math.random().toString(), sender: 'user', text: `🎤 “${evt.transcript}”`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        }
        if (evt.delta) { acc += evt.delta; setStreamingText(acc); }
        else if (evt.done) {
          if (evt.conversationId) setConversationId(evt.conversationId);
          // A guided-create widget/preview suppresses the source/confidence footer.
          const guided = evt.field || evt.preview;
          const sourceNote = !guided && evt.sources?.length ? `\n\nSources: ${evt.sources.map((s: any) => s.source).join(' · ')}` : '';
          const confidenceNote = !guided && typeof evt.confidence === 'number'
            ? `\n\n— ${evt.offline ? 'Direct data read' : `${evt.provider} · ${evt.model}`} · Confidence ${evt.confidence}%`
            : '';
          onAddMessage({
            id: Math.random().toString(),
            sender: 'assistant',
            text: acc + sourceNote + confidenceNote,
            field: evt.field,
            preview: evt.preview,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
          setStreamingText('');
          loadCredits();
          // The agent opened a page for the user (open_page tool).
          if (typeof evt.navigateTo === 'string' && evt.navigateTo.startsWith('/')) routerNavigate(evt.navigateTo);
        }
      });
    } catch (err) {
      onAddMessage({
        id: Math.random().toString(),
        sender: 'assistant',
        text: err instanceof Error && /inspect mode/i.test(err.message)
          ? "The Copilot is switched off while you're inspecting another company's workspace (inspect mode is read-only). Exit inspect mode from the platform console to chat with the Copilot in your own workspace."
          : err instanceof Error
          ? `I couldn't reach the analysis service: ${err.message}. Please ensure the backend is running and you are signed in.`
          : 'The Copilot service is currently unavailable.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      setStreamingText('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = (textToSend?: string, extra?: PendingAttachment[]) => {
    const prompt = textToSend || input;
    const attachments = [...(extra ?? []), ...(textToSend ? [] : pending)];
    if (!prompt.trim() && !attachments.length) return;

    const voiceOnly = attachments.length > 0 && attachments.every((a) => a.mime.startsWith('audio/')) && !prompt.trim();
    const names = attachments.filter((a) => !a.mime.startsWith('audio/')).map((a) => `📎 ${a.filename}`);
    // A voice-only message is echoed once the server returns the transcript.
    if (!voiceOnly) {
      onAddMessage({
        id: Math.random().toString(),
        sender: 'user',
        text: [prompt.trim(), ...names].filter(Boolean).join('\n'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
    if (!textToSend) { setInput(''); setPending([]); }

    fetchAiResponse(prompt.trim(), attachments);
  };

  // ── Guided create: submit a field value / skip / add-new ──────
  const submitField = async (field: CopilotField, rawValue: string, action: 'value' | 'skip' | 'addNew') => {
    if (!conversationId) return;
    const display = action === 'skip'
      ? 'Skipped'
      : action === 'addNew'
        ? `New: ${rawValue}`
        : field.type === 'select'
          ? (field.options?.find((o) => o.value === rawValue)?.label ?? rawValue ?? '—')
          : (rawValue || '—');
    onAddMessage({ id: rid(), sender: 'user', text: `${field.label}: ${display}`, timestamp: nowTime() });
    setIsLoading(true);
    try {
      const res = await api.post<GuidedResult>('/ai/create/answer', { conversationId, name: field.name, value: rawValue, action });
      const d = res.data;
      onAddMessage({
        id: rid(),
        sender: 'assistant',
        text: d.error ? `⚠️ ${d.error}` : (d.text ?? (d.preview ? 'Here’s the summary — review and create:' : '')),
        field: d.field,
        preview: d.preview,
        timestamp: nowTime(),
      });
    } catch (e) {
      onAddMessage({ id: rid(), sender: 'assistant', text: e instanceof Error ? `Couldn’t save that: ${e.message}` : 'Something went wrong.', timestamp: nowTime() });
    } finally {
      setIsLoading(false);
    }
  };

  const commitPreview = async () => {
    if (!conversationId) return;
    onAddMessage({ id: rid(), sender: 'user', text: 'Create it', timestamp: nowTime() });
    setIsLoading(true);
    try {
      const res = await api.post<GuidedResult>('/ai/create/commit', { conversationId });
      const d = res.data;
      const text = d.created
        ? `✅ Created ${d.created.entity.replace('_', ' ')}${d.created.id ? ` (${d.created.id})` : ''}.\n` +
          Object.entries(d.created.fields).map(([k, v]) => `• ${k.replace(/Id$/, '')}: ${v}`).join('\n')
        : d.error ? `⚠️ ${d.error}` : 'Done.';
      onAddMessage({ id: rid(), sender: 'assistant', text, timestamp: nowTime() });
    } catch (e) {
      onAddMessage({ id: rid(), sender: 'assistant', text: e instanceof Error ? `Couldn’t create it: ${e.message}` : 'Something went wrong.', timestamp: nowTime() });
    } finally {
      setIsLoading(false);
    }
  };

  const cancelPreview = async () => {
    if (!conversationId) return;
    setIsLoading(true);
    try {
      await api.post('/ai/create/cancel', { conversationId });
      onAddMessage({ id: rid(), sender: 'assistant', text: 'Okay, cancelled — nothing was created.', timestamp: nowTime() });
    } catch { /* ignore */ } finally {
      setIsLoading(false);
    }
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

  // Voice: record with the microphone and send the clip to the Copilot, which
  // transcribes it server-side (works in every modern browser). Falls back to the
  // browser's Web Speech API where recording isn't available.
  const handleMicClick = async () => {
    if (isListening && recorderRef.current) {
      recorderRef.current.stop(); // onstop sends the clip
      return;
    }
    if (!isListening && typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          recorderRef.current = null;
          setIsListening(false);
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (blob.size > MAX_ATTACH_BYTES) { notice('That recording is too long (about 2 minutes max). Please record a shorter message.'); return; }
          if (blob.size < 800) return; // nothing captured
          const mime = (blob.type || 'audio/webm').split(';')[0];
          handleSend(undefined, [{ filename: `voice.${mime.split('/')[1] || 'webm'}`, mime, data: await fileToBase64(blob) }]);
        };
        recorderRef.current = rec;
        rec.start();
        setIsListening(true);
        // Safety stop at ~2 minutes (the transcription limit).
        setTimeout(() => { if (recorderRef.current === rec && rec.state === 'recording') rec.stop(); }, 115_000);
        return;
      } catch {
        notice('I could not access the microphone. Allow microphone access in your browser, or type your question instead.');
        return;
      }
    }

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
    <div className={panel ? "bg-brand-surface-container-low text-brand-on-surface font-sans flex flex-col flex-1 min-h-0 h-full overflow-hidden" : "min-h-screen bg-brand-surface text-brand-on-surface font-sans flex flex-col h-screen overflow-hidden"} id={panel ? "copilot-panel-root" : "copilot-workspace-root"}>
      {/* Top Header */}
      <header className={`${panel ? 'h-12 px-3' : 'h-16 px-6'} w-full bg-brand-surface-container-lowest/90 backdrop-blur-md flex justify-between items-center border-b border-brand-outline-variant/10 shadow-sm shrink-0`}>
        <div className="flex items-center gap-3">
          {!panel && (<>
          <button 
            id="btn-copilot-back"
            onClick={() => onNavigate(AppView.DASHBOARD)}
            className="p-2 rounded-lg hover:bg-brand-surface transition-all text-brand-primary cursor-pointer flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="h-6 w-[1px] bg-brand-outline-variant/30"></div>
          </>)}
          
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center shadow-md">
              <Bot className="text-white w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="font-display text-sm font-extrabold text-brand-primary whitespace-nowrap">{panel ? 'Inspecta AI' : 'Inspecta AI Copilot'}</h2>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider whitespace-nowrap">{panel ? 'Live data' : 'Grounded on your live data'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {credits && (
            <button
              onClick={() => onNavigate(AppView.BILLING)}
              title={`${credits.balance.toLocaleString()} of ${credits.monthlyAllowance.toLocaleString()} monthly AI credits remaining`}
              className={`${panel ? 'flex' : 'hidden md:flex'} items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                credits.balance <= 0
                  ? 'border-brand-status-critical/30 text-brand-status-critical hover:bg-brand-status-critical/5'
                  : 'border-brand-primary/10 text-brand-primary hover:bg-brand-primary/5'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> <span className="whitespace-nowrap">{credits.balance.toLocaleString()}{panel ? '' : ' credits'}</span>
            </button>
          )}
          <button onClick={newChat} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white bg-brand-primary font-bold text-xs hover:bg-brand-primary-container transition-all">
            <Plus className="w-3.5 h-3.5" /> {!panel && <span className="hidden sm:inline">New</span>}
          </button>
          <div className="relative">
            <button onClick={() => { setShowHistory((s) => !s); loadHistory(); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-primary font-bold text-xs hover:bg-brand-primary/5 transition-all border border-brand-primary/10">
              <Clock className="w-3.5 h-3.5" /> {!panel && <span className="hidden sm:inline">History</span>}
            </button>
            {showHistory && (
              <div className="absolute right-0 mt-2 w-72 max-h-80 overflow-y-auto custom-scrollbar bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 shadow-xl z-50 py-1">
                {history.length === 0 ? <p className="px-4 py-3 text-xs text-brand-on-surface-variant">No past conversations.</p> : history.map((c) => (
                  <button key={c.id} onClick={() => openConversation(c.id)} className="w-full text-left px-4 py-2 text-xs hover:bg-brand-surface text-brand-on-surface truncate">{c.title}</button>
                ))}
              </div>
            )}
          </div>
          {panel ? (
            <>
              <button onClick={() => onNavigate(AppView.COPILOT)} title="Open full page" aria-label="Open full page" className="p-1.5 rounded-lg text-brand-primary hover:bg-brand-primary/5"><Globe className="w-4 h-4" /></button>
              <button onClick={onClose} title="Close" aria-label="Close Copilot" className="p-1.5 rounded-lg text-brand-primary hover:bg-brand-primary/5"><X className="w-4 h-4" /></button>
            </>
          ) : (
          <button
            onClick={() => onNavigate(AppView.DASHBOARD)}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-brand-primary font-bold text-xs hover:bg-brand-primary/5 transition-all"
          >
            <Layers className="w-4 h-4" />
            <span>ERP Console</span>
          </button>
          )}
        </div>
      </header>

      {/* Messages Canvas Log Area */}
      <main className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-6 bg-brand-surface-container-low ${panel ? 'px-3 py-4' : 'px-6 py-6'}`}>
        <div className={`mx-auto space-y-6 ${panel ? '' : 'max-w-2xl'}`}>
          {chatHistory.map((msg, idx) => { const isLast = idx === chatHistory.length - 1; return (
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
                
                {msg.sender === 'assistant' ? (
                  <Markdown>{msg.text}</Markdown>
                ) : (
                  <p className="font-sans text-xs leading-relaxed font-semibold whitespace-pre-wrap">{msg.text}</p>
                )}

                {/* Guided-create widgets (only interactive on the latest message). */}
                {msg.field && isLast && <CreateFieldWidget field={msg.field} disabled={isLoading} onSubmit={submitField} />}
                {msg.preview && isLast && <CreatePreviewCard preview={msg.preview} disabled={isLoading} onCreate={commitPreview} onCancel={cancelPreview} />}

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
          ); })}

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
                  <div><Markdown>{streamingText}</Markdown><span className="inline-block w-1.5 h-3.5 bg-brand-primary/70 ml-0.5 align-middle animate-pulse" /></div>
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
      <footer className={`bg-brand-surface-container-lowest border-t border-brand-outline-variant/30 shrink-0 ${panel ? 'p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]' : 'p-4'}`}>
        <div className={`mx-auto space-y-3 ${panel ? '' : 'max-w-2xl'}`}>
          
          {/* Quick chip triggers */}
          <div className={panel ? "flex gap-2 overflow-x-auto pb-1 custom-scrollbar" : "flex flex-wrap gap-2 justify-center"}>
            {['Productivity', 'Cost & EVM', 'Forecast Profit', 'Schedule Delays', 'Inventory', 'Compliance Risks'].map((chip) => (
              <button 
                key={chip}
                id={`chip-${chip.toLowerCase().replace(' ', '-')}`}
                onClick={() => handleSuggestionClick(chip)}
                className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full border border-brand-primary/10 hover:border-brand-primary bg-brand-surface text-brand-primary text-[10px] font-bold tracking-tight transition-all cursor-pointer flex items-center gap-1 hover:bg-brand-primary/5 shadow-sm"
              >
                <Brain className="w-3 h-3 text-brand-secondary-container" />
                <span>{chip}</span>
              </button>
            ))}
          </div>

          {/* Queued attachments */}
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pending.map((a, i) => (
                <span key={`${a.filename}-${i}`} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-brand-surface border border-brand-outline-variant/30 text-[10px] font-semibold text-brand-on-surface">
                  <Paperclip className="w-3 h-3 text-brand-secondary-container" />
                  <span className="max-w-[160px] truncate">{a.filename}</span>
                  <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${a.filename}`} className="cursor-pointer text-brand-on-surface/50 hover:text-brand-status-critical">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Interactive Chat Input form */}
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.json,.xml,.html"
              onChange={(e) => void addFiles(e.target.files)}
            />
            <button
              id="btn-copilot-attach"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a document or image"
              title="Attach a document or image"
              className="w-11 h-11 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer bg-brand-secondary-container/10 text-brand-secondary-container border border-brand-secondary-container/10 hover:bg-brand-secondary-container/20"
            >
              <Paperclip className="w-4.5 h-4.5" />
            </button>
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
                className="w-full h-11 bg-brand-surface-container border border-brand-outline-variant/40 rounded-xl px-4 pr-11 text-xs font-semibold outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/5 text-brand-on-surface"
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
