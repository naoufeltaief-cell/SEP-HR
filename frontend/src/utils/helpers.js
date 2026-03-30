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

/**
 * Calcule les heures nettes d'un quart de travail.
 * Gère les quarts de nuit (ex: 22:00 à 06:00) et déduit les pauses en minutes.
 */
export function calcNetHours(start, end, pauseMinutes = 0) {
  if (!start || !end) return 0;
  const s = new Date(`2000-01-01T${start}:00`);
  let e = new Date(`2000-01-01T${end}:00`);
  if (e <= s) e.setDate(e.getDate() + 1); // Gestion du passage à minuit
  const diffHours = (e - s) / 3600000;
  return Math.max(0, diffHours - (pauseMinutes / 60));
}

/**
 * Vérifie si une facture est en retard (plus de 30 jours).
 */
export function isOverdue(invoiceDate, status) {
  if (status === 'paid') return false;
  const diffDays = (new Date() - new Date(invoiceDate)) / 86400000;
  return diffDays > 30;
}

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
  const last = new Date(y, m + 1, 0);
  const dates = [];
  for (let d = 1; d <= last.getDate(); d++) {
    dates.push(new Date(y, m, d));
  }
  return dates;
}

export const statusColors = {
  draft: { bg: '#EDF2F2', text: '#5F6877', label: 'Brouillon' },
  published: { bg: '#E0F2F4', text: '#2A7B88', label: 'Publié' },
  submitted: { bg: '#FEF3C7', text: '#92400E', label: 'Soumis' },
  approved: { bg: '#DCFCE7', text: '#166534', label: 'Approuvé' },
  rejected: { bg: '#FEE2E2', text: '#991B1B', label: 'Refusé' },
  invoiced: { bg: '#EDE9FE', text: '#5B21B6', label: 'Facturé' },
  sent: { bg: '#CCFBF1', text: '#115E59', label: 'Envoyée' },
  paid: { bg: '#DCFCE7', text: '#166534', label: 'Payée' },
  overdue: { bg: '#FEE2E2', text: '#991B1B', label: 'En retard' },
  cancelled: { bg: '#f3f4f6', text: '#6b7280', label: 'Annulée' },
};
