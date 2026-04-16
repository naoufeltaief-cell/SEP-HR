const API_BASE = import.meta.env.VITE_API_URL || '/api';

function formatApiErrorDetail(detail, fallback = 'Erreur reseau') {
  const fallbackText = String(fallback || 'Erreur reseau').trim();

  if (detail == null) return fallbackText;

  if (typeof detail === 'string') {
    const clean = detail.trim();
    return clean || fallbackText;
  }

  if (Array.isArray(detail)) {
    const clean = detail
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object') return String(item || '').trim();

        const message = String(
          item.msg || item.message || item.detail || '',
        ).trim();
        const location = Array.isArray(item.loc)
          ? item.loc.filter((part) => part !== 'body').join('.')
          : '';

        if (location && message) return `${location}: ${message}`;
        if (message) return message;

        try {
          return JSON.stringify(item);
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join(' | ')
      .trim();

    return clean || fallbackText;
  }

  if (typeof detail === 'object') {
    const nested = detail.detail || detail.message || detail.error;
    if (nested && nested !== detail) {
      return formatApiErrorDetail(nested, fallbackText);
    }

    try {
      return JSON.stringify(detail);
    } catch {
      return fallbackText;
    }
  }

  return String(detail).trim() || fallbackText;
}

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('sep_token') || null;
    this.user = JSON.parse(localStorage.getItem('sep_user') || 'null');
  }

  setAuth(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('sep_token', token);
    localStorage.setItem('sep_user', JSON.stringify(user));
  }

  clearAuth() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('sep_token');
    localStorage.removeItem('sep_user');
  }

  isAuthenticated() { return !!this.token; }
  isAdmin() { return this.user?.role === 'admin'; }

  async requestRaw(path, options = {}) {
    const headers = { ...options.headers };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (resp.status === 401) {
      this.clearAuth();
      window.location.href = '/';
      throw new Error('Session expirée');
    }
    if (!resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      let detail = '';
      if (contentType.includes('application/json')) {
        const err = await resp.json().catch(() => null);
        detail = formatApiErrorDetail(err?.detail, `Erreur ${resp.status}`);
      } else {
        const text = await resp.text().catch(() => '');
        detail = formatApiErrorDetail(text, `Erreur ${resp.status}`);
      }
      throw new Error(detail || `Erreur ${resp.status}`);
    }
    return resp;
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const resp = await this.requestRaw(path, { ...options, headers });
    if (resp.status === 204) return null;
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return resp;
    return resp.json();
  }

  get(path) { return this.request(path); }
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); }
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); }
  del(path) { return this.request(path, { method: 'DELETE' }); }
  postForm(path, formData) { return this.requestRaw(path, { method: 'POST', body: formData }).then(resp => resp.json()); }
  download(path) { return this.requestRaw(path); }
  async openProtectedFile(path, fallbackFilename = 'document') {
    const resp = await this.requestRaw(path, { headers: { Accept: '*/*' } });
    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');

    if (!opened) {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = fallbackFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
  }
  async downloadProtectedFile(path, fallbackFilename = 'document') {
    const resp = await this.requestRaw(path, { headers: { Accept: '*/*' } });
    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fallbackFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
  }

  login(email, password) { return this.post('/auth/login', { email, password }); }
  requestMagicLink(email) { return this.post('/auth/magic-link', { email }); }
  verifyMagicLink(token) { return this.post(`/auth/magic-verify?token=${token}`, {}); }
  requestPasswordReset(email) { return this.post('/auth/forgot-password', { email }); }
  getPasswordTokenInfo(token) { return this.get(`/auth/password-token-info?token=${encodeURIComponent(token)}`); }
  completePasswordToken(token, password) { return this.post('/auth/complete-password', { token, password }); }
  getGoogleLoginStatus() { return this.get('/auth/google/status'); }
  startGoogleLogin() { return this.get('/auth/google/start'); }
  register(data) { return this.post('/auth/register', data); }
  getMe() { return this.get('/auth/me'); }

  getEmployees(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/employees/${qs ? '?' + qs : ''}`);
  }
  getEmployee(id) { return this.get(`/employees/${id}`); }
  createEmployee(data) { return this.post('/employees/', data); }
  updateEmployee(id, data) { return this.put(`/employees/${id}`, data); }
  deactivateEmployee(id) { return this.post(`/employees/${id}/deactivate`, {}); }
  reactivateEmployee(id) { return this.post(`/employees/${id}/reactivate`, {}); }
  inviteEmployeeAccess(id) { return this.post(`/employees/${id}/invite-access`, {}); }
  addEmployeeNote(id, data) { return this.post(`/employees/${id}/notes`, data); }
  getEmployeeDocuments(id) { return this.get(`/employees/${id}/documents`); }
  async uploadEmployeeDocument(id, file, category = 'document', description = '', visibleToEmployee = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('visible_to_employee', String(Boolean(visibleToEmployee)));
    formData.append('uploaded_by', this.user?.email || 'admin');
    return this.postForm(`/employees/${id}/documents`, formData);
  }
  async replaceEmployeeDocument(id, docId, file, category = 'document', description = '', visibleToEmployee = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('visible_to_employee', String(Boolean(visibleToEmployee)));
    formData.append('uploaded_by', this.user?.email || 'admin');
    return this.requestRaw(`/employees/${id}/documents/${docId}/replace`, { method: 'PUT', body: formData }).then(resp => resp.json());
  }
  deleteEmployeeDocument(id, docId) { return this.del(`/employees/${id}/documents/${docId}`); }
  downloadEmployeeDocument(id, docId, fallbackFilename = 'document') {
    return this.downloadProtectedFile(`/employees/${id}/documents/${docId}`, fallbackFilename);
  }

  getSchedules(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedules/${qs ? '?' + qs : ''}`); }
  createSchedule(data) { return this.post('/schedules/', data); }
  updateSchedule(id, data) { return this.put(`/schedules/${id}`, data); }
  deleteSchedule(id) { return this.del(`/schedules/${id}`); }
  getScheduleCatalogItems(kind = '') {
    const qs = new URLSearchParams(kind ? { kind } : {}).toString();
    return this.get(`/schedule-catalogs/${qs ? '?' + qs : ''}`);
  }
  createScheduleCatalogItem(kind, label, hourlyRate = 0, billableRate = 0) {
    return this.post('/schedule-catalogs/', {
      kind,
      label,
      hourly_rate: Number(hourlyRate || 0),
      billable_rate: Number(billableRate || 0),
    });
  }
  updateScheduleCatalogItem(id, data) {
    return this.put(`/schedule-catalogs/${id}`, data);
  }
  publishAll() { return this.post('/schedules/publish-all', {}); }
  bulkUpdateSchedulesStatus(ids, status, confirm = true) {
    return this.post('/schedules/bulk-status', { ids, status, confirm });
  }
  bulkDeleteSchedules(ids, confirm = true) {
    return this.post('/schedules/bulk-delete', { ids, confirm });
  }
  approveWeek(data) { return this.post('/schedules/approve-week', data); }
  revokeWeek(data) { return this.post('/schedules/revoke-week', data); }
  getApprovals(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedules/approvals${qs ? '?' + qs : ''}`); }
  getScheduleReviews(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedule-reviews/${qs ? '?' + qs : ''}`); }
  getWeeklyValidationQueue(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedule-reviews/reconciliation-queue${qs ? '?' + qs : ''}`); }
  reviewWeek(data) { return this.post('/schedule-reviews/review-week', data); }
  approveReviewedWeek(data) { return this.post('/schedule-reviews/approve-week', data); }
  revokeReviewedWeek(data) { return this.post('/schedule-reviews/revoke-week', data); }
  async uploadScheduleReviewAttachment(reviewId, file, category = 'justificatif', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    return this.postForm(`/schedule-reviews/${reviewId}/attachments`, formData);
  }
  getScheduleReviewAttachments(reviewId) { return this.get(`/schedule-reviews/${reviewId}/attachments`); }
  deleteScheduleReviewAttachment(reviewId, attId) { return this.del(`/schedule-reviews/${reviewId}/attachments/${attId}`); }
  openScheduleReviewAttachment(reviewId, attId, fallbackFilename = 'justificatif') {
    return this.openProtectedFile(`/schedule-reviews/${reviewId}/attachments/${attId}`, fallbackFilename);
  }
  generateFromSchedules(data) { return this.post('/invoices-approved/generate-from-approved-schedules', data); }
  generateAllApprovedInvoices(data) { return this.post('/invoices-approved/generate-all-approved-schedules', data); }

  getTimesheets(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/timesheets/${qs ? '?' + qs : ''}`); }
  submitTimesheet(data) { return this.post('/timesheets/', data); }
  async submitTimesheetWithAttachment(data, file) {
    const formData = new FormData();
    formData.append('payload', JSON.stringify(data));
    formData.append('file', file);
    return this.postForm('/timesheets/submit-with-attachment', formData);
  }
  approveTimesheet(id) { return this.put(`/timesheets/${id}/approve`, {}); }
  rejectTimesheet(id) { return this.put(`/timesheets/${id}/reject`, {}); }
  deleteTimesheet(id) { return this.del(`/timesheets/${id}`); }
  async uploadTimesheetAttachment(timesheetId, file, category = 'fdt', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', this.user?.email || 'system');
    return this.postForm(`/timesheets/${timesheetId}/attachments`, formData);
  }
  getTimesheetAttachments(timesheetId) { return this.get(`/timesheets/${timesheetId}/attachments`); }
  deleteTimesheetAttachment(timesheetId, attId) { return this.del(`/timesheets/${timesheetId}/attachments/${attId}`); }
  getTimesheetAttachmentUrl(timesheetId, attId) { return `${API_BASE}/timesheets/${timesheetId}/attachments/${attId}`; }
  openTimesheetAttachment(timesheetId, attId, fallbackFilename = 'fdt') {
    return this.openProtectedFile(`/timesheets/${timesheetId}/attachments/${attId}`, fallbackFilename);
  }

  getInvoices(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/invoices/${qs ? '?' + qs : ''}`); }
  getInvoice(id) { return this.get(`/invoices/${id}`); }
  createInvoice(data) { return this.post('/invoices/', data); }
  updateInvoice(id, data) { return this.put(`/invoices/${id}`, data); }
  markPaid(id) { return this.put(`/invoices/${id}/paid`, {}); }
  deleteInvoice(id) { return this.del(`/invoices/${id}`); }
  duplicateInvoice(id) { return this.post(`/invoices/${id}/duplicate`, {}); }
  markUnpaid(id) { return this.put(`/invoices/${id}/unpaid`, {}); }
  cancelInvoice(id) { return this.put(`/invoices/${id}/cancel`, {}); }

  async uploadAttachment(invoiceId, file, category = 'autre', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    return this.postForm(`/invoices/${invoiceId}/attachments`, formData);
  }
  getAttachments(invoiceId) { return this.get(`/invoices/${invoiceId}/attachments`); }
  deleteAttachment(invoiceId, attId) { return this.del(`/invoices/${invoiceId}/attachments/${attId}`); }
  getAttachmentUrl(invoiceId, attId) { return `${API_BASE}/invoices/${invoiceId}/attachments/${attId}`; }
  getPdfWithAttachments(invoiceId, include = true) { return `${API_BASE}/invoices/${invoiceId}/pdf-with-attachments?include_attachments=${include}`; }

  getAccommodations() { return this.get('/accommodations/'); }
  createAccommodation(data) { return this.post('/accommodations/', data); }
  updateAccommodation(id, data) { return this.put(`/accommodations/${id}`, data); }
  deleteAccommodation(id) { return this.del(`/accommodations/${id}`); }
  async uploadAccommodationAttachment(accommodationId, file, category = 'hebergement', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    return this.postForm(`/accommodations/${accommodationId}/attachments`, formData);
  }
  getAccommodationAttachments(accommodationId) { return this.get(`/accommodations/${accommodationId}/attachments`); }
  deleteAccommodationAttachment(accommodationId, attId) { return this.del(`/accommodations/${accommodationId}/attachments/${attId}`); }
  getAccommodationAttachmentUrl(accommodationId, attId) { return `${API_BASE}/accommodations/${accommodationId}/attachments/${attId}`; }
  openAccommodationAttachment(accommodationId, attId, fallbackFilename = 'hebergement') {
    return this.openProtectedFile(`/accommodations/${accommodationId}/attachments/${attId}`, fallbackFilename);
  }

  getClients() { return this.get('/clients/'); }
  createClient(data) { return this.post('/clients/', data); }
  updateClient(id, data) { return this.put(`/clients/${id}`, data); }

  chat(message, history = [], sessionId = '') {
    return this.post('/chatbot/chat', { message, history, session_id: sessionId });
  }
  async uploadChatbotDocuments(sessionId, files, description = '') {
    const formData = new FormData();
    formData.append('session_id', sessionId);
    formData.append('description', description);
    Array.from(files || []).forEach(file => formData.append('files', file));
    return this.postForm('/chatbot/uploads', formData);
  }
  getChatbotDocuments(sessionId) {
    const qs = new URLSearchParams({ session_id: sessionId }).toString();
    return this.get(`/chatbot/uploads?${qs}`);
  }
  deleteChatbotDocument(uploadId) {
    return this.del(`/chatbot/uploads/${uploadId}`);
  }
  openChatbotDocument(uploadId, fallbackFilename = 'document') {
    return this.openProtectedFile(`/chatbot/uploads/${uploadId}`, fallbackFilename);
  }
}

export const api = new ApiClient();
export default api;
