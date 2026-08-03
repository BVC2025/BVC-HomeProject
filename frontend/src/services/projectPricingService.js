import API from "./api";

const VENDOR_ID = 1;

export const projectPricingService = {
  getAll: (params = {}) => {
    const qs = new URLSearchParams({ vendor_id: VENDOR_ID, ...params }).toString();
    return API.get(`/project-pricing?${qs}`);
  },

  getOne: (id) =>
    API.get(`/project-pricing/${id}`),

  create: (data) =>
    API.post("/project-pricing", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/project-pricing/${id}`, data),

  remove: (id) =>
    API.delete(`/project-pricing/${id}`),

  bulkUpload: (formData) =>
    API.post(`/project-pricing/bulk-upload?vendor_id=${VENDOR_ID}`, formData),
};
