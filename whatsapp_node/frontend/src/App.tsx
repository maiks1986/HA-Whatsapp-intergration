import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { 
  Send, 
  Plus, 
  User, 
  Sparkles, 
  RefreshCw, 
  CircleDot,
  Search,
  MoreVertical,
  X,
  Settings,
  BrainCircuit,
  Eraser,
  Lock
} from 'lucide-react';

// Configure Axios to use the token if available
const updateAxiosAuth = (token: string | null) => {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
};

const socket = io();

interface Instance {
  id: number;
  name: string;
  status: string;
  qr?: string | null;
}

interface Message {
  id: number;
  sender_name: string;
  chat_jid: string;
  text: string;
  timestamp: string;
  is_from_me: number;
}

const App = () => {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [password, setPassword] = useState('');
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [steerText, setSteerText] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [isAddingInstance, setIsAddingInstance] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [newInstanceName, setNewInstanceName] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const localToken = localStorage.getItem('direct_token');
    updateAxiosAuth(localToken);

    try {
      const res = await axios.get('/api/auth/status');
      if (res.data.authenticated) {
        setAuthState('authenticated');
        fetchInstances();
        fetchGeminiKey();
      } else {
        setAuthState('unauthenticated');
      }
    } catch (e) {
      setAuthState('unauthenticated');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/auth/login', { password });
      localStorage.setItem('direct_token', res.data.token);
      updateAxiosAuth(res.data.token);
      setAuthState('authenticated');
      fetchInstances();
      fetchGeminiKey();
    } catch (err) {
      alert("Invalid Password");
    }
  };

  useEffect(() => {
    if (authState !== 'authenticated') return;

    socket.on('instances_status', (statusUpdates: any[]) => {
      setInstances(prev => prev.map(inst => {
        const update = statusUpdates.find(u => u.id === inst.id);
        return update ? { ...inst, status: update.status, qr: update.qr } : inst;
      }));
    });

    return () => {
      socket.off('instances_status');
    };
  }, [authState]);

  useEffect(() => {
    if (selectedInstance && selectedInstance.status === 'connected') {
      fetchMessages(selectedInstance.id, '31657349267@s.whatsapp.net'); 
    } else {
      setMessages([]);
      setIntent(null);
    }
  }, [selectedInstance]);

  const fetchInstances = async () => {
    const res = await axios.get('/api/instances');
    setInstances(res.data);
    if (res.data.length > 0 && !selectedInstance) {
      setSelectedInstance(res.data[0]);
    }
  };

  const fetchGeminiKey = async () => {
    const res = await axios.get('/api/settings/gemini_api_key');
    setGeminiKey(res.data.value);
  };

  const handleSaveSettings = async () => {
    await axios.post('/api/settings', { key: 'gemini_api_key', value: geminiKey });
    setIsSettingsOpen(false);
  };

  const fetchMessages = async (instanceId: number, jid: string) => {
    const res = await axios.get(`/api/messages/${instanceId}/${jid}`);
    setMessages(res.data);
    scrollToBottom();
    if (res.data.length > 0) analyzeIntent(res.data);
  };

  const analyzeIntent = async (msgs: Message[]) => {
    try {
      const res = await axios.post('/api/ai/analyze', { messages: msgs.slice(-20) });
      setIntent(res.data.intent);
    } catch (e) {}
  };

  const handleAiDraft = async () => {
    if (messages.length === 0) return;
    setIsAiLoading(true);
    try {
      const res = await axios.post('/api/ai/draft', { 
        messages: messages.slice(-10),
        steer: steerText 
      });
      setInputText(res.data.draft);
    } catch (e) {
      alert("AI Service unavailable. Check your API key in Settings.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName) return;
    await axios.post('/api/instances', { name: newInstanceName });
    setNewInstanceName('');
    setIsAddingInstance(false);
    fetchInstances();
  };

  const handleSendMessage = async () => {
    if (!inputText || !selectedInstance) return;
    try {
      await axios.post('/api/send_message', {
        instanceId: selectedInstance.id,
        contact: '31657349267',
        message: inputText
      });
      setInputText('');
      setSteerText('');
      fetchMessages(selectedInstance.id, '31657349267@s.whatsapp.net');
    } catch (e) {
      alert("Failed to send");
    }
  };

  if (authState === 'loading') {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg">
        <RefreshCw size={48} className="text-teal-600 spin" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg">
        <form onSubmit={handleLogin} className="bg-white p-10 rounded-2xl shadow-2xl w-[400px] text-center border-t-8 border-teal-600">
          <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock size={32} className="text-teal-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">WhatsApp Pro</h1>
          <p className="text-sm text-slate-500 mb-8 font-medium">Enter your direct access password</p>
          <input 
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all mb-6 text-center"
          />
          <button 
            type="submit"
            className="w-full bg-teal-600 text-white p-4 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98]"
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-whatsapp-bg overflow-hidden text-slate-800">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 bg-slate-50 flex justify-between items-center border-b shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center">
              <User size={20} className="text-slate-600" />
            </div>
            <h2 className="font-bold tracking-tight">Accounts</h2>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
              <Settings size={20} />
            </button>
            <button onClick={() => setIsAddingInstance(true)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-teal-600">
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {instances.map(inst => (
            <div 
              key={inst.id}
              onClick={() => setSelectedInstance(inst)}
              className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 transition-all ${selectedInstance?.id === inst.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              <div className="relative">
                <div className="w-12 h-12 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
                  {inst.name[0].toUpperCase()}
                </div>
                <div className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${inst.status === 'connected' ? 'bg-green-500' : 'bg-slate-400'}`}></div>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="font-semibold truncate text-slate-700">{inst.name}</div>
                <div className="text-xs text-slate-500 truncate font-medium uppercase tracking-wider">{inst.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative shadow-2xl">
        {selectedInstance ? (
          <>
            <header className="p-4 bg-slate-50 border-b flex justify-between items-center shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center overflow-hidden shadow-inner">
                  <CircleDot size={24} className="text-slate-500" />
                </div>
                <div>
                  <h3 className="font-bold leading-tight text-slate-800">{selectedInstance.name}</h3>
                  {intent && <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">Intent: {intent}</span>}
                </div>
              </div>
              <div className="flex items-center gap-4 text-slate-400">
                <Search size={20} className="cursor-pointer hover:text-slate-600 transition-colors" />
                <MoreVertical size={20} className="cursor-pointer hover:text-slate-600 transition-colors" />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2 bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat relative">
              {selectedInstance.status === 'qr_ready' && selectedInstance.qr && (
                <div className="bg-white p-8 rounded-2xl shadow-2xl mx-auto my-10 text-center max-w-sm border-t-8 border-teal-600 animate-in zoom-in-95 duration-300">
                  <h2 className="text-2xl font-extrabold mb-2 text-slate-800 tracking-tight">Link Device</h2>
                  <p className="text-sm text-slate-500 mb-8 font-medium leading-relaxed">Scan the QR code with your phone's WhatsApp Linked Devices menu.</p>
                  <div className="p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 shadow-inner inline-block">
                    <img src={selectedInstance.qr} className="w-64 h-64 mix-blend-multiply" />
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div 
                  key={m.id} 
                  className={`max-w-[75%] p-2 px-3 rounded-xl shadow-sm text-sm relative animate-in fade-in slide-in-from-bottom-1 duration-200 ${m.is_from_me ? 'bg-whatsapp-bubble self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'}`}
                >
                  <div className="leading-relaxed whitespace-pre-wrap text-slate-800">{m.text}</div>
                  <div className="text-[9px] text-slate-400 text-right mt-1 font-bold uppercase tracking-widest">{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <footer className="p-3 bg-slate-100 border-t flex flex-col gap-2 shadow-[0_-4px_15px_rgba(0,0,0,0.03)] relative z-10">
              <div className="flex gap-2 items-center bg-white/80 backdrop-blur p-1.5 px-3 rounded-xl border border-slate-200/60 shadow-sm">
                <Sparkles size={14} className="text-teal-600 shrink-0" />
                <input 
                  value={steerText}
                  onChange={(e) => setSteerText(e.target.value)}
                  placeholder="Draft AI: 'Ask for a discount', 'Translate to Spanish'..."
                  className="flex-1 bg-transparent text-[11px] outline-none p-1 font-bold italic text-slate-600 placeholder:text-slate-300"
                />
                <button 
                  disabled={isAiLoading}
                  onClick={handleAiDraft}
                  className="text-[10px] bg-teal-600 text-white px-4 py-1.5 rounded-lg font-black tracking-widest hover:bg-teal-700 disabled:bg-slate-300 transition-all flex items-center gap-2 active:scale-95 shadow-sm shadow-teal-600/20"
                >
                  {isAiLoading ? <RefreshCw size={10} className="spin" /> : <BrainCircuit size={12} />}
                  GENERATE
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => setInputText('')} className="p-2.5 text-slate-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-xl group" title="Clear Text">
                  <Eraser size={22} className="group-active:scale-90 transition-transform" />
                </button>
                <div className="flex-1 bg-white rounded-2xl flex items-center px-5 py-2.5 border border-slate-200 shadow-inner focus-within:ring-4 ring-teal-500/10 transition-all">
                  <textarea 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 outline-none resize-none max-h-32 text-[15px] py-1 bg-transparent text-slate-700 placeholder:text-slate-300 leading-normal"
                    rows={1}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                  />
                </div>
                <button 
                  onClick={handleSendMessage}
                  className="bg-teal-600 text-white p-3.5 rounded-2xl hover:bg-teal-700 transition-all shadow-xl shadow-teal-600/30 active:scale-90"
                >
                  <Send size={22} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] flex-col gap-8 animate-in fade-in duration-700">
            <div className="relative">
              <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center shadow-2xl border-8 border-slate-50/50 relative z-10">
                <RefreshCw size={80} className="text-slate-200" />
              </div>
              <div className="absolute inset-0 bg-teal-500/10 blur-3xl rounded-full scale-150"></div>
            </div>
            <div className="text-center relative z-10 px-10">
              <h2 className="text-3xl font-black text-slate-700 mb-3 tracking-tighter uppercase">WhatsApp Command</h2>
              <p className="text-slate-400 text-sm max-w-xs mx-auto font-medium leading-relaxed italic">Your private, AI-accelerated communications hub. Select an account to start.</p>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-[450px] border border-slate-100 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-black text-2xl flex items-center gap-3 text-slate-800 uppercase tracking-tighter"><Settings className="text-teal-600" /> System Config</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button>
            </div>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Gemini AI Backbone Key</label>
                <input 
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Paste AI Studio Key..."
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-mono shadow-inner"
                />
                <div className="bg-teal-50 p-3 rounded-xl mt-4 border border-teal-100/50">
                  <p className="text-[10px] text-teal-700 font-bold leading-relaxed">AI drafting and analysis require a Google API key. You can create one for free at Google AI Studio.</p>
                </div>
              </div>
              <button 
                onClick={handleSaveSettings}
                className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/30 transition-all active:scale-[0.98] mt-4"
              >
                Sync Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Instance Modal */}
      {isAddingInstance && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-96 border border-slate-100 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-8">
              <h3 className="font-black text-2xl text-slate-800 uppercase tracking-tighter">Deploy Engine</h3>
              <button onClick={() => setIsAddingInstance(false)} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button>
            </div>
            <div className="mb-8">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Instance Identifier</label>
              <input 
                autoFocus
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                placeholder="e.g. MISSION_CONTROL"
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-bold shadow-inner uppercase"
              />
            </div>
            <button 
              onClick={handleCreateInstance}
              className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/30 transition-all active:scale-[0.98]"
            >
              Initialize Node
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
