import API from "./api";

const VENDOR_ID = 1;

const NUMERIC_FIELDS = [
  "YEARS_IN_BUSINESS", "ANNUAL_TURNOVER", "EMPLOYEE_COUNT",
  "ADVANCE_PERCENT", "CREDIT_DAYS", "MINIMUM_ORDER_VALUE", "LEAD_TIME_DAYS",
];

function _sanitize(data) {
  const out = { ...data };
  for (const key of NUMERIC_FIELDS) {
    if (key in out && (out[key] === "" || out[key] === undefined)) {
      out[key] = null;
    }
  }
  return out;
}

export const supplierManagementService = {
  // ── Suppliers ────────────────────────────────────────────────────────
  getAll: () =>
    API.get(`/suppliers?vendor_id=${VENDOR_ID}`),

  create: (data) => {
    const payload = _sanitize(data);
    if (!payload.SUPPLIER_CODE) {
      payload.SUPPLIER_CODE = `SUP-${Date.now()}`;
    }
    return API.post("/suppliers", { ...payload, VENDOR_ID });
  },

  update: (id, data) =>
    API.patch(`/suppliers/${id}`, _sanitize(data)),

  deleteSupplier: (id) =>
    API.delete(`/suppliers/${id}`),

  getPerformance: (id) =>
    API.get(`/suppliers/${id}/performance`),

  getSupplierProducts: (id) =>
    API.get(`/suppliers/${id}/products`),

  updateSupplierProduct: (spId, data, vendorId = VENDOR_ID) =>
    API.patch(`/api/supplier-products/${spId}`, data, { params: { vendor_id: vendorId } }),

  addSupplierProduct: (data) =>
    API.post("/api/supplier-products", data),

  getCategories: (vendorId = VENDOR_ID) =>
    API.get("/api/inventory-categories", { params: { vendor_id: vendorId, is_active: true } }),

  getProductsByCategory: (vendorId = VENDOR_ID, categoryId) =>
    API.get("/api/products", {
      params: { vendor_id: vendorId, category_id: categoryId, status: "ACTIVE", page_size: 5000 },
    }),

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
    API.post(`/api/supplier-onboarding/invitations/${id}/approve`, {}),

  rejectSupplier: (id, data) =>
    API.post(`/api/supplier-onboarding/invitations/${id}/reject`, data),

  deleteInvitation: (id) =>
    API.delete(`/api/supplier-onboarding/invitations/${id}`),
};
