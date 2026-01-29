import React from 'react';
import { 
  User, 
  Check, 
  CheckCheck, 
  File, 
  MapPin,
  Reply,
  Star,
  Trash2,
  Forward
} from 'lucide-react';
import { Message } from '../types';

interface MessageBubbleProps {
  m: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ m }) => {
  const isMe = m.is_from_me === 1;
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mediaUrl = m.media_path ? `/media/${m.media_path.split(/[\/]/).pop()}` : null;
  const isGroup = m.chat_jid.endsWith('@g.us');

  return (
    <div className={`flex flex-col mb-2 ${isMe ? 'items-end' : 'items-start'} group/row`}>
      {!isMe && isGroup && (
        <span className="text-[10px] font-bold text-teal-600 ml-3 mb-0.5 px-1">{m.sender_name !== "Unknown" ? m.sender_name : m.sender_jid.split('@')[0]}</span>
      )}
      
      <div className={`max-w-[85%] rounded-2xl p-2 px-3 shadow-sm relative group ${isMe ? 'bg-teal-600 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none'}`}>
        
        {/* Action Toolbar */}
        <div className={`absolute -top-8 ${isMe ? 'right-0' : 'left-0'} hidden group-hover/row:flex bg-white text-slate-600 shadow-xl border border-slate-100 rounded-xl p-1 gap-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200`}>
            <button className="p-1.5 hover:bg-slate-100 rounded-lg hover:text-teal-600 transition-colors" title="Reply"><Reply size={14} /></button>
            <button className="p-1.5 hover:bg-slate-100 rounded-lg hover:text-yellow-500 transition-colors" title="Star"><Star size={14} /></button>
            <button className="p-1.5 hover:bg-slate-100 rounded-lg hover:text-blue-500 transition-colors" title="Forward"><Forward size={14} /></button>
            <div className="w-px bg-slate-200 my-1"></div>
            <button className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600 transition-colors" title="Delete"><Trash2 size={14} /></button>
        </div>

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
        
        {m.reactions && m.reactions.length > 0 && (
          <div className={`absolute -bottom-3 ${isMe ? 'right-2' : 'left-2'} flex gap-0.5 bg-white border border-slate-100 rounded-full px-1.5 py-0.5 shadow-sm z-10 scale-90`}>
            {m.reactions.map((r, i) => <span key={i} title={r.sender_jid} className="text-[12px]">{r.emoji}</span>)}
          </div>
        )}
      </div>
    </div>
  );
};
