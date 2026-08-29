import API from "./api";

const VENDOR_ID = 1;

export const customerPaymentService = {
  getByCustomer: (customerId) =>
    API.get(`/customer-payments/by-customer/${customerId}`, { params: { vendor_id: VENDOR_ID } }),

  addManual: (assignmentId, formData) =>
    API.post(`/customer-payments/${assignmentId}/manual`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  update: (paymentId, formData) =>
    API.put(`/customer-payments/${paymentId}`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  remove: (paymentId) =>
    API.delete(`/customer-payments/${paymentId}`),

  // Authenticated blob fetch — the proof endpoint is RBAC-gated
  // (customer.payments.view_proof) and reads the Authorization header,
  // so it must go through the `API` axios instance (which attaches the
  // Bearer token) rather than a plain <a href> new-tab link.
  fetchProofBlob: (paymentId) =>
    API.get(`/customer-payments/${paymentId}/proof`, { responseType: "blob" }),

  // Staff-maintained project completion percentage — updating it
  // re-evaluates configured Payment Milestones server-side (may trigger a
  // payment-request email and/or place the project on HOLD, or resume one
  // whose outstanding milestones are now satisfied).
  updateCompletion: (assignmentId, percentage) =>
    API.patch(`/customer-payments/assignments/${assignmentId}/completion`, {
      PROJECT_COMPLETION_PERCENTAGE: percentage,
    }),
};
