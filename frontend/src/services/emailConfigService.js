import API from "./api";

const VENDOR_ID = 1;

export const emailConfigService = {
  getAll: () =>
    API.get(`/email-configs?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post(`/email-configs?vendor_id=${VENDOR_ID}`, { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/email-configs/${id}`, data),

  remove: (id) =>
    API.delete(`/email-configs/${id}`),

  activate: (id) =>
    API.post(`/email-configs/${id}/activate?vendor_id=${VENDOR_ID}`),

  deactivate: (id) =>
    API.post(`/email-configs/${id}/deactivate`),

  downloadTemplate: () =>
    API.get("/email-configs/bulk-upload/template", { responseType: "blob" }),

  bulkUpload: (formData) =>
    API.post(`/email-configs/bulk-upload?vendor_id=${VENDOR_ID}`, formData),

  exportExcel: () =>
    API.get(`/email-configs/export/excel?vendor_id=${VENDOR_ID}`, { responseType: "blob" }),
};
