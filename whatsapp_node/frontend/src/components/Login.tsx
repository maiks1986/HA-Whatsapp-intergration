import React from 'react';
import { Lock, ShieldCheck, Info } from 'lucide-react';

interface LoginProps {
  loginMode: 'direct' | 'ha';
  setLoginMode: (m: 'direct' | 'ha') => void;
  password: string;
  setPassword: (p: string) => void;
  haUrl: string;
  setHaUrl: (u: string) => void;
  haToken: string;
  setHaToken: (t: string) => void;
  handleLogin: (e: React.FormEvent) => void;
}

export const Login: React.FC<LoginProps> = ({
  loginMode,
  setLoginMode,
  password,
  setPassword,
  haUrl,
  setHaUrl,
  haToken,
  setHaToken,
  handleLogin
}) => {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-[#f0f2f5] p-6">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-1/3 bg-teal-600 z-0"></div>
      
      <div className="relative z-10 bg-white p-12 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] w-full max-w-[500px] border border-slate-100">
        <div className="flex flex-col items-center mb-10">
            <div className="w-24 h-24 bg-teal-50 rounded-full flex items-center justify-center mb-6 shadow-inner relative">
                <Lock size={40} className="text-teal-600" />
                <div className="absolute -bottom-1 -right-1 bg-white p-1.5 rounded-full shadow-md border border-slate-50 text-teal-500">
                    <ShieldCheck size={20} />
                </div>
            </div>
            <h1 className="text-3xl font-black text-slate-800 tracking-tighter uppercase mb-2">Access Portal</h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">WhatsApp Engine & AI Secretary</p>
        </div>

        <div className="flex bg-slate-50 p-1.5 rounded-2xl mb-10 border border-slate-100">
          <button 
            onClick={() => setLoginMode('direct')} 
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all duration-300 ${loginMode === 'direct' ? 'bg-white text-teal-600 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Direct Login
          </button>
          <button 
            onClick={() => setLoginMode('ha')} 
            className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition-all duration-300 ${loginMode === 'ha' ? 'bg-white text-teal-600 shadow-md scale-[1.02]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            HA Integration
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          {loginMode === 'direct' ? (
            <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Master Password</label>
                <input 
                    autoFocus 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    placeholder="••••••••" 
                    className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-center text-lg tracking-[0.3em] shadow-inner" 
                />
            </div>
          ) : (
            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Home Assistant URL</label>
                    <input autoFocus placeholder="http://homeassistant.local:8123" value={haUrl} onChange={e => setHaUrl(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-medium" />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Long-Lived Access Token</label>
                    <input type="password" placeholder="Paste token from HA Profile..." value={haToken} onChange={e => setHaToken(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none focus:border-teal-500 focus:bg-white transition-all text-sm font-medium" />
                </div>
            </div>
          )}
          
          <button type="submit" className="w-full bg-teal-600 text-white p-5 rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-teal-700 shadow-[0_10px_30px_rgba(13,148,136,0.3)] transition-all active:scale-[0.98] mt-4">
            Authenticate
          </button>
        </form>

        <div className="mt-10 flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100/50">
            <Info className="text-amber-500 shrink-0" size={18} />
            <p className="text-[10px] text-amber-700 font-bold leading-relaxed">
                If accessing via Home Assistant sidebar (Ingress), you should be logged in automatically. 
                Use Direct Login for stand-alone access.
            </p>
        </div>
      </div>
    </div>
  );
};