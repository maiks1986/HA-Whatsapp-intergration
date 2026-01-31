import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Terminal, X, Pause, Play, History } from 'lucide-react';

const socket = io();

// Determine Base Path (Helper)
const getBaseUrl = () => {
  const path = window.location.pathname;
  if (path.includes('hassio_ingress')) return 'api';
  if (path.startsWith('/whatsapp')) return '/api/whatsapp_proxy';
  return 'api';
};

const Debug = ({ onClose }: { onClose: () => void }) => {
    const [activeTab, setActiveTab] = useState<'events' | 'database'>('events');
    const [events, setEvents] = useState<any[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const [lineLimit, setLineLimit] = useState(50);
    const [isLoading, setIsLoading] = useState(false);
    
    // Database Browser state
    const [dbTable, setDbTable] = useState('messages');
    const [dbData, setDbData] = useState<any[]>([]);
    const [dbOffset, setDbOffset] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);
    const BASE = getBaseUrl();

    const fetchHistory = async () => {
        setIsLoading(true);
        try {
            const res = await axios.get(`${BASE}/debug/raw_logs?limit=${lineLimit}`);
            setEvents(res.data.map((log: any) => ({
                id: Math.random(),
                timestamp: new Date(log.timestamp).toLocaleTimeString(),
                instanceId: log.instanceId,
                payload: log.events
            })));
        } catch (e) { alert("Failed to fetch logs"); } finally { setIsLoading(false); }
    };

    const fetchDbData = async (reset = false) => {
        setIsLoading(true);
        const newOffset = reset ? 0 : dbOffset;
        try {
            const res = await axios.get(`${BASE}/debug/db/${dbTable}?limit=50&offset=${newOffset}`);
            setDbData(res.data);
            if (reset) setDbOffset(0);
        } catch (e) { alert("Failed to fetch DB data"); } finally { setIsLoading(false); }
    };

    useEffect(() => {
        if (activeTab === 'database') fetchDbData(true);
    }, [dbTable, activeTab]);

    useEffect(() => {
        socket.emit('subscribe_raw_events');
        socket.on('raw_whatsapp_event', (data: any) => {
            if (isPaused || activeTab !== 'events') return;
            setEvents(prev => [...prev.slice(-99), {
                id: Date.now() + Math.random(),
                timestamp: new Date(data.timestamp || Date.now()).toLocaleTimeString(),
                instanceId: data.instanceId,
                payload: data.events
            }]);
        });
        return () => { socket.off('raw_whatsapp_event'); };
    }, [isPaused, activeTab]);

    useEffect(() => {
        if (!isPaused && events.length > 0 && activeTab === 'events') {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [events, isPaused, activeTab]);

    return (
        <div className="fixed inset-4 bg-slate-900 shadow-2xl rounded-2xl flex flex-col z-[300] border border-slate-700 overflow-hidden animate-in zoom-in-95 duration-200">
            <header className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                        <h2 className="text-white font-black text-sm uppercase tracking-widest flex items-center gap-2"><Terminal size={18} className="text-teal-400" /> System Debugger</h2>
                    </div>
                    <div className="flex bg-slate-700 p-1 rounded-xl">
                        <button onClick={() => setActiveTab('events')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'events' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>Live Events</button>
                        <button onClick={() => setActiveTab('database')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'database' ? 'bg-teal-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}>DB Browser</button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {activeTab === 'events' ? (
                        <>
                            <select value={lineLimit} onChange={(e) => setLineLimit(parseInt(e.target.value))} className="bg-slate-700 text-white text-[10px] font-bold outline-none px-2 py-1.5 rounded-lg">
                                <option value="50">50 Lines</option><option value="100">100 Lines</option><option value="200">200 Lines</option>
                            </select>
                            <button onClick={fetchHistory} disabled={isLoading} className="flex items-center gap-2 px-3 py-1.5 bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 rounded-lg transition-all text-[10px] font-bold uppercase">
                                <History size={14} /> {isLoading ? 'Loading...' : 'Fetch History'}
                            </button>
                            <button onClick={() => setIsPaused(!isPaused)} className={`p-1.5 rounded-lg transition-all ${isPaused ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                                {isPaused ? <Play size={18} /> : <Pause size={18} />}
                            </button>
                        </>
                    ) : (
                        <div className="flex items-center gap-2">
                            <select value={dbTable} onChange={(e) => setDbTable(e.target.value)} className="bg-slate-700 text-white text-[10px] font-bold outline-none px-2 py-1.5 rounded-lg">
                                <option value="messages">Messages</option><option value="chats">Chats</option><option value="contacts">Contacts</option><option value="instances">Instances</option><option value="settings">Settings</option>
                            </select>
                            <button onClick={() => fetchDbData(true)} className="p-1.5 bg-teal-600 text-white rounded-lg"><History size={14} /></button>
                        </div>
                    )}
                    <button onClick={onClose} className="p-1.5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-all"><X size={20} /></button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-2 bg-slate-950 scrollbar-hide" ref={scrollRef}>
                {activeTab === 'events' ? (
                    <>
                        {events.length === 0 && <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-4 opacity-50"><Terminal size={48} /><p className="italic">Waiting for events...</p></div>}
                        {events.map(ev => (
                            <div key={ev.id} className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-2 border-b border-slate-800 pb-1">
                                    <span className="text-teal-500 font-bold">[{ev.timestamp}] Instance {ev.instanceId}</span>
                                    <span className="text-slate-600 text-[9px] uppercase font-black">{Object.keys(ev.payload || {}).join(', ')}</span>
                                </div>
                                <pre className="text-slate-400 whitespace-pre-wrap break-all">{JSON.stringify(ev.payload, null, 2)}</pre>
                            </div>
                        ))}
                    </>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-800 text-teal-500 font-black text-[9px] uppercase tracking-widest">
                                    {dbData.length > 0 && Object.keys(dbData[0]).map(k => <th key={k} className="p-2">{k}</th>)}
                                </tr>
                            </thead>
                            <tbody className="text-slate-400">
                                {dbData.map((row, i) => (
                                    <tr key={i} className="border-b border-slate-900 hover:bg-slate-900/50">
                                        {Object.values(row).map((v: any, j) => <td key={j} className="p-2 max-w-[200px] truncate">{String(v)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {dbData.length === 0 && <div className="p-10 text-center text-slate-600">No records found in {dbTable}</div>}
                        <div className="flex justify-center gap-4 mt-4">
                            <button onClick={() => { setDbOffset(Math.max(0, dbOffset - 50)); fetchDbData(); }} className="px-4 py-1 bg-slate-800 rounded text-slate-400 hover:text-white text-[10px] font-bold">PREVIOUS 50</button>
                            <button onClick={() => { setDbOffset(dbOffset + 50); fetchDbData(); }} className="px-4 py-1 bg-slate-800 rounded text-slate-400 hover:text-white text-[10px] font-bold">NEXT 50</button>
                        </div>
                    </div>
                )}
            </div>

            <footer className="p-2 bg-slate-800 border-t border-slate-700 text-[9px] text-slate-500 text-center font-bold uppercase tracking-widest">
                Modular Architecture &bull; V1.8.8 &bull; Total Logs: {events.length}
            </footer>
        </div>
    );
};

export default Debug;