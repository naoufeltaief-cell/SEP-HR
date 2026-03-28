import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import api from '../utils/api';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: 'Bonjour! Je suis l\'assistant Soins Expert Plus. Comment puis-je vous aider?\n\nExemples:\n• "Ajoute Marjorie à Forestville lundi-vendredi 7h-15h"\n• "Combien d\'heures a fait Annie ce mois-ci?"\n• "Génère la facture de la semaine"' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEnd = useRef(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      // Build history for API (alternating user/assistant)
      const history = messages
        .filter(m => m.role !== 'bot' || messages.indexOf(m) > 0)
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

      const res = await api.chat(text, history);
      setMessages(prev => [...prev, { role: 'bot', text: res.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `Erreur: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button className="chat-toggle" onClick={() => setOpen(!open)} title="Assistant Claude">
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-header">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Assistant Claude</div>
              <div style={{ fontSize: 11, opacity: .8 }}>Soins Expert Plus</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
                <div className="bubble" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
              </div>
            ))}
            {loading && (
              <div className="chat-msg bot">
                <div className="bubble" style={{ color: 'var(--text3)' }}>
                  <span style={{ animation: 'pulse 1.5s infinite' }}>Réflexion en cours...</span>
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          <div className="chat-input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Posez votre question..."
              disabled={loading}
            />
            <button onClick={send} disabled={loading}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
