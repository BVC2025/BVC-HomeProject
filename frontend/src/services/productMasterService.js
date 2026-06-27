import API from "./api";

const VENDOR_ID = 1;

export const productMasterService = {
  getAll: (params = {}) =>
    API.get("/api/products", {
      params: { vendor_id: VENDOR_ID, ...params },
    }),

  create: (data) =>
    API.post("/api/products", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/api/products/${id}`, data),

  remove: (id) =>
    API.delete(`/api/products/${id}`),

  getDetail: (id) =>
    API.get(`/api/products/${id}`),

  getSuppliers: (productId) =>
    API.get(`/api/products/${productId}/suppliers`),

  getRecommendation: (productId) =>
    API.get(`/api/products/${productId}/recommendation`),

  setSupplierPrice: (productId, supplierId, data) =>
    API.post(`/api/products/${productId}/suppliers/${supplierId}/price`, data),

  removeSupplierLink: (productId, supplierId) =>
    API.delete(`/api/products/${productId}/suppliers/${supplierId}`),

  getPriceHistory: (productId, supplierId) =>
    API.get(`/api/products/${productId}/suppliers/${supplierId}/history`),

  exportExcel: () =>
    API.get("/api/products/export/excel", { responseType: "blob" }),

  downloadTemplate: () =>
    API.get("/api/products/bulk-template", { responseType: "blob" }),

  bulkUpload: (formData) =>
    API.post(`/api/products/bulk-upload?vendor_id=${VENDOR_ID}`, formData),
};
