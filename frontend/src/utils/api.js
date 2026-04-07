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

  isAuthenticated() { return !!this.token; }
  isAdmin() { return this.user?.role === 'admin'; }

  async requestRaw(path, options = {}) {
    const headers = { ...options.headers };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (resp.status === 401) {
      this.clearAuth();
      window.location.href = '/login';
      throw new Error('Session expirée');
    }
    if (!resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      let detail = '';
      if (contentType.includes('application/json')) {
        const err = await resp.json().catch(() => null);
        detail = err?.detail || '';
      } else {
        detail = await resp.text().catch(() => '');
      }
      throw new Error((detail || `Erreur ${resp.status}`).trim());
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

  login(email, password) { return this.post('/auth/login', { email, password }); }
  requestMagicLink(email) { return this.post('/auth/magic-link', { email }); }
  verifyMagicLink(token) { return this.post(`/auth/magic-verify?token=${token}`, {}); }
  register(data) { return this.post('/auth/register', data); }
  getMe() { return this.get('/auth/me'); }

  getEmployees() { return this.get('/employees/'); }
  getEmployee(id) { return this.get(`/employees/${id}`); }
  createEmployee(data) { return this.post('/employees/', data); }
  updateEmployee(id, data) { return this.put(`/employees/${id}`, data); }
  addEmployeeNote(id, data) { return this.post(`/employees/${id}/notes`, data); }

  getSchedules(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedules/${qs ? '?' + qs : ''}`); }
  createSchedule(data) { return this.post('/schedules/', data); }
  updateSchedule(id, data) { return this.put(`/schedules/${id}`, data); }
  deleteSchedule(id) { return this.del(`/schedules/${id}`); }
  publishAll() { return this.post('/schedules/publish-all', {}); }
  approveWeek(data) { return this.post('/schedules/approve-week', data); }
  revokeWeek(data) { return this.post('/schedules/revoke-week', data); }
  getApprovals(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedules/approvals${qs ? '?' + qs : ''}`); }
  getScheduleReviews(params = {}) { const qs = new URLSearchParams(params).toString(); return this.get(`/schedule-reviews/${qs ? '?' + qs : ''}`); }
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
  generateFromSchedules(data) { return this.post('/invoices-approved/generate-from-approved-schedules', data); }
  generateAllApprovedInvoices(data) { return this.post('/invoices-approved/generate-all-approved-schedules', data); }

  getTimesheets() { return this.get('/timesheets/'); }
  submitTimesheet(data) { return this.post('/timesheets/', data); }
  approveTimesheet(id) { return this.put(`/timesheets/${id}/approve`, {}); }
  rejectTimesheet(id) { return this.put(`/timesheets/${id}/reject`, {}); }
  deleteTimesheet(id) { return this.del(`/timesheets/${id}`); }
  async uploadTimesheetAttachment(timesheetId, file, category = 'fdt', description = '') {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);
    formData.append('description', description);
    formData.append('uploaded_by', 'admin');
    return this.postForm(`/timesheets/${timesheetId}/attachments`, formData);
  }
  getTimesheetAttachments(timesheetId) { return this.get(`/timesheets/${timesheetId}/attachments`); }
  deleteTimesheetAttachment(timesheetId, attId) { return this.del(`/timesheets/${timesheetId}/attachments/${attId}`); }
  getTimesheetAttachmentUrl(timesheetId, attId) { return `${API_BASE}/timesheets/${timesheetId}/attachments/${attId}`; }

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

  getClients() { return this.get('/clients/'); }
  createClient(data) { return this.post('/clients/', data); }
  updateClient(id, data) { return this.put(`/clients/${id}`, data); }

  chat(message, history = []) { return this.post('/chatbot/chat', { message, history }); }
}

export const api = new ApiClient();
export default api;
