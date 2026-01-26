import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { 
  Send, 
  Plus, 
  User, 
  Trash2, 
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
        <div className="p-4 bg-slate-50 flex justify-between items-center border-b">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center">
              <User size={20} className="text-slate-600" />
            </div>
            <h2 className="font-bold">Accounts</h2>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
              <Settings size={20} className="text-slate-500" />
            </button>
            <button onClick={() => setIsAddingInstance(true)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
              <Plus size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {instances.map(inst => (
            <div 
              key={inst.id}
              onClick={() => setSelectedInstance(inst)}
              className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 transition-colors ${selectedInstance?.id === inst.id ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              <div className="relative">
                <div className="w-12 h-12 bg-teal-600 rounded-full flex items-center justify-center text-white font-bold">
                  {inst.name[0].toUpperCase()}
                </div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${inst.status === 'connected' ? 'bg-green-500' : 'bg-slate-400'}`}></div>
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="font-semibold truncate">{inst.name}</div>
                <div className="text-xs text-slate-500 truncate">{inst.status}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative">
        {selectedInstance ? (
          <>
            <header className="p-4 bg-slate-50 border-b flex justify-between items-center shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center overflow-hidden">
                  <CircleDot size={24} className="text-slate-500" />
                </div>
                <div>
                  <h3 className="font-bold leading-tight">{selectedInstance.name}</h3>
                  {intent && <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-medium">Intent: {intent}</span>}
                </div>
              </div>
              <div className="flex items-center gap-4 text-slate-500">
                <Search size={20} />
                <MoreVertical size={20} />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2 bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
              {selectedInstance.status === 'qr_ready' && selectedInstance.qr && (
                <div className="bg-white p-8 rounded-lg shadow-md mx-auto my-10 text-center max-w-sm border-t-4 border-teal-600">
                  <h2 className="text-xl font-bold mb-2 text-slate-800">Link your device</h2>
                  <p className="text-sm text-slate-500 mb-6 font-medium">1. Open WhatsApp on your phone<br/>2. Tap Settings > Linked Devices<br/>3. Point your phone to this screen</p>
                  <div className="p-2 bg-white rounded-lg border-2 border-slate-100 shadow-inner inline-block">
                    <img src={selectedInstance.qr} className="w-64 h-64" />
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div 
                  key={m.id} 
                  className={`max-w-[75%] p-2 px-3 rounded-lg shadow-sm text-sm relative animate-in fade-in slide-in-from-bottom-1 duration-200 ${m.is_from_me ? 'bg-whatsapp-bubble self-end' : 'bg-white self-start'}`}
                >
                  <div className="leading-relaxed whitespace-pre-wrap">{m.text}</div>
                  <div className="text-[9px] text-slate-400 text-right mt-1 font-medium">{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <footer className="p-3 bg-slate-100 border-t flex flex-col gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
              <div className="flex gap-2 items-center bg-white/50 p-1 px-2 rounded-lg border border-slate-200">
                <Sparkles size={14} className="text-teal-600 shrink-0" />
                <input 
                  value={steerText}
                  onChange={(e) => setSteerText(e.target.value)}
                  placeholder="Tell AI how to reply (e.g. 'Say no politely', 'Use emojis')"
                  className="flex-1 bg-transparent text-[11px] outline-none p-1 font-medium italic"
                />
                <button 
                  disabled={isAiLoading}
                  onClick={handleAiDraft}
                  className="text-[10px] bg-teal-600 text-white px-3 py-1 rounded-md font-bold hover:bg-teal-700 disabled:bg-slate-300 transition-all flex items-center gap-1"
                >
                  {isAiLoading ? <RefreshCw size={10} className="spin" /> : <BrainCircuit size={10} />}
                  DRAFT REPLY
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => setInputText('')} className="p-2 text-slate-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-full" title="Clear Text">
                  <Eraser size={22} />
                </button>
                <div className="flex-1 bg-white rounded-xl flex items-center px-4 py-2 border border-slate-200 shadow-inner focus-within:ring-2 ring-teal-500/20">
                  <textarea 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 outline-none resize-none max-h-32 text-sm py-1 bg-transparent"
                    rows={1}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                  />
                </div>
                <button 
                  onClick={handleSendMessage}
                  className="bg-teal-600 text-white p-3 rounded-full hover:bg-teal-700 transition-all shadow-md active:scale-95"
                >
                  <Send size={20} />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] flex-col gap-6">
            <div className="w-32 h-32 bg-slate-200 rounded-full flex items-center justify-center border-8 border-white shadow-sm">
              <RefreshCw size={64} className="text-slate-400" />
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-light text-slate-600 mb-2">Select an account to start chatting</h2>
              <p className="text-slate-400 text-sm max-w-xs">Connecting you to your personal AI-powered WhatsApp Command Center.</p>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white p-8 rounded-2xl shadow-2xl w-[400px] border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl flex items-center gap-2 text-slate-800"><Settings className="text-slate-400" /> Settings</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Gemini API Key</label>
                <input 
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Paste your key here..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm"
                />
                <p className="text-[10px] text-slate-400 mt-2">Get a free key at <a href="https://aistudio.google.com/" target="_blank" className="text-teal-600 underline">Google AI Studio</a></p>
              </div>
              <button 
                onClick={handleSaveSettings}
                className="w-full bg-teal-600 text-white p-3 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all mt-4"
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Instance Modal */}
      {isAddingInstance && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-sm">
          <div className="bg-white p-8 rounded-2xl shadow-2xl w-80 border border-slate-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl text-slate-800">New Account</h3>
              <button onClick={() => setIsAddingInstance(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            <input 
              autoFocus
              value={newInstanceName}
              onChange={(e) => setNewInstanceName(e.target.value)}
              placeholder="e.g. Personal, Work..."
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm mb-6"
            />
            <button 
              onClick={handleCreateInstance}
              className="w-full bg-teal-600 text-white p-3 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all"
            >
              Start Connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;