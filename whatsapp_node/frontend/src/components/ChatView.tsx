import React, { useRef, useEffect } from 'react';
import { CircleDot, Sparkles, RefreshCw, BrainCircuit, Eraser, Send, MessageSquare, Ghost } from 'lucide-react';
import { Chat, Message } from '../types';
import { MessageBubble } from './MessageBubble';

interface ChatViewProps {
  selectedChat: Chat | null;
  messages: Message[];
  presenceMap: Record<string, string>;
  intent: string | null;
  inputText: string;
  setInputText: (t: string) => void;
  steerText: string;
  setSteerText: (t: string) => void;
  isAiLoading: boolean;
  onSendMessage: () => void;
  onAiDraft: () => void;
  onModifyChat: (action: 'archive' | 'pin' | 'delete') => void;
  onToggleEphemeral: (enabled: boolean) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  selectedChat,
  messages,
  presenceMap,
  intent,
  inputText,
  setInputText,
  steerText,
  setSteerText,
  isAiLoading,
  onSendMessage,
  onAiDraft,
  onModifyChat,
  onToggleEphemeral
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };
  
  useEffect(() => { scrollToBottom(); }, [messages]);

  if (!selectedChat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] flex-col gap-8 animate-in fade-in duration-700">
        <div className="relative">
          <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center shadow-2xl border-8 border-slate-50/50 relative z-10"><MessageSquare size={80} className="text-slate-200" /></div>
          <div className="absolute inset-0 bg-teal-500/10 blur-3xl rounded-full scale-150"></div>
        </div>
        <div className="text-center relative z-10 px-10">
          <h2 className="text-3xl font-black text-slate-700 mb-3 tracking-tighter uppercase">Select a Conversation</h2>
          <p className="text-slate-400 text-sm max-w-xs mx-auto font-medium leading-relaxed italic">Choose a chat to start messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative shadow-2xl min-w-0">
      <header className="p-4 bg-slate-50 border-b flex justify-between items-center shadow-sm z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center shadow-inner text-slate-500 relative">
            <CircleDot size={24} />
            {selectedChat.ephemeral_mode === 1 && <div className="absolute -bottom-1 -right-1 bg-slate-800 text-white p-0.5 rounded-full border border-white"><Ghost size={10} /></div>}
          </div>
          <div>
            <h3 className="font-bold leading-tight text-slate-800 flex items-center gap-2">
                {selectedChat.name}
                {selectedChat.ephemeral_mode === 1 && <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase tracking-widest">Ephemeral: {selectedChat.ephemeral_timer}m</span>}
            </h3>
            {presenceMap[selectedChat.jid] ? (
              <span className="text-[10px] text-teal-600 font-bold animate-pulse uppercase">{presenceMap[selectedChat.jid]}...</span>
            ) : (
              intent && <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold uppercase">Intent: {intent}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <button 
            onClick={() => onToggleEphemeral(!selectedChat.ephemeral_mode)} 
            className={`p-2 rounded-lg hover:bg-slate-100 transition-all ${selectedChat.ephemeral_mode === 1 ? 'text-purple-600 bg-purple-50' : 'hover:text-purple-500'}`} 
            title={selectedChat.ephemeral_mode === 1 ? "Disable Ephemeral Mode" : "Enable Ephemeral Mode (60m)"}
          >
            <Ghost size={20} />
          </button>
          <div className="w-px h-6 bg-slate-200 mx-1"></div>
          <button onClick={() => onModifyChat('pin')} className={`p-2 rounded-lg hover:bg-slate-100 ${selectedChat.is_pinned ? 'text-teal-600' : ''}`} title="Pin Chat">Pin</button>
          <button onClick={() => onModifyChat('archive')} className="p-2 rounded-lg hover:bg-slate-100" title="Archive Chat">Archive</button>
          <button onClick={() => onModifyChat('delete')} className="p-2 rounded-lg hover:bg-red-50 hover:text-red-500" title="Delete Chat">Delete</button>
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto p-6 flex flex-col bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] relative">
        {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
        <div ref={messagesEndRef} />
      </div>
      
      <footer className="p-3 bg-slate-100 border-t flex flex-col gap-2 z-10">
        <div className="flex gap-2 items-center bg-white/80 backdrop-blur p-1.5 px-3 rounded-xl border border-slate-200/60 shadow-sm">
          <Sparkles size={14} className="text-teal-600 shrink-0" />
          <input value={steerText} onChange={(e) => setSteerText(e.target.value)} placeholder="AI Instruction..." className="flex-1 bg-transparent text-[11px] outline-none font-bold italic" />
          <button disabled={isAiLoading} onClick={onAiDraft} className="text-[10px] bg-teal-600 text-white px-4 py-1.5 rounded-lg font-black tracking-widest uppercase shadow-sm">
            {isAiLoading ? <RefreshCw size={10} className="spin" /> : <BrainCircuit size={12} />} GENERATE
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setInputText('')} className="p-2.5 text-slate-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-xl"><Eraser size={22} /></button>
          <div className="flex-1 bg-white rounded-2xl flex items-center px-5 py-2.5 border border-slate-200 shadow-inner focus-within:ring-4 ring-teal-500/10 transition-all">
            <textarea 
              value={inputText} 
              onChange={(e) => setInputText(e.target.value)} 
              placeholder="Type a message..." 
              className="flex-1 outline-none resize-none max-h-32 text-[15px] py-1 bg-transparent leading-normal" 
              rows={1} 
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), onSendMessage())} 
            />
          </div>
          <button onClick={onSendMessage} className="bg-teal-600 text-white p-3.5 rounded-2xl hover:bg-teal-700 shadow-xl active:scale-90"><Send size={22} /></button>
        </div>
      </footer>
    </div>
  );
};
