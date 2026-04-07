import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, ShieldAlert } from 'lucide-react';
import { fmtMoney } from '../utils/helpers';

const LEVEL_STYLES = {
  faible: { bg: '#FEE2E2', text: '#991B1B', label: 'Faible' },
  moyen: { bg: '#FEF3C7', text: '#92400E', label: 'Moyen' },
  eleve: { bg: '#DCFCE7', text: '#166534', label: 'Eleve' },
};

const FLAG_LABELS = {
  client_a_confirmer: 'Client a confirmer',
  fdt_manquante: 'FDT manquante',
  fdt_sans_piece_jointe: 'FDT sans piece jointe',
  signature_a_verifier: 'Signature a verifier',
  ecart_horaire_fdt: 'Ecart horaire vs FDT',
  orientation_a_verifier: 'Orientation a verifier',
  frais_sans_note: 'Frais sans note',
  hebergement_sans_facture: 'Hebergement sans facture',
  fdt_non_jointe_a_facture: 'FDT non jointe a la facture',
  hebergement_non_joint_a_facture: 'Hebergement non joint a la facture',
  facture_sans_piece_jointe: 'Facture sans piece jointe',
  ecart_facture_fdt: 'Ecart facture vs FDT',
};

function scorePercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function queueItemIcon(level) {
  if (level === 'faible') return <ShieldAlert size={15} />;
  if (level === 'moyen') return <AlertTriangle size={15} />;
  return <CheckCircle2 size={15} />;
}

export default function WeeklyValidationQueue({
  queue,
  loading,
  onOpenItem,
}) {
  const items = queue?.items || [];
  const counts = queue?.counts || { eleve: 0, moyen: 0, faible: 0 };

  const grouped = useMemo(() => ({
    faible: items.filter((item) => item.confidence_level === 'faible'),
    moyen: items.filter((item) => item.confidence_level === 'moyen'),
    eleve: items.filter((item) => item.confidence_level === 'eleve'),
  }), [items]);

  return (
    <div className="card" style={{ marginBottom: 16, border: '1px solid #dce9ed', background: 'linear-gradient(180deg, #f8fbfc 0%, #ffffff 100%)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: 'var(--brand-d)' }}>
            <ClipboardList size={16} />
            Conciliation hebdomadaire / A valider
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
            Classement automatique par confiance. Les dossiers a risque remontent en premier.
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
          {queue?.week_start ? `Semaine du ${queue.week_start} au ${queue.week_end}` : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
        {['faible', 'moyen', 'eleve'].map((level) => {
          const style = LEVEL_STYLES[level];
          return (
            <div key={level} style={{ background: style.bg, color: style.text, borderRadius: 12, padding: '12px 14px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', opacity: 0.8 }}>{style.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{counts[level] || 0}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>dossier(s)</div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)' }}>Chargement de la file de validation...</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)' }}>Aucun dossier a valider pour cette semaine.</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {['faible', 'moyen', 'eleve'].map((level) => {
            const rows = grouped[level];
            if (!rows.length) return null;
            const style = LEVEL_STYLES[level];
            return (
              <div key={level}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: style.text }}>
                  {queueItemIcon(level)}
                  <strong>{style.label}</strong>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {rows.map((item) => (
                    <div key={`${item.employee_id}-${item.client_id || 'none'}`} style={{ border: '1px solid #e3ecef', borderRadius: 12, background: '#fff', padding: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{item.employee_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {item.client_name} • {item.shift_count} quart(s)
                            {item.orientation_shift_count > 0 ? ` • ${item.orientation_shift_count} orientation` : ''}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span className="badge" style={{ background: style.bg, color: style.text }}>
                            Confiance {scorePercent(item.confidence_score)}
                          </span>
                          <button className="btn btn-outline btn-sm" onClick={() => onOpenItem?.(item)}>
                            Ouvrir details
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 10, fontSize: 11 }}>
                        <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
                          <div style={{ color: 'var(--text3)' }}>Horaire</div>
                          <strong>{Number(item.scheduled_hours || 0).toFixed(2)} h</strong>
                        </div>
                        <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
                          <div style={{ color: 'var(--text3)' }}>FDT</div>
                          <strong>{item.timesheet_id ? `${Number(item.timesheet_hours || 0).toFixed(2)} h` : 'Manquante'}</strong>
                        </div>
                        <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
                          <div style={{ color: 'var(--text3)' }}>Facture</div>
                          <strong>{item.invoice_id ? `${item.invoice_number || 'Brouillon'} • ${fmtMoney(item.invoice_total || 0)}` : 'Non generee'}</strong>
                        </div>
                        <div style={{ background: '#f7fafb', borderRadius: 10, padding: '8px 10px' }}>
                          <div style={{ color: 'var(--text3)' }}>Hebergement / frais</div>
                          <strong>{fmtMoney(item.accommodation_amount || 0)} • {Number(item.total_km || 0).toFixed(0)} km • {Number(item.total_deplacement_hours || 0).toFixed(2)} h dep.</strong>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                        {(item.flags || []).map((flag) => (
                          <span key={flag} className="badge" style={{ background: '#f1f5f7', color: '#36505a' }}>
                            {FLAG_LABELS[flag] || flag}
                          </span>
                        ))}
                      </div>

                      {!!item.recommendations?.length && (
                        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <FileText size={12} />
                            <strong>Prochaine action</strong>
                          </div>
                          <div>{item.recommendations[0]}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
