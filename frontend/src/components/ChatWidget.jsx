import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, FileText, Users, Bot, Zap } from 'lucide-react';
import api from '../utils/api';

const QUICK_ACTIONS = [
  { icon: '📧', label: 'Voir courriels récents', msg: 'Montre-moi les courriels récents reçus' },
  { icon: '📊', label: 'Résumé facturation', msg: 'Donne-moi un résumé de la facturation: factures impayées, en retard, totaux' },
  { icon: '👥', label: 'Candidats disponibles', msg: 'Quels candidats infirmiers sont disponibles pour les régions éloignées?' },
  { icon: '💰', label: 'Taux et calendrier paie', msg: 'Quels sont les taux de facturation par titre et le calendrier de paie?' },
  { icon: '🚗', label: 'Règles déplacement', msg: 'Quelles sont les règles pour les frais de déplacement et kilométrage?' },
  { icon: '📋', label: 'Vérifier FDT', msg: 'Vérifie les feuilles de temps reçues par courriel cette semaine et compare avec les horaires planifiés' },
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'bot', text: '👋 Bonjour! Je suis l\'assistant Soins Expert Plus.\n\nJe peux vous aider avec:\n\n🧾 **Facturation** — FDT, factures, conciliation\n👥 **Recrutement** — Candidats, besoins clients, assignations\n📧 **Courriels** — Lire, répondre, envoyer\n📊 **Rapports** — Taux, paie, statistiques\n\nQue puis-je faire pour vous?', agent: 'general' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const messagesEnd = useRef(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setShowQuickActions(false);
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const history = messages
        .filter((m, i) => i > 0)
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

      const res = await api.chat(msg, history);
      setMessages(prev => [...prev, { role: 'bot', text: res.reply, agent: res.agent }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `❌ ${err.message}`, agent: 'error' }]);
    } finally {
      setLoading(false);
    }
  };

  const agentBadge = (agent) => {
    if (agent === 'facturation') return { label: '🧾 Facturation', color: '#2A7B88' };
    if (agent === 'recrutement') return { label: '👥 Recrutement', color: '#7c3aed' };
    return null;
  };

  return (
    <>
      <button className="chat-toggle" onClick={() => setOpen(!open)} title="Assistant IA">
        {open ? <X size={24} /> : <Bot size={24} />}
      </button>

      {open && (
        <div className="chat-panel" style={{ height: 600 }}>
          <div className="chat-header">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Zap size={14} /> Agent IA
              </div>
              <div style={{ fontSize: 11, opacity: .8 }}>Facturation · Recrutement · Courriels</div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={18} />
            </button>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => {
              const badge = m.agent ? agentBadge(m.agent) : null;
              return (
                <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
                  {badge && m.role !== 'user' && (
                    <div style={{ fontSize: 9, color: badge.color, fontWeight: 600, marginBottom: 2, letterSpacing: '.03em' }}>
                      {badge.label}
                    </div>
                  )}
                  <div className="bubble" style={{ whiteSpace: 'pre-wrap' }}
                    dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                </div>
              );
            })}
            {loading && (
              <div className="chat-msg bot">
                <div className="bubble" style={{ color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)', animation: 'pulse 1s infinite' }} />
                  Analyse en cours...
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {/* Quick Actions */}
          {showQuickActions && !loading && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {QUICK_ACTIONS.map((a, i) => (
                <button key={i} onClick={() => send(a.msg)}
                  style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 16,
                    padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
                    color: 'var(--text2)', whiteSpace: 'nowrap',
                  }}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          )}

          <div className="chat-input-row">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ex: Vérifie les FDT de cette semaine..."
              disabled={loading}
            />
            <button onClick={() => send()} disabled={loading}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </>
  );
}
