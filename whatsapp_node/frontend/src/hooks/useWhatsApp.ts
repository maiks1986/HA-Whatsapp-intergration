import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { api } from '../api';
import { Instance, Chat, Contact, Message, StatusUpdate } from '../types';

const socket = io();

export const useWhatsApp = (authState: string) => {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});
  const [intent, setIntent] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<StatusUpdate[]>([]);
  const [autoNudge, setAutoNudge] = useState(true);
  const [syncDelay, setSyncDelay] = useState(2000);
  const [geminiKey, setGeminiKey] = useState('');
  const [ephemeralStartEmoji, setEphemeralStartEmoji] = useState('👻');
  const [ephemeralStopEmoji, setEphemeralStopEmoji] = useState('🛑');
  
  // Group specific state
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  const fetchInstances = async () => {
    const res = await api.getInstances();
    setInstances(res.data);
    if (res.data.length > 0 && !selectedInstance) setSelectedInstance(res.data[0]);
  };

  const fetchChats = async (id: number) => {
    const res = await api.getChats(id);
    setChats(res.data);
  };

  const fetchContacts = async (id: number) => {
    const res = await api.getContacts(id);
    setContacts(res.data);
  };

  const fetchMessages = async (id: number, jid: string) => {
    const res = await api.getMessages(id, jid);
    setMessages(res.data.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
    if (res.data.length > 0) analyzeIntent();
  };

  const analyzeIntent = async () => {
    try {
      // API call logic
    } catch (e) {}
  };

  // Sync selectedInstance with instances updates
  useEffect(() => {
    if (selectedInstance) {
      const updated = instances.find(i => i.id === selectedInstance.id);
      if (updated && (updated.status !== selectedInstance.status || updated.qr !== selectedInstance.qr || updated.presence !== selectedInstance.presence)) {
        setSelectedInstance(updated);
      }
    }
  }, [instances]);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    fetchInstances();
    
    socket.on('instances_status', (statusUpdates: any[]) => {
      setInstances(prev => prev.map(inst => {
        const update = statusUpdates.find(u => u.id === inst.id);
        return update ? { ...inst, status: update.status, presence: update.presence, qr: update.qr } : inst;
      }));
    });

    socket.on('chat_update', (data: { instanceId: number }) => {
      if (selectedInstance?.id === data.instanceId) fetchChats(data.instanceId);
    });

    socket.on('new_message', (data: { instanceId: number, jid: string }) => {
      if (selectedInstance?.id === data.instanceId && selectedChat?.jid === data.jid) {
        fetchMessages(data.instanceId, data.jid);
      }
    });

    socket.on('presence_update', (data: { instanceId: number, jid: string, presence: any }) => {
      if (selectedInstance?.id === data.instanceId) {
        const status = data.presence[Object.keys(data.presence)[0]]?.lastKnownPresence || '';
        setPresenceMap(prev => ({ ...prev, [data.jid]: status }));
        if (status) setTimeout(() => setPresenceMap(prev => ({ ...prev, [data.jid]: '' })), 5000);
      }
    });

    return () => {
      socket.off('instances_status');
      socket.off('chat_update');
      socket.off('new_message');
      socket.off('presence_update');
    };
  }, [authState, selectedInstance?.id, selectedChat?.jid]);

  useEffect(() => {
    if (selectedInstance && selectedInstance.status === 'connected') {
      fetchChats(selectedInstance.id);
      fetchContacts(selectedInstance.id);
    }
  }, [selectedInstance?.id]);

  useEffect(() => {
    if (selectedInstance && selectedChat) fetchMessages(selectedInstance.id, selectedChat.jid);
    else { setMessages([]); setIntent(null); }
  }, [selectedChat?.jid]);

  return {
    instances,
    selectedInstance,
    setSelectedInstance,
    chats,
    contacts,
    selectedChat,
    setSelectedChat,
    messages,
    setMessages,
    presenceMap,
    intent,
    statuses,
    setStatuses,
    autoNudge,
    setAutoNudge,
    syncDelay,
    setSyncDelay,
    geminiKey,
    setGeminiKey,
    ephemeralStartEmoji,
    setEphemeralStartEmoji,
    ephemeralStopEmoji,
    setEphemeralStopEmoji,
    newGroupTitle,
    setNewGroupTitle,
    selectedContacts,
    setSelectedContacts,
    fetchInstances,
    fetchChats,
    fetchMessages
  };
};