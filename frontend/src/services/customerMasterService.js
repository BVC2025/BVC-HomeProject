import API from "./api";

const VENDOR_ID = 1;

export const customerMasterService = {
  getAll: (params = {}) =>
    API.get("/customer-master", { params: { vendor_id: VENDOR_ID, ...params } }),

  get: (id) =>
    API.get(`/customer-master/${id}`),

  create: (data) =>
    API.post("/customer-master", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/customer-master/${id}?vendor_id=${VENDOR_ID}`, data),

  remove: (id) =>
    API.delete(`/customer-master/${id}`),

  bulkUpload: (formData) =>
    API.post(`/customer-master/bulk-upload?vendor_id=${VENDOR_ID}`, formData),
};
