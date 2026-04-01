const API_BASE = import.meta.env.VITE_API_URL || '/api';

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

  isAuthenticated() {
    return !!this.token;
  }

  isAdmin() {
    return this.user?.role === 'admin';
  }

  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (resp.status === 401) {
      this.clearAuth();
      window.location.href = '/login';
      throw new Error('Session expirée');
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Erreur serveur' }));
      throw new Error(err.detail || `Erreur ${resp.status}`);
    }

    return resp.json();
  }

  get(path) { return this.request(path); }
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); }
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); }
  del(path) { return this.request(path, { method: 'DELETE' }); }

  // Auth
  login(email, password) { return this.post('/auth/login', { email, password }); }
  requestMagicLink(email) { return this.post('/auth/magic-link', { email }); }
  verifyMagicLink(token) { return this.post(`/auth/magic-verify?token=${token}`, {}); }
  register(data) { return this.post('/auth/register', data); }
  getMe() { return this.get('/auth/me'); }

  // Employees
  getEmployees() { return this.get('/employees/'); }
  getEmployee(id) { return this.get(`/employees/${id}`); }
  createEmployee(data) { return this.post('/employees/', data); }
  updateEmployee(id, data) { return this.put(`/employees/${id}`, data); }
  addEmployeeNote(id, data) { return this.post(`/employees/${id}/notes`, data); }

  // Schedules
  getSchedules(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/schedules/${qs ? '?' + qs : ''}`);
  }
  createSchedule(data) { return this.post('/schedules/', data); }
  updateSchedule(id, data) { return this.put(`/schedules/${id}`, data); }
  deleteSchedule(id) { return this.del(`/schedules/${id}`); }
  publishAll() { return this.post('/schedules/publish-all', {}); }
  approveWeek(data) { return this.post('/schedules/approve-week', data); }
  revokeWeek(data) { return this.post('/schedules/revoke-week', data); }
  getApprovals(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/schedules/approvals${qs ? '?' + qs : ''}`);
  }
  getScheduleReviews(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/schedule-reviews/${qs ? '?' + qs : ''}`);
  }
  reviewWeek(data) { return this.post('/schedule-reviews/review-week', data); }
  approveReviewedWeek(data) { return this.post('/schedule-reviews/approve-week', data); }
  revokeReviewedWeek(data) { return this.post('/schedule-reviews/revoke-week', data); }
  async uploadScheduleReviewAttachment(reviewId, file, category = 'justificatif', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const resp = await fetch(`${API_BASE}/schedule-reviews/${reviewId}/attachments`, { method: 'POST', headers, body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Erreur upload' }));
      throw new Error(err.detail || `Erreur ${resp.status}`);
    }
    return resp.json();
  }
  getScheduleReviewAttachments(reviewId) { return this.get(`/schedule-reviews/${reviewId}/attachments`); }
  deleteScheduleReviewAttachment(reviewId, attId) { return this.del(`/schedule-reviews/${reviewId}/attachments/${attId}`); }
  generateFromSchedules(data) { return this.post('/invoices-approved/generate-from-approved-schedules', data); }
  generateAllApprovedInvoices(data) { return this.post('/invoices-approved/generate-all-approved-schedules', data); }

  // Timesheets
  getTimesheets() { return this.get('/timesheets/'); }
  submitTimesheet(data) { return this.post('/timesheets/', data); }
  approveTimesheet(id) { return this.put(`/timesheets/${id}/approve`, {}); }
  rejectTimesheet(id) { return this.put(`/timesheets/${id}/reject`, {}); }
  deleteTimesheet(id) { return this.del(`/timesheets/${id}`); }

  // Invoices
  getInvoices(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get(`/invoices/${qs ? '?' + qs : ''}`);
  }
  getInvoice(id) { return this.get(`/invoices/${id}`); }
  createInvoice(data) { return this.post('/invoices/', data); }
  updateInvoice(id, data) { return this.put(`/invoices/${id}`, data); }
  markPaid(id) { return this.put(`/invoices/${id}/paid`, {}); }
  deleteInvoice(id) { return this.del(`/invoices/${id}`); }
  duplicateInvoice(id) { return this.post(`/invoices/${id}/duplicate`, {}); }
  markUnpaid(id) { return this.put(`/invoices/${id}/unpaid`, {}); }
  cancelInvoice(id) { return this.put(`/invoices/${id}/cancel`, {}); }

  // Invoice Attachments (uses FormData, not JSON)
  async uploadAttachment(invoiceId, file, category = 'autre', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const resp = await fetch(`${API_BASE}/invoices/${invoiceId}/attachments`, {
      method: 'POST', headers, body: formData,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Erreur upload' }));
      throw new Error(err.detail || `Erreur ${resp.status}`);
    }
    return resp.json();
  }
  getAttachments(invoiceId) { return this.get(`/invoices/${invoiceId}/attachments`); }
  deleteAttachment(invoiceId, attId) { return this.del(`/invoices/${invoiceId}/attachments/${attId}`); }
  getAttachmentUrl(invoiceId, attId) {
    return `${API_BASE}/invoices/${invoiceId}/attachments/${attId}`;
  }
  getPdfWithAttachments(invoiceId, include = true) {
    return `${API_BASE}/invoices/${invoiceId}/pdf-with-attachments?include_attachments=${include}`;
  }

  // Accommodations
  getAccommodations() { return this.get('/accommodations/'); }
  createAccommodation(data) { return this.post('/accommodations/', data); }
  deleteAccommodation(id) { return this.del(`/accommodations/${id}`); }

  // Clients
  getClients() { return this.get('/clients/'); }
  createClient(data) { return this.post('/clients/', data); }
  updateClient(id, data) { return this.put(`/clients/${id}`, data); }

  // Chatbot
  chat(message, history = []) { return this.post('/chatbot/chat', { message, history }); }
}

export const api = new ApiClient();
export default api;
