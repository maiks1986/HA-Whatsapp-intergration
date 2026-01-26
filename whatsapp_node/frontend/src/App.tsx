import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Send, CheckCircle2, RefreshCw } from 'lucide-react';

const socket = io();

interface Message {
  sender: string;
  chat_name: string;
  text: string;
  timestamp: string;
}

const App = () => {
  const [status, setStatus] = useState('connecting');
  const [qr, setQr] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contact, setContact] = useState('');
  const [msgText, setMsgText] = useState('');

  useEffect(() => {
    socket.on('status', (s) => setStatus(s));
    socket.on('qr', (url) => setQr(url));
    socket.on('new_message', (msg) => setMessages(prev => [msg, ...prev].slice(0, 50)));

    // Initial load
    axios.get('/api/account_status').then(res => setStatus(res.data[0].status));
    axios.get('/api/messages').then(res => setMessages(res.data));

    return () => {
      socket.off('status');
      socket.off('qr');
      socket.off('new_message');
    };
  }, []);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('/api/send_message', { contact, message: msgText });
      alert('Message sent!');
      setMsgText('');
    } catch (err) {
      alert('Failed to send');
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>WhatsApp Hub</h1>
        <div style={{ padding: '8px 16px', borderRadius: '20px', background: status === 'connected' ? '#e6f4ea' : '#fce8e6', color: status === 'connected' ? '#1e8e3e' : '#d93025', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {status === 'connected' ? <CheckCircle2 size={18} /> : <RefreshCw size={18} className="spin" />}
          <strong>{status.toUpperCase()}</strong>
        </div>
      </header>

      {status !== 'connected' && qr && (
        <section style={{ background: 'white', padding: '30px', borderRadius: '12px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <h2>Link your WhatsApp</h2>
          <p>Scan this code with your phone</p>
          <img src={qr} alt="QR Code" style={{ border: '1px solid #eee', padding: '10px', borderRadius: '8px' }} />
        </section>
      )}

      {status === 'connected' && (
        <section style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', marginBottom: '20px' }}>
          <h3><Send size={18} /> Send Message</h3>
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone number (e.g. 316...)" style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }} required />
            <textarea value={msgText} onChange={e => setMsgText(e.target.value)} placeholder="Your message..." rows={3} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }} required />
            <button type="submit" style={{ padding: '12px', background: '#128c7e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Send</button>
          </form>
        </section>
      )}

      <section style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <h3>Conversation Log</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.length === 0 ? <p style={{ color: '#666' }}>No messages yet...</p> : messages.map((m, i) => (
            <div key={i} style={{ borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '4px' }}>
                <strong>{m.sender}</strong> ({m.chat_name}) <span style={{ float: 'right' }}>{m.timestamp}</span>
              </div>
              <div>{m.text}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default App;
