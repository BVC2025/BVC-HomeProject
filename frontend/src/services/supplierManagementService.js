import API from "./api";

const VENDOR_ID = 1;

export const supplierManagementService = {
  // ── Suppliers ────────────────────────────────────────────────────────
  getAll: () =>
    API.get(`/suppliers?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post("/suppliers", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/suppliers/${id}`, data),

  getDetails: (id) =>
    API.get(`/suppliers/${id}/details`),

  updateDetails: (id, data) =>
    API.put(`/suppliers/${id}/details`, data),

  getPerformance: (id) =>
    API.get(`/suppliers/${id}/performance`),

  exportExcel: () =>
    API.get("/suppliers/export/excel", { responseType: "blob" }),

  downloadTemplate: () =>
    API.get("/suppliers/bulk-template", { responseType: "blob" }),

  bulkUpload: (formData) =>
    API.post(`/suppliers/bulk-upload?vendor_id=${VENDOR_ID}`, formData),

  // ── Invitations ──────────────────────────────────────────────────────
  getInvitations: () =>
    API.get(`/api/supplier-onboarding/invitations?vendor_id=${VENDOR_ID}`),

  sendInvitation: (data) =>
    API.post("/api/supplier-onboarding/invite", { ...data, VENDOR_ID }),

  resendInvitation: (id) =>
    API.post(`/api/supplier-onboarding/invitations/${id}/resend`),

  expireInvitation: (id) =>
    API.post(`/api/supplier-onboarding/invitations/${id}/expire`),

  getInvitationDetail: (id) =>
    API.get(`/api/supplier-onboarding/invitations/${id}`),

  // ── Pending Approvals ────────────────────────────────────────────────
  getPendingApprovals: () =>
    API.get(`/api/supplier-onboarding/pending-review?vendor_id=${VENDOR_ID}`),

  approveSupplier: (id) =>
    API.post(`/api/supplier-onboarding/invitations/${id}/approve`),

  rejectSupplier: (id, data) =>
    API.post(`/api/supplier-onboarding/invitations/${id}/reject`, data),
};
