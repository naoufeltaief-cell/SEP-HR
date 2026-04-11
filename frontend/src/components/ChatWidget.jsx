import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FileText, Paperclip, Send, Trash2, X, Zap } from 'lucide-react';
import api from '../utils/api';

const QUICK_ACTIONS = [
  { icon: '📧', label: 'Voir courriels recents', msg: 'Montre-moi les courriels recents recus' },
  { icon: '📊', label: 'Resume facturation', msg: 'Donne-moi un resume de la facturation: factures impayees, en retard, totaux' },
  { icon: '📋', label: 'Verifier FDT', msg: 'Verifie les feuilles de temps recues par courriel cette semaine et compare avec les horaires planifies' },
  { icon: '🗓', label: 'Modifier horaire', msg: 'Je veux modifier un quart dans l horaire' },
  { icon: '🏨', label: 'Ajouter hebergement', msg: 'Ajoute un hebergement pour un employe' },
  { icon: '🧾', label: 'Generer facture', msg: 'Genere une facture pour un employe sur une periode' },
];

const INITIAL_MESSAGE = {
  role: 'bot',
  text:
    "👋 Bonjour! Je suis l'assistant Soins Expert Plus.\n\n" +
    "Je peux vous aider avec:\n\n" +
    "🧾 **Facturation** - FDT, factures, conciliation\n" +
    "👥 **Recrutement** - Candidats, besoins clients, assignations\n" +
    "📧 **Courriels** - Lire, repondre, envoyer\n" +
    "📎 **Documents** - Joindre une FDT, une facture d'hebergement ou un autre fichier a une facture ou a un courriel\n" +
    "📊 **Rapports** - Taux, paie, statistiques\n\n" +
    "Que puis-je faire pour vous?",
  agent: 'general',
};

function makeChatSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [chatSessionId] = useState(() => makeChatSessionId());
  const messagesEnd = useRef(null);
  const fileInputRef = useRef(null);

  const hasPendingWork = loading || uploading;

  const history = useMemo(
    () =>
      messages
        .filter((m, index) => index > 0)
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
    [messages]
  );

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, uploadedDocs, pendingFiles]);

  useEffect(() => {
    if (!open) return;
    refreshUploadedDocs();
  }, [open]);

  const refreshUploadedDocs = async () => {
    try {
      const docs = await api.getChatbotDocuments(chatSessionId);
      setUploadedDocs(Array.isArray(docs) ? docs : []);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePickFiles = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setPendingFiles(prev => [...prev, ...files]);
    setShowQuickActions(false);
    event.target.value = '';
  };

  const removePendingFile = (index) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const openUploadedDoc = async (doc) => {
    try {
      await api.openChatbotDocument(doc.id, doc.filename || 'document');
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `❌ ${err.message}`, agent: 'error' }]);
    }
  };

  const deleteUploadedDoc = async (doc) => {
    try {
      await api.deleteChatbotDocument(doc.id);
      await refreshUploadedDocs();
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `❌ ${err.message}`, agent: 'error' }]);
    }
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if ((!msg && !pendingFiles.length) || hasPendingWork) return;

    setInput('');
    setShowQuickActions(false);
    if (msg) {
      setMessages(prev => [...prev, { role: 'user', text: msg }]);
    } else if (pendingFiles.length) {
      setMessages(prev => [
        ...prev,
        { role: 'user', text: "J'ai joint de nouveaux documents dans cette conversation." },
      ]);
    }

    setLoading(true);
    try {
      if (pendingFiles.length) {
        setUploading(true);
        await api.uploadChatbotDocuments(chatSessionId, pendingFiles);
        setPendingFiles([]);
        await refreshUploadedDocs();
      }

      const effectiveMessage = msg || "J'ai joint de nouveaux documents dans cette conversation.";
      const res = await api.chat(effectiveMessage, history, chatSessionId);
      await refreshUploadedDocs();
      setMessages(prev => [...prev, { role: 'bot', text: res.reply, agent: res.agent }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', text: `❌ ${err.message}`, agent: 'error' }]);
    } finally {
      setLoading(false);
      setUploading(false);
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
        <div className="chat-panel" style={{ height: 640 }}>
          <div className="chat-header">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Zap size={14} /> Agent IA
              </div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Facturation · Recrutement · Courriels · Documents</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="chat-messages">
            {!!uploadedDocs.length && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 12,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: 'var(--text2)' }}>
                  Documents joints a cette conversation
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {uploadedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'white',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <button
                        onClick={() => openUploadedDoc(doc)}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'none',
                          border: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          color: 'var(--text)',
                        }}
                      >
                        <FileText size={16} color="var(--brand)" />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{doc.filename}</div>
                          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                            {(doc.file_type || '').toUpperCase()} · {(doc.file_size || 0) > 0 ? `${Math.round(doc.file_size / 1024)} Ko` : 'taille inconnue'}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={() => deleteUploadedDoc(doc)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#dc2626',
                        }}
                        title="Retirer ce document"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              const badge = m.agent ? agentBadge(m.agent) : null;
              return (
                <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'bot'}`}>
                  {badge && m.role !== 'user' && (
                    <div style={{ fontSize: 9, color: badge.color, fontWeight: 600, marginBottom: 2, letterSpacing: '.03em' }}>
                      {badge.label}
                    </div>
                  )}
                  <div
                    className="bubble"
                    style={{ whiteSpace: 'pre-wrap' }}
                    dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
                  />
                </div>
              );
            })}

            {(loading || uploading) && (
              <div className="chat-msg bot">
                <div
                  className="bubble"
                  style={{ color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--brand)',
                      animation: 'pulse 1s infinite',
                    }}
                  />
                  {uploading ? 'Televersement des documents...' : 'Analyse en cours...'}
                </div>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {showQuickActions && !hasPendingWork && (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {QUICK_ACTIONS.map((action, index) => (
                <button
                  key={index}
                  onClick={() => send(action.msg)}
                  style={{
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 16,
                    padding: '4px 10px',
                    fontSize: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    color: 'var(--text2)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {action.icon} {action.label}
                </button>
              ))}
            </div>
          )}

          {!!pendingFiles.length && (
            <div style={{ padding: '10px 12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pendingFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 999,
                    fontSize: 11,
                  }}
                >
                  <FileText size={13} color="var(--brand)" />
                  <span>{file.name}</span>
                  <button
                    onClick={() => removePendingFile(index)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text3)' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="chat-input-row" style={{ gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ex: joins cette FDT a la facture de Marjorie..."
              disabled={hasPendingWork}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handlePickFiles}
              style={{ display: 'none' }}
              accept=".pdf,.jpg,.jpeg,.png,.gif,.heic,.heif,.txt,.csv,.doc,.docx,.xls,.xlsx"
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={hasPendingWork} title="Joindre des documents">
              <Paperclip size={16} />
            </button>
            <button onClick={() => send()} disabled={hasPendingWork}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </>
  );
}
