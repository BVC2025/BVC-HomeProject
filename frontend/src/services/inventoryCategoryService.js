import API from "./api";

const VENDOR_ID = 1;

export const inventoryCategoryService = {
  getAll: (search = "") => {
    const qs = search ? `&search=${encodeURIComponent(search)}` : "";
    return API.get(`/api/inventory-categories?vendor_id=${VENDOR_ID}${qs}`);
  },

  create: (data) =>
    API.post("/api/inventory-categories", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/api/inventory-categories/${id}`, data),

  remove: (id) =>
    API.delete(`/api/inventory-categories/${id}`),

  bulkUpload: (formData) =>
    API.post(`/api/inventory-categories/bulk-upload?vendor_id=${VENDOR_ID}`, formData),
};
