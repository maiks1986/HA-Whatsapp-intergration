import React from 'react';
import { Search, Users, RefreshCw, User, Pin } from 'lucide-react';
import { Chat, Contact, Instance } from '../../types';

interface ChatListProps {
  activeTab: 'chats' | 'contacts';
  setActiveTab: (tab: 'chats' | 'contacts') => void;
  selectedInstance: Instance | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onSearch: (e: React.FormEvent) => void;
  onOpenGroupModal: () => void;
  handleTogglePresence: () => void;
  handleReconnect: () => void;
  chats: Chat[];
  contacts: Contact[];
  selectedChat: Chat | null;
  setSelectedChat: (chat: Chat | null) => void;
  presenceMap: Record<string, string>;
}

export const ChatList: React.FC<ChatListProps> = ({
  activeTab,
  setActiveTab,
  selectedInstance,
  searchQuery,
  setSearchQuery,
  onSearch,
  onOpenGroupModal,
  // handleTogglePresence,
  handleReconnect,
  chats,
  contacts,
  selectedChat,
  setSelectedChat,
  presenceMap
}) => {
  return (
    <div className="w-[450px] bg-white border-r border-slate-200 flex flex-col overflow-hidden shrink-0">
      <header className="p-4 border-b bg-slate-50/50 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <div className="flex gap-4">
            <button onClick={() => setActiveTab('chats')} className={`text-xs font-black uppercase tracking-widest ${activeTab === 'chats' ? 'text-teal-600' : 'text-slate-400'}`}>Chats</button>
            <button onClick={() => setActiveTab('contacts')} className={`text-xs font-black uppercase tracking-widest ${activeTab === 'contacts' ? 'text-teal-600' : 'text-slate-400'}`}>Contacts</button>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'contacts' && <button onClick={onOpenGroupModal} className="p-1.5 bg-teal-50 text-teal-600 rounded-lg" title="New Group"><Users size={14} /></button>}
            {selectedInstance?.status === 'connected' && (
              <>
                {/* <button onClick={handleTogglePresence} className={`p-1.5 rounded-lg transition-all ${selectedInstance.presence === 'available' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`} title="Online State"><CircleDot size={14} /></button> */}
                <button onClick={handleReconnect} className="p-1.5 bg-teal-50 text-teal-600 rounded-lg hover:bg-teal-100 transition-all" title="Reconnect"><RefreshCw size={14} /></button>
              </>
            )}
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <form onSubmit={onSearch}>
            <input 
              placeholder={`Search ${activeTab}...`} 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
              className="w-full bg-slate-100 rounded-xl py-2 pl-10 pr-4 text-xs font-medium outline-none focus:ring-2 ring-teal-500/10" 
            />
          </form>
        </div>
      </header>
      
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'chats' ? chats.map(chat => (
          <div 
            key={chat.jid} 
            onClick={() => setSelectedChat(chat)} 
            className={`p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 transition-all ${selectedChat?.jid === chat.jid ? 'bg-teal-50/50 border-l-4 border-l-teal-600' : 'hover:bg-slate-50'}`}
          >
            <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center shrink-0 shadow-inner relative overflow-hidden">
              {chat.profile_picture ? (
                <img src={`/media/${chat.profile_picture}`} className="w-full h-full object-cover" alt="" />
              ) : (
                <User size={24} className="text-slate-400" />
              )}
              {chat.is_pinned === 1 && <Pin size={10} className="absolute -top-1 -right-1 text-teal-600 rotate-45" />}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="flex justify-between items-start mb-0.5">
                <div className="flex flex-col overflow-hidden">
                    <span className="font-bold text-slate-800 truncate">{chat.name}</span>
                    {chat.name !== chat.jid.split('@')[0] && <span className="text-[10px] text-slate-400 font-mono truncate">{chat.jid.split('@')[0]}</span>}
                </div>
                <span className="text-[9px] font-black text-slate-400 uppercase shrink-0 ml-2">{chat.last_message_timestamp ? new Date(chat.last_message_timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
              </div>
              <div className="text-xs text-slate-500 truncate italic">
                {presenceMap[chat.jid] ? (
                  <span className="text-teal-600 font-bold animate-pulse uppercase tracking-tighter">{presenceMap[chat.jid]}...</span>
                ) : (
                  chat.last_message_text || 'No messages yet'
                )}
              </div>
            </div>
            {chat.unread_count > 0 && <div className="bg-teal-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{chat.unread_count}</div>}
          </div>
        )) : contacts.map(contact => (
          <div 
            key={contact.jid} 
            onClick={() => { setSelectedChat({ ...contact, unread_count: 0, last_message_text: '', last_message_timestamp: '', is_archived: 0, is_pinned: 0 }); setActiveTab('chats'); }} 
            className="p-4 flex items-center gap-3 cursor-pointer border-b border-slate-50 hover:bg-slate-50 transition-all"
          >
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center shrink-0"><User size={20} className="text-slate-400" /></div>
            <div className="flex-1 overflow-hidden">
              <div className="font-bold text-slate-800 truncate">{contact.name}</div>
              <div className="text-[10px] text-slate-400 font-mono">{contact.jid.split('@')[0]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
