import React, { useEffect, useMemo, useState } from 'react';

const fmtMoney = (value) =>
  new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const fmtNumber = (value) =>
  new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const DEFAULT_COMPANY = '254981';

function buildDownload(base64Content, mimeType, filename) {
  const binary = atob(base64Content || '');
  const buffer = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    buffer[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename || 'export';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
}

export default function BillingPayrollTab({
  apiFetch,
  employees = [],
  setError,
  setSuccess,
  cardStyle,
  sectionTitleStyle,
  buttonStyle,
  inputStyle,
  tableStyle,
  thStyle,
  tdStyle,
}) {
  const todayIso = new Date().toISOString().split('T')[0];
  const [periodStart, setPeriodStart] = useState(todayIso);
  const [periodEnd, setPeriodEnd] = useState(todayIso);
  const [companyId, setCompanyId] = useState(DEFAULT_COMPANY);
  const [regenerate, setRegenerate] = useState(false);
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState('');
  const [recentBatches, setRecentBatches] = useState([]);

  const companyOptions = useMemo(() => {
    const values = new Set();
    values.add(DEFAULT_COMPANY);
    for (const employee of employees || []) {
      const company = String(employee?.payroll_company || '').trim();
      if (company) values.add(company);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  const runPreview = async () => {
    try {
      setLoadingPreview(true);
      setError?.('');
      const data = await apiFetch('/payroll/desjardins/preview', {
        method: 'POST',
        body: JSON.stringify({
          periodStart,
          periodEnd,
          companyId: companyId || null,
          regenerate,
        }),
      });
      setPreview(data);
      setRecentBatches(data?.recent_batches || []);
      setSuccess?.('Apercu paie mis a jour');
    } catch (error) {
      setError?.(error.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  const exportPayroll = async (format) => {
    try {
      setExporting(format);
      setError?.('');
      const data = await apiFetch('/payroll/desjardins/export', {
        method: 'POST',
        body: JSON.stringify({
          periodStart,
          periodEnd,
          companyId: companyId || null,
          regenerate,
          exportFormat: format,
        }),
      });
      buildDownload(data.content, data.mimeType, data.filename);
      setPreview(data.preview || preview);
      try {
        const batches = await apiFetch('/payroll/desjardins/batches');
        setRecentBatches(batches || []);
      } catch (_) {
        // Keep the previous list if the refresh fails.
      }
      setSuccess?.(`Export ${String(format).toUpperCase()} genere`);
    } catch (error) {
      setError?.(error.message);
    } finally {
      setExporting('');
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadRecentBatches = async () => {
      try {
        const data = await apiFetch('/payroll/desjardins/batches');
        if (!cancelled) setRecentBatches(data || []);
      } catch (_) {
        if (!cancelled) setRecentBatches([]);
      }
    };
    loadRecentBatches();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = preview?.stats || {};
  const rows = preview?.rows || [];
  const statsCards = [
    ['Employes exportes', stats.employee_count || 0, false],
    ['Heures regulieres', stats.total_regular_hours, false],
    ['Heures formation', stats.total_training_hours, false],
    ['Temps et demi', stats.total_overtime_hours, false],
    ['Lignes export', stats.row_count || 0, false],
    ['Kilometrage', stats.total_km, false],
    ['Depenses', stats.total_expenses, true],
    ['Perdiem', stats.total_perdiem, true],
    ['Heures garde', stats.total_garde_hours, false],
    ['Heures rappel', stats.total_rappel_hours, false],
  ];

  return (
    <div style={cardStyle}>
      <div style={{ ...sectionTitleStyle, marginBottom: 16 }}>Paie Desjardins / EmployeurD</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Debut periode</div>
          <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Fin periode</div>
          <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Compagnie</div>
          <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} style={{ ...inputStyle, width: '100%' }}>
            {companyOptions.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
          <input type="checkbox" checked={regenerate} onChange={(event) => setRegenerate(event.target.checked)} />
          Regenerer meme si deja exporte
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button style={buttonStyle('primary')} onClick={runPreview} disabled={loadingPreview}>
          {loadingPreview ? 'Analyse...' : 'Generer paie Desjardins'}
        </button>
        <button style={buttonStyle('outline')} onClick={() => exportPayroll('xlsx')} disabled={exporting === 'xlsx'}>
          {exporting === 'xlsx' ? 'Generation XLSX...' : 'Telecharger XLSX'}
        </button>
        <button style={buttonStyle('outline')} onClick={() => exportPayroll('csv')} disabled={exporting === 'csv'}>
          {exporting === 'csv' ? 'Generation CSV...' : 'Telecharger CSV'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        {statsCards.map(([label, value, isMoney]) => (
          <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {isMoney ? fmtMoney(value) : fmtNumber(value)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18, fontSize: 12, color: '#64748b' }}>
        Les heures de garde et de rappel sont visibles dans l&apos;apercu seulement. Elles ne sont pas exportees dans cette V1.
      </div>

      {preview?.skipped_profiles?.length ? (
        <div style={{ marginBottom: 18, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Profils paie incomplets</div>
          {preview.skipped_profiles.map((item) => (
            <div key={`${item.employee_id}-${item.week_start}`} style={{ fontSize: 12, marginBottom: 4 }}>
              <div>{item.employee_name}</div>
              <div style={{ color: '#9a3412' }}>
                {item.messages?.length
                  ? item.messages.join(' ')
                  : `Champs manquants: ${(item.missing_fields || []).join(', ')}`}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {preview?.ignored_unmapped?.length ? (
        <div style={{ marginBottom: 18, background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Quantites visibles mais non exportees dans cette version</div>
          {preview.ignored_unmapped.map((item) => (
            <div key={item.field} style={{ fontSize: 12 }}>
              {item.label}
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ fontWeight: 700, marginBottom: 10 }}>Apercu des lignes exportables</div>
      {rows.length === 0 ? (
        <div style={{ padding: 20, color: '#64748b', background: '#f8fafc', borderRadius: 10 }}>
          Aucune ligne exportable pour cette periode.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', marginBottom: 20 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Compagnie</th>
                <th style={thStyle}>Matricule</th>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Quantite</th>
                <th style={thStyle}>Taux</th>
                <th style={thStyle}>Montant</th>
                <th style={thStyle}>Semaine</th>
                <th style={thStyle}>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.company || 'company'}-${row.matricule || 'mat'}-${row.payroll_code || 'code'}-${index}`}>
                  <td style={tdStyle}>{row.company || ''}</td>
                  <td style={tdStyle}>{row.matricule || ''}</td>
                  <td style={tdStyle}>{row.payroll_code || ''}</td>
                  <td style={tdStyle}>{row.quantity == null ? '' : fmtNumber(row.quantity)}</td>
                  <td style={tdStyle}>{row.rate == null ? '' : fmtNumber(row.rate)}</td>
                  <td style={tdStyle}>{row.amount == null ? '' : fmtMoney(row.amount)}</td>
                  <td style={tdStyle}>{row.week_number || ''}</td>
                  <td style={tdStyle}>{row.transaction_date || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontWeight: 700, marginBottom: 10 }}>Batches recents</div>
      {recentBatches.length === 0 ? (
        <div style={{ padding: 20, color: '#64748b', background: '#f8fafc', borderRadius: 10 }}>
          Aucun export paie journalise pour l&apos;instant.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Periode</th>
                <th style={thStyle}>Format</th>
                <th style={thStyle}>Compagnie</th>
                <th style={thStyle}>Lignes</th>
                <th style={thStyle}>Employes</th>
                <th style={thStyle}>Genere par</th>
              </tr>
            </thead>
            <tbody>
              {recentBatches.map((batch) => (
                <tr key={batch.id}>
                  <td style={tdStyle}>{batch.created_at ? new Date(batch.created_at).toLocaleString('fr-CA') : '-'}</td>
                  <td style={tdStyle}>{batch.period_start} au {batch.period_end}</td>
                  <td style={tdStyle}>{String(batch.export_format || '').toUpperCase()}</td>
                  <td style={tdStyle}>{batch.company_filter || 'Toutes'}</td>
                  <td style={tdStyle}>{batch.line_count}</td>
                  <td style={tdStyle}>{batch.employee_count}</td>
                  <td style={tdStyle}>{batch.generated_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
