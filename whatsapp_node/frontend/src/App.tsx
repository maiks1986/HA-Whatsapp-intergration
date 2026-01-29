import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useWhatsApp } from './hooks/useWhatsApp';
import { api } from './api';

import { Login } from './components/Login';
import { AccountStrip } from './components/Sidebar/AccountStrip';
import { ChatList } from './components/Sidebar/ChatList';
import { ChatView } from './components/ChatView';
import { GroupModal } from './components/Modals/GroupModal';
import { StatusViewer } from './components/Modals/StatusViewer';
import { SettingsModal } from './components/Modals/SettingsModal';
import { AddInstanceModal } from './components/Modals/AddInstanceModal';
import { QRSystem } from './systems/QRSystem';
import Debug from './Debug';

const App = () => {
  const auth = useAuth();
  const wa = useWhatsApp(auth.authState);

  // Local UI state
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts'>('chats');
  const [inputText, setInputText] = useState('');
  const [steerText, setSteerText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showStatusViewer, setShowStatusViewer] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddingInstance, setIsAddingInstance] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState('');
  const [isReseting, setIsReseting] = useState(false);

  // 1. HOOKS MUST BE AT THE TOP
  useEffect(() => {
    if (auth.authState === 'authenticated') {
      api.getSetting('gemini_api_key').then(res => wa.setGeminiKey(res.data.value));
      api.getSetting('auto_nudge_enabled').then(res => wa.setAutoNudge(res.data.value !== 'false'));
      api.getSetting('sync_delay_ms').then(res => res.data.value && wa.setSyncDelay(parseInt(res.data.value)));
    }
  }, [auth.authState]);

  // 2. EARLY RETURNS AFTER HOOKS
  if (auth.authState === 'loading') return <div className="h-screen w-full flex items-center justify-center bg-whatsapp-bg"><RefreshCw size={48} className="text-teal-600 spin" /></div>;
  if (auth.authState === 'unauthenticated') return <Login {...auth} />;

  // Handlers
  const handleSendMessage = async () => {
    if (!inputText || !wa.selectedInstance || !wa.selectedChat) return;
    try {
      await api.sendMessage(wa.selectedInstance.id, wa.selectedChat.jid, inputText);
      setInputText(''); setSteerText('');
    } catch (e) { alert("Failed to send"); }
  };

  const handleAiDraft = async () => {
    if (wa.messages.length === 0) return;
    setIsAiLoading(true);
    try {
      const res = await axios.post('/api/ai/draft', { messages: wa.messages.slice(-10), steer: steerText });
      setInputText(res.data.draft);
    } finally { setIsAiLoading(false); }
  };

  const handleHardReset = async () => {
    if (!wa.selectedInstance || !confirm("Delete session?")) return;
    setIsReseting(true);
    try { await api.deleteInstance(wa.selectedInstance.id); wa.setSelectedInstance(null); wa.fetchInstances(); } finally { setIsReseting(false); }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wa.selectedInstance || !searchQuery) return;
    const res = await api.searchMessages(wa.selectedInstance.id, searchQuery, wa.selectedChat?.jid);
    wa.setMessages(res.data);
  };

  const handleCreateGroup = async () => {
    if (!wa.selectedInstance || !wa.newGroupTitle || wa.selectedContacts.length === 0) return;
    await api.createGroup(wa.selectedInstance.id, wa.newGroupTitle, wa.selectedContacts);
    setShowGroupModal(false); wa.fetchChats(wa.selectedInstance.id);
  };

  const fetchStatuses = async () => {
    if (!wa.selectedInstance) return;
    const res = await api.getStatuses(wa.selectedInstance.id);
    wa.setStatuses(res.data);
    setShowStatusViewer(true);
  };

  const handleSaveSettings = async () => {
    await api.saveSetting('gemini_api_key', wa.geminiKey);
    await api.saveSetting('auto_nudge_enabled', wa.autoNudge.toString());
    await api.saveSetting('sync_delay_ms', wa.syncDelay.toString());
    setIsSettingsOpen(false);
  };

  return (
    <div className="flex h-screen bg-whatsapp-bg overflow-hidden text-slate-800">
      <AccountStrip 
        instances={wa.instances}
        selectedInstance={wa.selectedInstance}
        onSelectInstance={wa.setSelectedInstance}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenStatuses={fetchStatuses}
        onAddInstance={() => setIsAddingInstance(true)}
        onOpenDebug={() => setShowDebug(true)}
        onHardReset={handleHardReset}
        isReseting={isReseting}
      />

      <ChatList 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedInstance={wa.selectedInstance}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSearch={handleSearch}
        onOpenGroupModal={() => setShowGroupModal(true)}
        handleTogglePresence={() => wa.selectedInstance && api.setPresence(wa.selectedInstance.id, wa.selectedInstance.presence === 'available' ? 'unavailable' : 'available')}
        handleReconnect={() => wa.selectedInstance && api.reconnect(wa.selectedInstance.id)}
        chats={wa.chats}
        contacts={wa.contacts}
        selectedChat={wa.selectedChat}
        setSelectedChat={wa.setSelectedChat}
        presenceMap={wa.presenceMap}
      />

      <ChatView 
        selectedChat={wa.selectedChat}
        messages={wa.messages}
        presenceMap={wa.presenceMap}
        intent={wa.intent}
        inputText={inputText}
        setInputText={setInputText}
        steerText={steerText}
        setSteerText={setSteerText}
        isAiLoading={isAiLoading}
        onSendMessage={handleSendMessage}
        onAiDraft={handleAiDraft}
        onModifyChat={(action) => wa.selectedInstance && wa.selectedChat && api.modifyChat(wa.selectedInstance.id, wa.selectedChat.jid, action).then(() => wa.fetchChats(wa.selectedInstance!.id))}
        onToggleEphemeral={(enabled) => wa.selectedInstance && wa.selectedChat && api.toggleEphemeral(wa.selectedInstance.id, wa.selectedChat.jid, enabled).then(() => wa.fetchChats(wa.selectedInstance!.id))}
      />

      {showGroupModal && (
        <GroupModal 
          onClose={() => setShowGroupModal(false)}
          onSubmit={handleCreateGroup}
          title={wa.newGroupTitle}
          setTitle={wa.setNewGroupTitle}
          contacts={wa.contacts}
          selectedContacts={wa.selectedContacts}
          setSelectedContacts={wa.setSelectedContacts}
        />
      )}

      {showStatusViewer && <StatusViewer onClose={() => setShowStatusViewer(false)} statuses={wa.statuses} />}
      
      {isSettingsOpen && (
        <SettingsModal 
          onClose={() => setIsSettingsOpen(false)}
          geminiKey={wa.geminiKey}
          setGeminiKey={wa.setGeminiKey}
          autoNudge={wa.autoNudge}
          setAutoNudge={wa.setAutoNudge}
          syncDelay={wa.syncDelay}
          setSyncDelay={wa.setSyncDelay}
          onSave={handleSaveSettings}
          onReset={() => api.resetSystem().then(() => window.location.reload())}
        />
      )}

      {isAddingInstance && (
        <AddInstanceModal 
          onClose={() => setIsAddingInstance(false)}
          name={newInstanceName}
          setName={setNewInstanceName}
          onSubmit={() => api.createInstance(newInstanceName).then(() => { setIsAddingInstance(false); wa.fetchInstances(); })}
        />
      )}

      <QRSystem selectedInstance={wa.selectedInstance} />

      {showDebug && <Debug onClose={() => setShowDebug(false)} />}
    </div>
  );
};

export default App;