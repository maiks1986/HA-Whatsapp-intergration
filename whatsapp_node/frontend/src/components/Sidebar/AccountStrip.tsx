import React from 'react';
import { Settings, Eye, Plus, Terminal, RotateCcw } from 'lucide-react';
import { Instance } from '../../types';

interface AccountStripProps {
  instances: Instance[];
  selectedInstance: Instance | null;
  onSelectInstance: (inst: Instance) => void;
  onOpenSettings: () => void;
  onOpenStatuses: () => void;
  onAddInstance: () => void;
  onOpenDebug: () => void;
  onHardReset: () => void;
  isReseting: boolean;
}

export const AccountStrip: React.FC<AccountStripProps> = ({
  instances,
  selectedInstance,
  onSelectInstance,
  onOpenSettings,
  onOpenStatuses,
  onAddInstance,
  onOpenDebug,
  onHardReset,
  isReseting
}) => {
  return (
    <div className="w-16 bg-slate-100 border-r border-slate-200 flex flex-col items-center py-4 gap-4 shrink-0">
      <button onClick={onOpenSettings} className="p-2 hover:bg-white rounded-xl transition-all text-slate-500"><Settings size={20} /></button>
      <button onClick={onOpenStatuses} className="p-2 hover:bg-white rounded-xl transition-all text-slate-500" title="Status Updates"><Eye size={20} /></button>
      <div className="w-8 h-px bg-slate-200"></div>
      
      {instances.map(inst => (
        <div 
          key={inst.id} 
          onClick={() => onSelectInstance(inst)} 
          className={`w-12 h-12 rounded-2xl flex items-center justify-center cursor-pointer transition-all relative shadow-sm overflow-hidden ${selectedInstance?.id === inst.id ? 'bg-teal-600 text-white scale-110 shadow-teal-600/20' : 'bg-white text-slate-400 hover:bg-slate-50'}`} 
          title={inst.name}
        >
          {inst.id === 1 && inst.status === 'connected' ? ( // Logic: if it's the primary instance, we might want to show your own face?
             // Actually, instances usually don't have their own profile pic synced yet.
             // We'll keep the letter icon but add the connected status.
             <span className="font-black text-lg">{inst.name ? inst.name[0].toUpperCase() : '?'}</span>
          ) : (
             <span className="font-black text-lg">{inst.name ? inst.name[0].toUpperCase() : '?'}</span>
          )}
          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white z-10 ${inst.status === 'connected' ? 'bg-green-500' : 'bg-slate-400'}`}></div>
        </div>
      ))}
      
      <button onClick={onAddInstance} className="w-12 h-12 rounded-2xl bg-white border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:border-teal-500 hover:text-teal-600 transition-all"><Plus size={24} /></button>
      
      <div className="mt-auto pb-4 flex flex-col gap-2">
        <button onClick={onOpenDebug} className="p-3 text-slate-400 hover:text-teal-500 hover:bg-teal-50 rounded-xl transition-all" title="Debugger"><Terminal size={20} /></button>
        <button onClick={onHardReset} disabled={!selectedInstance || isReseting} className="p-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all disabled:opacity-30" title="Hard Reset"><RotateCcw size={20} className={isReseting ? 'spin' : ''} /></button>
      </div>
    </div>
  );
};
