export const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const MONTHS = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

export const fmtMoney = (n) => (n || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
export const fmtDay = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const fmtISO = (d) => d.toISOString().slice(0, 10);
export const initials = (name) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export const RATE_KM = 0.525;
export const GARDE_RATE = 86.23;
export const TPS_RATE = 0.05;
export const TVQ_RATE = 0.09975;

export function getWeekDates(refDate, offset = 0) {
  const d = new Date(refDate);
  d.setDate(d.getDate() + offset * 7);
  const day = d.getDay();
  const sun = new Date(d);
  sun.setDate(d.getDate() - day);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(sun);
    dd.setDate(sun.getDate() + i);
    dates.push(dd);
  }
  return dates;
}

export function getMonthDates(refDate) {
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const dates = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

export const statusColors = {
  draft: { bg: '#f3f4f6', text: '#6b7280', label: 'Brouillon' },
  published: { bg: '#dbeafe', text: '#1d4ed8', label: 'Publié' },
  submitted: { bg: '#fef3c7', text: '#d97706', label: 'Soumis' },
  approved: { bg: '#d1fae5', text: '#059669', label: 'Approuvé' },
  rejected: { bg: '#fee2e2', text: '#dc2626', label: 'Refusé' },
  invoiced: { bg: '#ede9fe', text: '#7c3aed', label: 'Facturé' },
  sent: { bg: '#ccfbf1', text: '#0d9488', label: 'Envoyée' },
  paid: { bg: '#d1fae5', text: '#059669', label: 'Payée' },
  overdue: { bg: '#fee2e2', text: '#dc2626', label: 'En retard' },
};
