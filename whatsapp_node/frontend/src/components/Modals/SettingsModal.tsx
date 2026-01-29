import React from 'react';
import { Settings, X, AlertTriangle } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
  geminiKey: string;
  setGeminiKey: (k: string) => void;
  autoNudge: boolean;
  setAutoNudge: (n: boolean) => void;
  syncDelay: number;
  setSyncDelay: (d: number) => void;
  ephemeralStart: string;
  setEphemeralStart: (s: string) => void;
  ephemeralStop: string;
  setEphemeralStop: (s: string) => void;
  onSave: () => void;
  onReset: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  onClose, 
  geminiKey, 
  setGeminiKey, 
  autoNudge, 
  setAutoNudge, 
  syncDelay,
  setSyncDelay,
  ephemeralStart,
  setEphemeralStart,
  ephemeralStop,
  setEphemeralStop,
  onSave, 
  onReset 
}) => {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl w-[450px] border border-slate-100 animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <h3 className="font-black text-2xl flex items-center gap-3 text-slate-800 uppercase tracking-tighter">
            <Settings className="text-teal-600" /> System Config
          </h3>
          <button onClick={onClose} className="bg-slate-50 p-2 rounded-xl text-slate-400 hover:text-red-500 transition-all">
            <X size={24} />
          </button>
        </div>
        <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Gemini AI Key</label>
            <input 
              type="password" 
              value={geminiKey} 
              onChange={(e) => setGeminiKey(e.target.value)} 
              placeholder="Paste key..." 
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-mono shadow-inner" 
            />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 ml-1">Ephemeral Trigger Emojis</label>
            <div className="flex gap-4">
                <div className="flex-1">
                    <span className="text-[9px] text-teal-600 font-bold uppercase block mb-1">Start Trigger</span>
                    <input 
                      type="text" 
                      value={ephemeralStart} 
                      onChange={(e) => setEphemeralStart(e.target.value)} 
                      className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none text-center text-xl" 
                      maxLength={2}
                    />
                </div>
                <div className="flex-1">
                    <span className="text-[9px] text-red-500 font-bold uppercase block mb-1">Stop Trigger</span>
                    <input 
                      type="text" 
                      value={ephemeralStop} 
                      onChange={(e) => setEphemeralStop(e.target.value)} 
                      className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none text-center text-xl" 
                      maxLength={2}
                    />
                </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Sync Performance Delay</label>
              <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">{(syncDelay / 1000).toFixed(1)}s</span>
            </div>
            <input 
              type="range" 
              min="1000" 
              max="30000" 
              step="500" 
              value={syncDelay} 
              onChange={(e) => setSyncDelay(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-teal-600"
            />
            <p className="text-[8px] text-slate-400 font-bold mt-2 italic text-center">Lower is faster, higher is safer against WhatsApp rate limits.</p>
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

          <button onClick={onSave} className="w-full bg-teal-600 text-white p-5 rounded-2xl font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl transition-all active:scale-[0.98] mt-4">
            Sync Configuration
          </button>
          
          <div className="pt-6 border-t border-slate-100 mt-6">
            <button onClick={onReset} className="w-full bg-white text-red-500 border-2 border-red-100 p-4 rounded-2xl font-bold uppercase text-xs tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2">
              <AlertTriangle size={16} /> Full System Wipe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
