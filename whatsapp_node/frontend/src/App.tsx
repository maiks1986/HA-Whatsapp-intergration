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
  X,
  Settings,
  BrainCircuit,
  Eraser,
  Lock,
  MessageSquare,
  AlertTriangle,
  RotateCcw,
  Terminal,
  Check,
  CheckCheck,
  File,
  MapPin,
  Users,
  Eye,
  Pin,
  Archive,
  Trash2
} from 'lucide-react';

import Debug from './Debug';
import {
  Instance,
  Chat,
  Contact,
  Message,
  StatusUpdate,
  AuthStatusResponse,
  LoginResponse
} from './types';

// Helper for Cookies
const setCookie = (name: string, value: string) => {
  const date = new Date();
  date.setTime(date.getTime() + (30 * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Strict`;
};
const getCookie = (name: string) => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
};

const updateAxiosAuth = (token: string | null) => {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
};

const socket = io();

const MessageBubble = ({ m }: { m: Message }) => {
  const isMe = m.is_from_me === 1;
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mediaUrl = m.media_path ? `/media/${m.media_path.split(/[\/]/).pop()}` : null;

  return (
    <div className={`flex flex-col mb-2 ${isMe ? 'items-end' : 'items-start'}`}>
      <div className={`max-w-[85%] rounded-2xl p-2 px-3 shadow-sm relative group ${isMe ? 'bg-teal-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none'}`}>
        {m.type === 'image' && mediaUrl && <div className="mb-1 rounded-lg overflow-hidden border border-black/5"><img src={mediaUrl} className="max-w-full max-h-64 object-cover" alt="WA Media" /></div>}
        {m.type === 'video' && mediaUrl && <div className="mb-1 rounded-lg overflow-hidden border border-black/5 bg-black"><video src={mediaUrl} controls className="max-w-full max-h-64" /></div>}
        {m.type === 'audio' && mediaUrl && <div className="mb-1 py-1"><audio src={mediaUrl} controls className={`max-w-full scale-90 -ml-4 ${isMe ? 'invert brightness-200' : ''}`} /></div>}
        {m.type === 'document' && <div className={`flex items-center gap-3 p-3 rounded-lg mb-1 ${isMe ? 'bg-teal-700' : 'bg-slate-100'}`}><File size={24} className={isMe ? 'text-teal-200' : 'text-slate-500'} /><div className="flex-1 overflow-hidden"><div className="text-xs font-bold truncate">Document</div><a href={mediaUrl || '#'} target="_blank" rel="noreferrer" className="text-[10px] opacity-70 hover:underline">Download File</a></div></div>}
        {m.type === 'location' && m.latitude && m.longitude && <a href={`https://www.google.com/maps?q=${m.latitude},${m.longitude}`} target="_blank" rel="noreferrer" className="flex flex-col gap-2 mb-1 group/loc"><div className="w-full h-32 bg-slate-200 rounded-lg flex items-center justify-center overflow-hidden relative"><img src={`https://maps.googleapis.com/maps/api/staticmap?center=${m.latitude},${m.longitude}&zoom=15&size=300x150&key=`} className="w-full h-full object-cover blur-[1px] grayscale-[0.5]" alt="Map" /><MapPin className="absolute text-red-500" size={24} /></div><div className="text-[10px] font-bold uppercase tracking-tighter opacity-70 group-hover/loc:underline text-right">View on Maps</div></a>}
        {m.type === 'vcard' && <div className={`flex items-center gap-3 p-3 rounded-xl mb-1 border ${isMe ? 'bg-teal-700 border-teal-500' : 'bg-slate-50 border-slate-100'}`}><div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center"><User size={20} /></div><div className="flex-1 overflow-hidden"><div className="text-xs font-bold truncate">Contact Card</div><div className="text-[10px] opacity-70 truncate">Shared via WhatsApp</div></div></div>}
        <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{m.text}</div>
        <div className={`flex items-center justify-end gap-1 mt-1 ${isMe ? 'text-teal-100' : 'text-slate-400'}`}>
          <span className="text-[9px] font-bold uppercase tracking-widest">{time}</span>
          {isMe && <span>{m.status === 'read' ? <CheckCheck size={12} className="text-blue-300" /> : m.status === 'delivered' ? <CheckCheck size={12} /> : <Check size={12} />}</span>}
        </div>
        {m.reactions && m.reactions.length > 0 && <div className={`absolute -bottom-3 ${isMe ? 'right-2' : 'left-2'} flex gap-0.5 bg-white border border-slate-100 rounded-full px-1.5 py-0.5 shadow-sm z-10 scale-90`}>{m.reactions.map((r, i) => <span key={i} title={r.sender_jid} className="text-[12px]">{r.emoji}</span>)}</div>}
      </div>
    </div>
  );
};

const App = () => {
  const [authState, setAuthState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [password, setPassword] = useState('');
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [loginMode, setLoginMode] = useState<'direct' | 'ha'>('direct');
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts'>('chats');
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [steerText, setSteerText] = useState('');
  const [intent, setIntent] = useState<string | null>(null);
  const [isAddingInstance, setIsAddingInstance] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [autoNudge, setAutoNudge] = useState(true);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isReseting, setIsReseting] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showStatusViewer, setShowStatusViewer] = useState(false);
  const [statuses, setStatuses] = useState<StatusUpdate[]>([]);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { checkAuth(5); }, []);

  const checkAuth = async (retries = 0) => {
    const localToken = getCookie('direct_token') || localStorage.getItem('direct_token');
    updateAxiosAuth(localToken);
    try {
      const res = await axios.get<AuthStatusResponse>('/api/auth/status');
      if (res.data.authenticated) {
        setAuthState('authenticated');
        fetchInstances(); fetchGeminiKey();
      } else if (retries > 0) setTimeout(() => checkAuth(retries - 1), 2000);
      else setAuthState('unauthenticated');
    } catch (e) {
      if (retries > 0) setTimeout(() => checkAuth(retries - 1), 2000);
      else setAuthState('unauthenticated');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let res;
      if (loginMode === 'direct') res = await axios.post<LoginResponse>('/api/auth/login', { password });
      else res = await axios.post<LoginResponse>('/api/auth/ha_login', { haUrl, haToken });
      setCookie('direct_token', res.data.token); updateAxiosAuth(res.data.token);
      setAuthState('authenticated'); fetchInstances(); fetchGeminiKey();
    } catch (err) { alert("Invalid Credentials"); }
  };

  useEffect(() => {
    if (authState !== 'authenticated') return;
    socket.on('instances_status', (statusUpdates: any[]) => {
      setInstances(prev => prev.map(inst => {
        const update = statusUpdates.find(u => u.id === inst.id);
        return update ? { ...inst, status: update.status, presence: update.presence, qr: update.qr } : inst;
      }));
    });
    socket.on('chat_update', (data: { instanceId: number }) => {
      if (selectedInstance?.id === data.instanceId) activeTab === 'chats' ? fetchChats(data.instanceId) : fetchContacts(data.instanceId);
    });
    socket.on('new_message', (data: { instanceId: number, jid: string }) => {
      if (selectedInstance?.id === data.instanceId && selectedChat?.jid === data.jid) fetchMessages(data.instanceId, data.jid);
    });
    socket.on('presence_update', (data: { instanceId: number, jid: string, presence: any }) => {
      if (selectedInstance?.id === data.instanceId) {
        const status = data.presence[Object.keys(data.presence)[0]]?.lastKnownPresence || '';
        setPresenceMap(prev => ({ ...prev, [data.jid]: status }));
        if (status) setTimeout(() => setPresenceMap(prev => ({ ...prev, [data.jid]: '' })), 5000);
      }
    });
    return () => { socket.off('instances_status'); socket.off('chat_update'); socket.off('new_message'); socket.off('presence_update'); };
  }, [authState, selectedInstance?.id, selectedChat?.jid, activeTab]);

  useEffect(() => {
    if (selectedInstance && selectedInstance.status === 'connected') activeTab === 'chats' ? fetchChats(selectedInstance.id) : fetchContacts(selectedInstance.id);
    else { setChats([]); setContacts([]); setSelectedChat(null); }
  }, [selectedInstance?.id, activeTab]);

  useEffect(() => {
    if (selectedInstance && selectedChat) fetchMessages(selectedInstance.id, selectedChat.jid);
    else { setMessages([]); setIntent(null); }
  }, [selectedChat?.jid]);

  const fetchContacts = async (instanceId: number) => {
    const res = await axios.get<Contact[]>(`/api/contacts/${instanceId}`);
    setContacts(res.data);
  };

  const fetchStatuses = async () => {
    if (!selectedInstance) return;
    const res = await axios.get<StatusUpdate[]>(`/api/status/${selectedInstance.id}`);
    setStatuses(res.data);
    setShowStatusViewer(true);
  };

  const handleCreateGroup = async () => {
    if (!selectedInstance || !newGroupTitle || selectedContacts.length === 0) return;
    await axios.post(`/api/groups/${selectedInstance.id}`, { title: newGroupTitle, participants: selectedContacts });
    setShowGroupModal(false); setNewGroupTitle(''); setSelectedContacts([]); fetchChats(selectedInstance.id);
  };

  const handleModifyChat = async (action: 'archive' | 'pin' | 'delete') => {
    if (!selectedInstance || !selectedChat) return;
    await axios.post(`/api/chats/${selectedInstance.id}/${selectedChat.jid}/modify`, { action });
    setSelectedChat(null); fetchChats(selectedInstance.id);
  };

  const handleReconnect = async () => { if (selectedInstance) await axios.post(`/api/instances/${selectedInstance.id}/reconnect`); };
  const handleTogglePresence = async () => { if (selectedInstance) await axios.post(`/api/instances/${selectedInstance.id}/presence`, { presence: selectedInstance.presence === 'available' ? 'unavailable' : 'available' }); };
  const fetchInstances = async () => { const res = await axios.get<Instance[]>('/api/instances'); setInstances(res.data); if (res.data.length > 0 && !selectedInstance) setSelectedInstance(res.data[0]); };
  const fetchChats = async (instanceId: number) => { const res = await axios.get<Chat[]>(`/api/chats/${instanceId}`); setChats(res.data); };
    const fetchGeminiKey = async () => {
      const res = await axios.get<{ value: string }>('/api/settings/gemini_api_key');
      setGeminiKey(res.data.value);
      const nudgeRes = await axios.get<{ value: string }>('/api/settings/auto_nudge_enabled');
      setAutoNudge(nudgeRes.data.value !== 'false');
    };
  
    const handleSaveSettings = async () => {
      await axios.post('/api/settings', { key: 'gemini_api_key', value: geminiKey });
      await axios.post('/api/settings', { key: 'auto_nudge_enabled', value: autoNudge.toString() });
      setIsSettingsOpen(false);
    };
  const handleSystemReset = async () => { if (confirm("CRITICAL Wipe?")) { await axios.post('api/system/reset'); window.location.reload(); } };
  const fetchMessages = async (instanceId: number, jid: string) => { const res = await axios.get<Message[]>(`/api/messages/${instanceId}/${jid}`); setMessages(res.data.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())); scrollToBottom(); if (res.data.length > 0) analyzeIntent(res.data); };
  const analyzeIntent = async (msgs: Message[]) => { try { const res = await axios.post('/api/ai/analyze', { messages: msgs.slice(-20) }); setIntent(res.data.intent); } catch (e) {} };
  const handleAiDraft = async () => { if (messages.length === 0) return; setIsAiLoading(true); try { const res = await axios.post('/api/ai/draft', { messages: messages.slice(-10), steer: steerText }); setInputText(res.data.draft); } finally { setIsAiLoading(false); } };
  const scrollToBottom = () => { setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100); };
  const handleCreateInstance = async () => { if (!newInstanceName) return; await axios.post('/api/instances', { name: newInstanceName }); setNewInstanceName(''); setIsAddingInstance(false); fetchInstances(); };
  const handleHardReset = async () => { if (!selectedInstance || !confirm("Delete session?")) return; setIsReseting(true); try { await axios.delete(`/api/instances/${selectedInstance.id}`); setSelectedInstance(null); fetchInstances(); } finally { setIsReseting(false); } };
  const handleSendMessage = async () => { if (!inputText || !selectedInstance || !selectedChat) return; try { await axios.post('/api/send_message', { instanceId: selectedInstance.id, contact: selectedChat.jid, message: inputText }); setInputText(''); setSteerText(''); } catch (e) { alert("Failed to send"); } };
    const handleSearch = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedInstance || !searchQuery) return;
      let url = `/api/messages/${selectedInstance.id}/search?query=${searchQuery}`;
      if (selectedChat) url += `&jid=${selectedChat.jid}`;
      const res = await axios.get<Message[]>(url);
      setMessages(res.data);
    };

  if (authState === 'loading') return <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg"><RefreshCw size={48} className="text-teal-600 spin" /></div>;

  if (authState === 'unauthenticated') {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg">
        <div className="bg-white p-10 rounded-2xl shadow-2xl w-[450px] text-center border-t-8 border-teal-600">
          <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} className="text-teal-600" /></div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">WhatsApp Pro</h1>
          <div className="flex gap-4 mb-8 justify-center border-b border-slate-100">
            <button onClick={() => setLoginMode('direct')} className={`pb-2 text-sm font-bold transition-all ${loginMode === 'direct' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-slate-400'}`}>Password</button>
            <button onClick={() => setLoginMode('ha')} className={`pb-2 text-sm font-bold transition-all ${loginMode === 'ha' ? 'text-teal-600 border-b-2 border-teal-600' : 'text-slate-400'}`}>Home Assistant</button>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            {loginMode === 'direct' ? <input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all text-center" /> : (
              <><input autoFocus placeholder="HA URL" value={haUrl} onChange={e => setHaUrl(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm" /><input type="password" placeholder="Access Token" value={haToken} onChange={e => setHaToken(e.target.value)} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm" /></>
            )}
            <button type="submit" className="w-full bg-teal-600 text-white p-4 rounded-xl font-bold hover:bg-teal-700 shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98]">{loginMode === 'ha' ? 'Login with HA' : 'Login'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-whatsapp-bg overflow-hidden text-slate-800">
      <div className="w-16 bg-slate-100 border-r border-slate-200 flex flex-col items-center py-4 gap-4 shrink-0">
        <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-white rounded-xl transition-all text-slate-500"><Settings size={20} /></button>
        <button onClick={fetchStatuses} className="p-2 hover:bg-white rounded-xl transition-all text-slate-500" title="Status Updates"><Eye size={20} /></button>
        <div className="w-8 h-px bg-slate-200"></div>
        {instances.map(inst => (
          <div key={inst.id} onClick={() => setSelectedInstance(inst)} className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all relative shadow-sm ${selectedInstance?.id === inst.id ? 'bg-teal-600 text-white scale-110 shadow-teal-600/20' : 'bg-white text-slate-400 hover:bg-slate-50'}`} title={inst.name}>
            <span className="font-black text-lg">{inst.name ? inst.name[0].toUpperCase() : '?'}</span>
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${inst.status === 'connected' ? 'bg-green-500' : 'bg-slate-400'}`}></div>
          </div>
        ))}
        <button onClick={() => setIsAddingInstance(true)} className="w-12 h-12 rounded-2xl bg-white border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-teal-500 hover:text-teal-600 transition-all"><Plus size={24} /></button>
        <div className="mt-auto pb-4 flex flex-col gap-2">
          <button onClick={() => setShowDebug(true)} className="p-3 text-slate-400 hover:text-teal-500 hover:bg-teal-50 rounded-xl transition-all" title="Debugger"><Terminal size={20} /></button>
          <button onClick={handleHardReset} disabled={!selectedInstance || isReseting} className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-30" title="Hard Reset"><RotateCcw size={20} className={isReseting ? 'spin' : ''} /></button>
        </div>
      </div>

      <div className="w-[450px] bg-white border-r border-slate-200 flex flex-col overflow-hidden">
        <header className="p-4 border-b bg-slate-50/50 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <div className="flex gap-4">
              <button onClick={() => setActiveTab('chats')} className={`text-xs font-black uppercase tracking-widest ${activeTab === 'chats' ? 'text-teal-600' : 'text-slate-400'}`}>Chats</button>
              <button onClick={() => setActiveTab('contacts')} className={`text-xs font-black uppercase tracking-widest ${activeTab === 'contacts' ? 'text-teal-600' : 'text-slate-400'}`}>Contacts</button>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'contacts' && <button onClick={() => setShowGroupModal(true)} className="p-1.5 bg-teal-50 text-teal-600 rounded-lg" title="New Group"><Users size={14} /></button>}
              {selectedInstance?.status === 'connected' && (
                <><button onClick={handleTogglePresence} className={`p-1.5 rounded-lg transition-all ${selectedInstance.presence === 'available' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`} title="Online State"><CircleDot size={14} /></button>
                <button onClick={handleReconnect} className="p-1.5 bg-teal-50 text-teal-600 rounded-lg hover:bg-teal-100 transition-all" title="Reconnect"><RefreshCw size={14} /></button></>
              )}
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <form onSubmit={handleSearch}><input placeholder={`Search ${activeTab}...`} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-slate-100 rounded-xl py-2 pl-10 pr-4 text-xs font-medium outline-none focus:ring-2 ring-teal-500/10" /></form>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? chats.map(chat => (
            <div key={chat.jid} onClick={() => setSelectedChat(chat)} className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 transition-all ${selectedChat?.jid === chat.jid ? 'bg-teal-50/50 border-l-4 border-l-teal-600' : 'hover:bg-slate-50'}`}>
              <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center shrink-0 shadow-inner relative">
                <User size={24} className="text-slate-400" />
                {chat.is_pinned === 1 && <Pin size={10} className="absolute -top-1 -right-1 text-teal-600 rotate-45" />}
              </div>
                              <div className="flex-1 overflow-hidden">
                                <div className="flex justify-between items-start mb-0.5">
                                  <span className="font-bold text-slate-800 truncate">{chat.name}</span>
                                  <span className="text-[9px] font-black text-slate-400 uppercase">{chat.last_message_timestamp ? new Date(chat.last_message_timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                                </div>
                                <div className="text-xs text-slate-500 truncate italic">
                                  {presenceMap[chat.jid] ? (
                                    <span className="text-teal-600 font-bold animate-pulse uppercase tracking-tighter">{presenceMap[chat.jid]}...</span>
                                  ) : (
                                    chat.last_message_text || 'No messages yet'
                                  )}
                                </div>
                              </div>              {chat.unread_count > 0 && <div className="bg-teal-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{chat.unread_count}</div>}
            </div>
          )) : contacts.map(contact => (
            <div key={contact.jid} onClick={() => { setSelectedChat({ ...contact, unread_count: 0, last_message_text: '', last_message_timestamp: '', is_archived: 0, is_pinned: 0 }); setActiveTab('chats'); }} className="p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 hover:bg-slate-50 transition-all">
              <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center shrink-0"><User size={20} className="text-slate-400" /></div>
              <div className="flex-1 overflow-hidden"><div className="font-bold text-slate-800 truncate">{contact.name}</div><div className="text-[10px] text-slate-400 font-mono">{contact.jid.split('@')[0]}</div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col relative shadow-2xl">
        {selectedChat ? (
          <>
            <header className="p-4 bg-slate-50 border-b flex justify-between items-center shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center shadow-inner text-slate-500"><CircleDot size={24} /></div>
                <div>
                  <h3 className="font-bold leading-tight text-slate-800">{selectedChat.name}</h3>
                  {presenceMap[selectedChat.jid] ? <span className="text-[10px] text-teal-600 font-bold animate-pulse uppercase">{presenceMap[selectedChat.jid]}...</span> : (intent && <span className="text-[10px] bg-teal-100 text-teal-700 px-2 py-0.5 rounded-full font-bold uppercase">Intent: {intent}</span>)}
                </div>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <button onClick={() => handleModifyChat('pin')} className={`p-2 rounded-lg hover:bg-slate-100 ${selectedChat.is_pinned ? 'text-teal-600' : ''}`} title="Pin Chat"><Pin size={18} /></button>
                <button onClick={() => handleModifyChat('archive')} className="p-2 rounded-lg hover:bg-slate-100" title="Archive Chat"><Archive size={18} /></button>
                <button onClick={() => handleModifyChat('delete')} className="p-2 rounded-lg hover:bg-red-50 hover:text-red-500" title="Delete Chat"><Trash2 size={18} /></button>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto p-6 flex flex-col bg-[#efeae2] bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] relative">
              {messages.map((m) => <MessageBubble key={m.id} m={m} />)}
              <div ref={messagesEndRef} />
            </div>
            <footer className="p-3 bg-slate-100 border-t flex flex-col gap-2 z-10">
              <div className="flex gap-2 items-center bg-white/80 backdrop-blur p-1.5 px-3 rounded-xl border border-slate-200/60 shadow-sm">
                <Sparkles size={14} className="text-teal-600 shrink-0" /><input value={steerText} onChange={(e) => setSteerText(e.target.value)} placeholder="AI Instruction..." className="flex-1 bg-transparent text-[11px] outline-none font-bold italic" /><button disabled={isAiLoading} onClick={handleAiDraft} className="text-[10px] bg-teal-600 text-white px-4 py-1.5 rounded-lg font-black tracking-widest uppercase shadow-sm">{isAiLoading ? <RefreshCw size={10} className="spin" /> : <BrainCircuit size={12} />} GENERATE</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setInputText('')} className="p-2.5 text-slate-400 hover:text-red-500 transition-all hover:bg-red-50 rounded-xl"><Eraser size={22} /></button>
                <div className="flex-1 bg-white rounded-2xl flex items-center px-5 py-2.5 border border-slate-200 shadow-inner focus-within:ring-4 ring-teal-500/10 transition-all"><textarea value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type a message..." className="flex-1 outline-none resize-none max-h-32 text-[15px] py-1 bg-transparent leading-normal" rows={1} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())} /></div>
                <button onClick={handleSendMessage} className="bg-teal-600 text-white p-3.5 rounded-2xl hover:bg-teal-700 shadow-xl active:scale-90"><Send size={22} /></button>
              </div>
            </footer>
          </>
        ) : <div className="flex-1 flex items-center justify-center bg-[#f0f2f5] flex-col gap-8 animate-in fade-in duration-700"><div className="relative"><div className="w-40 h-40 bg-white rounded-full flex items-center justify-center shadow-2xl border-8 border-slate-50/50 relative z-10"><MessageSquare size={80} className="text-slate-200" /></div><div className="absolute inset-0 bg-teal-500/10 blur-3xl rounded-full scale-150"></div></div><div className="text-center relative z-10 px-10"><h2 className="text-3xl font-black text-slate-700 mb-3 tracking-tighter uppercase">Select a Conversation</h2><p className="text-slate-400 text-sm max-w-xs mx-auto font-medium leading-relaxed italic">Choose a chat to start messaging.</p></div></div>}
      </div>

      {showGroupModal && <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[150] backdrop-blur-sm animate-in fade-in duration-200"><div className="bg-white p-8 rounded-[2rem] shadow-2xl w-[400px] border border-slate-100"><div className="flex justify-between items-center mb-6"><h3 className="font-black text-xl text-slate-800 uppercase">Create New Group</h3><button onClick={() => setShowGroupModal(false)} className="text-slate-400 hover:text-white transition-all"><X size={24} /></button></div><input placeholder="Group Title" value={newGroupTitle} onChange={e => setNewGroupTitle(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl mb-4 outline-none focus:border-teal-500" /><div className="max-h-64 overflow-y-auto border border-slate-100 rounded-xl p-2 mb-6">{contacts.map(c => <div key={c.jid} onClick={() => setSelectedContacts(prev => prev.includes(c.jid) ? prev.filter(j => j !== c.jid) : [...prev, c.jid])} className={`p-3 flex items-center gap-3 rounded-lg cursor-pointer transition-all ${selectedContacts.includes(c.jid) ? 'bg-teal-50 border-teal-200' : 'hover:bg-slate-50'}`}><div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selectedContacts.includes(c.jid) ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300'}`}>{selectedContacts.includes(c.jid) && <Check size={12} />}</div><span className="text-sm font-bold text-slate-700">{c.name}</span></div>)}</div><button onClick={handleCreateGroup} className="w-full bg-teal-600 text-white p-4 rounded-xl font-black uppercase tracking-widest shadow-lg active:scale-95">Deploy Group</button></div></div>}

      {showStatusViewer && <div className="fixed inset-0 bg-slate-900 flex items-center justify-center z-[250] animate-in fade-in duration-300"><div className="max-w-2xl w-full h-[80vh] flex flex-col"><div className="flex justify-between items-center p-6"><h3 className="text-white font-black text-2xl uppercase tracking-tighter">Status Updates</h3><button onClick={() => setShowStatusViewer(false)} className="text-slate-400 hover:text-white transition-all"><X size={32} /></button></div><div className="flex-1 overflow-y-auto p-6 space-y-6">{statuses.length === 0 ? <p className="text-slate-500 text-center italic mt-20">No status updates found.</p> : statuses.map(s => <div key={s.id} className="bg-slate-800 rounded-2xl overflow-hidden border border-slate-700 shadow-xl"><div className="p-4 border-b border-slate-700 flex justify-between items-center"><span className="text-teal-400 font-black text-xs uppercase">{s.sender_name}</span><span className="text-slate-500 text-[10px]">{new Date(s.timestamp).toLocaleString()}</span></div>{s.media_path && <div className="aspect-video bg-black flex items-center justify-center">{s.type === 'image' ? <img src={`/media/${s.media_path.split(/[\/]/).pop()}`} className="max-h-full max-w-full object-contain" alt="status" /> : <video src={`/media/${s.media_path.split(/[\/]/).pop()}`} controls className="max-h-full max-w-full" />}</div>}<div className="p-4 text-white text-sm leading-relaxed">{s.text}</div></div>)}</div></div></div>}

      {isSettingsOpen && <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200"><div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-[450px] border border-slate-100 animate-in zoom-in-95 duration-300"><div className="flex justify-between items-center mb-8"><h3 className="font-black text-2xl flex items-center gap-3 text-slate-800 uppercase tracking-tighter"><Settings className="text-teal-600" /> System Config</h3><button onClick={() => setIsSettingsOpen(false)} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button></div><div className="space-y-6">
  <div>
    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Gemini AI Key</label>
    <input type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="Paste key..." className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-mono shadow-inner" />
  </div>
  
  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border-2 border-slate-100">
    <div>
      <h4 className="text-xs font-black text-slate-700 uppercase">Auto-Nudge Health Check</h4>
      <p className="text-[9px] text-slate-400 font-bold">Automatically restart stalled syncs</p>
    </div>
    <button 
      onClick={() => setAutoNudge(!autoNudge)} 
      className={`w-12 h-6 rounded-full transition-all relative ${autoNudge ? 'bg-teal-600' : 'bg-slate-300'}`}
    >
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autoNudge ? 'left-7' : 'left-1'}`}></div>
    </button>
  </div>

  <button onClick={handleSaveSettings} className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl transition-all active:scale-[0.98] mt-4">Sync Configuration</button><div className="pt-6 border-t border-slate-100 mt-6"><button onClick={handleSystemReset} className="w-full bg-white text-red-500 border-2 border-red-100 p-4 rounded-2xl font-bold uppercase text-xs tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2"><AlertTriangle size={16} /> Full System Wipe</button></div></div></div></div>}

      {isAddingInstance && <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200"><div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-96 border border-slate-100 animate-in zoom-in-95 duration-300"><div className="flex justify-between items-center mb-8"><h3 className="font-black text-2xl text-slate-800 uppercase tracking-tighter">Deploy Engine</h3><button onClick={() => setIsAddingInstance(false)} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all"><X size={24} /></button></div><div className="mb-8"><label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Identifier</label><input autoFocus value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="e.g. CORE" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 uppercase font-bold" /></div><button onClick={handleCreateInstance} className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest active:scale-[0.98]">Initialize Node</button></div></div>}

      {showDebug && <Debug onClose={() => setShowDebug(false)} />}
    </div>
  );
};

export default App;