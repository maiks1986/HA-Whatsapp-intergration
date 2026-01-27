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
  Lock,
  MessageSquare,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

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

interface Chat {
  jid: string;
  name: string;
  last_message_text: string;
  last_message_timestamp: string;
  unread_count: number;
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
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [steerText, setSteerText] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [isAddingInstance, setIsAddingInstance] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [newInstanceName, setNewInstanceName] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isReseting, setIsReseting] = useState(false);
  
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
    return () => { socket.off('instances_status'); };
  }, [authState]);

  useEffect(() => {
    if (selectedInstance && selectedInstance.status === 'connected') {
      fetchChats(selectedInstance.id);
    } else {
      setChats([]);
      setSelectedChat(null);
    }
  }, [selectedInstance]);

  useEffect(() => {
    if (selectedInstance && selectedChat) {
      fetchMessages(selectedInstance.id, selectedChat.jid);
    } else {
      setMessages([]);
      setIntent(null);
    }
  }, [selectedChat]);

  const fetchInstances = async () => {
    const res = await axios.get('/api/instances');
    setInstances(res.data);
    if (res.data.length > 0 && !selectedInstance) setSelectedInstance(res.data[0]);
  };

  const fetchChats = async (instanceId: number) => {
    const res = await axios.get(`/api/chats/${instanceId}`);
    setChats(res.data);
  };

  const fetchGeminiKey = async () => {
    const res = await axios.get('/api/settings/gemini_api_key');
    setGeminiKey(res.data.value);
  };

  const handleSaveSettings = async () => {
    await axios.post('api/settings', { key: 'gemini_api_key', value: geminiKey });
    setIsSettingsOpen(false);
  };

  const handleSystemReset = async () => {
    if (!confirm("CRITICAL: This will delete ALL instances, ALL message history, and ALL settings. This cannot be undone. Are you absolutely sure?")) return;
    try {
      await axios.post('api/system/reset');
      window.location.reload();
    } catch (e) {
      alert("Failed to perform system reset");
    }
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
      alert("AI Service unavailable.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
  };

  const handleCreateInstance = async () => {
    if (!newInstanceName) return;
    await axios.post('/api/instances', { name: newInstanceName });
    setNewInstanceName('');
    setIsAddingInstance(false);
    fetchInstances();
  };

  const handleHardReset = async () => {
    if (!selectedInstance) return;
    if (!confirm("This will log out the account and DELETE all local message history for this instance. Are you sure?")) return;
    
    setIsReseting(true);
    try {
      await axios.delete(`/api/instances/${selectedInstance.id}`);
      setSelectedInstance(null);
      fetchInstances();
    } catch (e) {
      alert("Failed to reset instance");
    } finally {
      setIsReseting(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText || !selectedInstance || !selectedChat) return;
    try {
      await axios.post('/api/send_message', {
        instanceId: selectedInstance.id,
        contact: selectedChat.jid.split('@')[0],
        message: inputText
      });
      setInputText('');
      setSteerText('');
      fetchMessages(selectedInstance.id, selectedChat.jid);
      fetchChats(selectedInstance.id);
    } catch (e) {
      alert("Failed to send");
    }
  };

  if (authState === 'loading') return <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg"><RefreshCw size={48} className="text-teal-600 spin" /></div>;

  if (authState === 'unauthenticated') {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg">
        <form onSubmit={handleLogin} className="bg-white p-10 rounded-2xl shadow-2xl w-[400px] text-center border-t-8 border-teal-600">
          <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} className="text-teal-600" /></div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">WhatsApp Pro</h1>
          <p className="text-sm text-slate-500 mb-8 font-medium">Enter your direct access password</p>
          <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all mb-6 text-center" />
          <button type="submit" className="w-full bg-teal-600 text-white p-4 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98]">Login</button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-whatsapp-bg overflow-hidden text-slate-800">
      {/* Sidebar: Accounts & Chats */}
      <div className="w-[450px] bg-white border-r border-slate-200 flex overflow-hidden">
        {/* Account Strip */}
        <div className="w-16 bg-slate-100 border-r border-slate-200 flex flex-col items-center py-4 gap-4 shrink-0">
          <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-500"><Settings size={20} /></button>
          <div className="w-8 h-px bg-slate-200"></div>
          {instances.map(inst => (
            <div 
              key={inst.id}
              onClick={() => setSelectedInstance(inst)}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all relative shadow-sm ${selectedInstance?.id === inst.id ? 'bg-teal-600 text-white scale-110 shadow-teal-600/20' : 'bg-white text-slate-400 hover:bg-slate-50'}`}
              title={inst.name}
            >
              <span className="font-black text-lg">{inst.name[0].toUpperCase()}</span>
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${inst.status === 'connected' ? 'bg-green-500' : 'bg-slate-400'}`}></div>
            </div>
          ))}
          <button onClick={() => setIsAddingInstance(true)} className="w-12 h-12 rounded-2xl bg-white border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-teal-500 hover:text-teal-600 transition-all"><Plus size={24} /></button>
          
          <div className="mt-auto pb-4">
            <button 
              onClick={handleHardReset} 
              disabled={!selectedInstance || isReseting}
              className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-30"
              title="Hard Reset Current Account"
            >
              <RotateCcw size={20} className={isReseting ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 flex flex-col bg-white">
          <header className="p-4 border-b bg-slate-50/50 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="font-black text-xl tracking-tighter uppercase text-slate-700">Conversations</h2>
              <button onClick={() => selectedInstance && fetchChats(selectedInstance.id)} className="text-slate-400 hover:text-teal-600 transition-all"><RefreshCw size={18} /></button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input placeholder="Search chats..." className="w-full bg-slate-100 rounded-xl py-2 pl-10 pr-4 text-xs font-medium outline-none focus:ring-2 ring-teal-500/10 border-none" />
            </div>
          </header>
          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 && selectedInstance?.status === 'connected' && (
              <div className="p-10 text-center flex flex-col items-center gap-4">
                <RefreshCw size={32} className="text-teal-500 spin opacity-50" />
                <p className="text-slate-400 text-sm italic font-medium leading-tight">No conversations found yet.<br/>Your phone might be busy syncing history.</p>
                <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 mt-4">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-[10px] uppercase mb-1">
                    <AlertTriangle size={12} /> Sync Tip
                  </div>
                  <p className="text-[10px] text-amber-600 leading-tight">Keep WhatsApp open on your phone and stay on the 'Linked Devices' screen to speed this up.</p>
                </div>
              </div>
            )}
            {chats.map(chat => (
              <div 
                key={chat.jid}
                onClick={() => setSelectedChat(chat)}
                className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 transition-all ${selectedChat?.jid === chat.jid ? 'bg-teal-50/50 border-l-4 border-l-teal-600' : 'hover:bg-slate-50'}`}
              >
                <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center shrink-0 shadow-inner">
                  <User size={24} className="text-slate-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="flex justify-between items-start mb-0.5">
                    <span className="font-bold text-slate-800 truncate">{chat.name}</span>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{chat.last_message_timestamp ? new Date(chat.last_message_timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate leading-tight italic">{chat.last_message_text || 'No messages yet'}</div>
                </div>
                {chat.unread_count > 0 && <div className="bg-teal-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm">{chat.unread_count}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content: Messages */}
      <div className="flex-1 flex flex-col relative shadow-2xl">
        {selectedChat ? (
          <>
            <header className="p-4 bg-slate-50 border-b flex justify-between items-center shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center overflow-hidden shadow-inner"><CircleDot size={24} className="text-slate-500" /></div>
                <div>
                  <h3 className="font-bold leading-tight text-slate-800">{selectedChat.name}</h3>
                  {intent && <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter">Intent: {intent}</span>}
                </div>
              </div>
              <div className="flex items-center gap-4 text-slate-400">
                <Search size={20} className="cursor-pointer hover:text-slate-600" />
                <MoreVertical size={20} className="cursor-pointer hover:text-slate-600" />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2 bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat relative">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[75%] p-2 px-3 rounded-xl shadow-sm text-sm relative animate-in fade-in slide-in-from-bottom-1 duration-200 ${m.is_from_me ? 'bg-whatsapp-bubble self-end rounded-tr-none' : 'bg-white self-start rounded-tl-none'}`}>
                  <div className="leading-relaxed whitespace-pre-wrap text-slate-800">{m.text}</div>
                  <div className="text-[9px] text-slate-400 text-right mt-1 font-bold uppercase tracking-widest">{new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <footer className="p-3 bg-slate-100 border-t flex flex-col gap-2 shadow-[0_-4px_15px_rgba(0,0,0,0.03)] relative z-10">
              <div className="flex gap-2 items-center bg-white/80 backdrop-blur p-1.5 px-3 rounded-xl border border-slate-200/60 shadow-sm">
                <Sparkles size={14} className="text-teal-600 shrink-0" />
                <input value={steerText} onChange={(e) => setSteerText(e.target.value)} placeholder="Draft AI: 'Ask for a discount', 'Translate to Spanish'..." className="flex-1 bg-transparent text-[11px] outline-none p-1 font-bold italic text-slate-600 placeholder:text-slate-300" />
                <button disabled={isAiLoading} onClick={handleAiDraft} className="text-[10px] bg-teal-600 text-white px-4 py-1.5 rounded-lg font-black tracking-widest hover:bg-teal-700 disabled:bg-slate-300 transition-all flex items-center gap-2 active:scale-95 shadow-sm shadow-teal-600/20">
                  {isAiLoading ? <RefreshCw size={10} className="spin" /> : <BrainCircuit size={12} />} GENERATE
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setInputText('')} className="p-2.5 text-slate-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-xl group" title="Clear Text"><Eraser size={22} className="group-active:scale-90 transition-transform" /></button>
                <div className="flex-1 bg-white rounded-2xl flex items-center px-5 py-2.5 border border-slate-200 shadow-inner focus-within:ring-4 ring-teal-500/10 transition-all">
                  <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type a message..." className="flex-1 outline-none resize-none max-h-32 text-[15px] py-1 bg-transparent text-slate-700 placeholder:text-slate-300 leading-normal" rows={1} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} />
                </div>
                <button onClick={handleSendMessage} className="bg-teal-600 text-white p-3.5 rounded-2xl hover:bg-teal-700 transition-all shadow-xl shadow-teal-600/30 active:scale-90"><Send size={22} /></button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] flex-col gap-8 animate-in fade-in duration-700">
            {selectedInstance?.status === 'qr_ready' && selectedInstance.qr ? (
              <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl mx-auto text-center max-w-md border-t-8 border-teal-600 animate-in zoom-in-95 duration-300">
                <h2 className="text-3xl font-black mb-2 text-slate-800 tracking-tighter uppercase">Link Account</h2>
                <p className="text-sm text-slate-500 mb-8 font-medium leading-relaxed italic">Scan the QR code with your phone to deploy this engine node.</p>
                <div className="p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-100 shadow-inner inline-block"><img src={selectedInstance.qr} className="w-64 h-64 mix-blend-multiply" /></div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <div className="w-40 h-40 bg-white rounded-full flex items-center justify-center shadow-2xl border-8 border-slate-50/50 relative z-10"><MessageSquare size={80} className="text-slate-200" /></div>
                  <div className="absolute inset-0 bg-teal-500/10 blur-3xl rounded-full scale-150"></div>
                </div>
                <div className="text-center relative z-10 px-10">
                  <h2 className="text-3xl font-black text-slate-700 mb-3 tracking-tighter uppercase">Select a Conversation</h2>
                  <p className="text-slate-400 text-sm max-w-xs mx-auto font-medium leading-relaxed italic">Choose a chat from the left sidebar to start AI-accelerated messaging.</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
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
                <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="Paste AI Studio Key..." className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-mono shadow-inner" />
                <div className="bg-teal-50 p-3 rounded-xl mt-4 border border-teal-100/50"><p className="text-[10px] text-teal-700 font-bold leading-relaxed">AI drafting and analysis require a Google API key. You can create one for free at Google AI Studio.</p></div>
              </div>
              <button onClick={handleSaveSettings} className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/30 transition-all active:scale-[0.98] mt-4">Sync Configuration</button>
              
              <div className="pt-6 border-t border-slate-100 mt-6">
                <button onClick={handleSystemReset} className="w-full bg-white text-red-500 border-2 border-red-100 p-4 rounded-2xl font-bold uppercase text-xs tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2">
                  <AlertTriangle size={16} /> Full System Wipe
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAddingInstance && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-96 border border-slate-100 animate-in zoom-in-95 duration-300">
            <div className="flex justify-between items-center mb-8"><h3 className="font-black text-2xl text-slate-800 uppercase tracking-tighter">Deploy Engine</h3><button onClick={() => setIsAddingInstance(false)} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button></div>
            <div className="mb-8">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Instance Identifier</label>
              <input autoFocus value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="e.g. MISSION_CONTROL" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-bold shadow-inner uppercase" />
            </div>
            <button onClick={handleCreateInstance} className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-600/30 transition-all active:scale-[0.98]">Initialize Node</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
