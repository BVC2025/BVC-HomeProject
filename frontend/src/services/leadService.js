import API from "./api";

const VENDOR_ID = 1;

export const leadService = {
  getAll: (params = {}) =>
    API.get("/lead-management/leads", { params: { vendor_id: VENDOR_ID, ...params } }),

  get: (id) =>
    API.get(`/lead-management/leads/${id}`),

  create: (data) =>
    API.post(`/lead-management/leads?vendor_id=${VENDOR_ID}`, data),

  update: (id, data) =>
    API.put(`/lead-management/leads/${id}?vendor_id=${VENDOR_ID}`, data),

  convert: (id, body = {}) =>
    API.post(`/lead-management/leads/${id}/convert?vendor_id=${VENDOR_ID}`, body),

  getQuotations: (id) =>
    API.get(`/lead-management/leads/${id}/quotations`),

  getMasterPrice: (id) =>
    API.get(`/lead-management/leads/${id}/master-price`),

  sendRevisedQuote: (id, body) =>
    API.post(`/lead-management/leads/${id}/quotations/revise?vendor_id=${VENDOR_ID}`, body),

  sendPurchaseOrderRequest: (id) =>
    API.post(`/lead-management/leads/${id}/quotations/send-po-request?vendor_id=${VENDOR_ID}`),

  correctQuotationToApproved: (id) =>
    API.post(`/lead-management/leads/${id}/quotations/correct-to-approved?vendor_id=${VENDOR_ID}`),

  getPurchaseOrder: (id) =>
    API.get(`/lead-management/leads/${id}/purchase-order`),

  uploadPurchaseOrder: (id, formData) =>
    API.post(`/lead-management/leads/${id}/po/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  getPayments: (id) =>
    API.get(`/lead-management/leads/${id}/payments`),

  remove: (id) =>
    API.delete(`/lead-management/leads/${id}`),

  bulkUpload: (formData, sheetName = null) => {
    const qs = sheetName ? `?vendor_id=${VENDOR_ID}&sheet_name=${encodeURIComponent(sheetName)}` : `?vendor_id=${VENDOR_ID}`;
    return API.post(`/lead-management/leads/bulk-upload${qs}`, formData);
  },
};
