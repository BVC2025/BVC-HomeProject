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

  remove: (id) =>
    API.delete(`/lead-management/leads/${id}`),

  bulkUpload: (formData, sheetName = null) => {
    const qs = sheetName ? `?vendor_id=${VENDOR_ID}&sheet_name=${encodeURIComponent(sheetName)}` : `?vendor_id=${VENDOR_ID}`;
    return API.post(`/lead-management/leads/bulk-upload${qs}`, formData);
  },
};
